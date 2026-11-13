using System.Threading.Channels;

namespace OrderProcessor.Bridge;

/// <summary>An open serial port with a TD186 on it, known by its heartbeat.</summary>
public sealed class TransmitterSession : IAsyncDisposable
{
    private static readonly TimeSpan FirstHeartbeatTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan HeartbeatTimeout = TimeSpan.FromSeconds(5);

    // The vendor software counts a call as failed without an answer within 1 s (#23).
    private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(1);

    private readonly Stream port;
    private readonly TimeProvider time;
    private readonly CancellationTokenSource stopping = new();
    private readonly TaskCompletionSource<int> firstHeartbeat = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Channel<PendingCall> calls = Channel.CreateUnbounded<PendingCall>(
        new UnboundedChannelOptions { SingleReader = true }
    );
    private readonly TaskCompletionSource lost = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private TaskCompletionSource<FrameKind>? answer;
    private long lastHeartbeatTicks;
    private Task reading = Task.CompletedTask;
    private Task calling = Task.CompletedTask;

    private TransmitterSession(Stream port, TimeProvider time)
    {
        this.port = port;
        this.time = time;
    }

    public int SystemId { get; private set; }

    /// <summary>A heartbeat within the last 5 s, and the port has not failed (#23).</summary>
    public bool IsConnected =>
        !lost.Task.IsCompleted
        && time.GetUtcNow() - new DateTimeOffset(Interlocked.Read(ref lastHeartbeatTicks), TimeSpan.Zero)
            < HeartbeatTimeout;

    /// <summary>Completes when the port fails or closes.</summary>
    public Task Lost => lost.Task;

    /// <summary>
    /// Starts reading <paramref name="port"/> and returns the session once a valid heartbeat arrives,
    /// or null, with the port disposed, when none arrives within about 3 s.
    /// </summary>
    public static async Task<TransmitterSession?> OpenAsync(
        Stream port,
        TimeProvider time,
        CancellationToken cancellationToken
    )
    {
        var session = new TransmitterSession(port, time);
        // Started before the first read, so the 3 s run from the moment the port is open.
        using var timeout = new CancellationTokenSource(FirstHeartbeatTimeout, time);
        using var giveUp = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token, cancellationToken);
        session.reading = Task.Run(session.ReadAsync, CancellationToken.None);
        try
        {
            await session.firstHeartbeat.Task.WaitAsync(giveUp.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (session.firstHeartbeat.Task.IsCompleted)
        {
            // The heartbeat arrived just before the deadline.
        }
        catch (OperationCanceledException)
        {
            await session.DisposeAsync().ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            return null;
        }
        session.SystemId = await session.firstHeartbeat.Task.ConfigureAwait(false);
        session.calling = Task.Run(session.SendCallsAsync, CancellationToken.None);
        return session;
    }

    /// <summary>Queues a pager call; calls go out one at a time, in the order they arrive.</summary>
    public Task<CallResult> CallAsync(int pager, CancellationToken cancellationToken) =>
        EnqueueAsync(Frames.Call(SystemId, pager), cancellationToken);

    /// <summary>Queues a group call, in turn with the pager calls (#33).</summary>
    public Task<CallResult> GroupCallAsync(CancellationToken cancellationToken) =>
        EnqueueAsync(Frames.GroupCall(SystemId), cancellationToken);

    private async Task<CallResult> EnqueueAsync(byte[] frame, CancellationToken cancellationToken)
    {
        var call = new PendingCall(frame);
        if (!calls.Writer.TryWrite(call))
        {
            return CallResult.NotConnected;
        }
        return await call.Result.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task SendCallsAsync()
    {
        await foreach (var call in calls.Reader.ReadAllAsync(CancellationToken.None).ConfigureAwait(false))
        {
            call.Result.TrySetResult(await SendAsync(call.Frame).ConfigureAwait(false));
        }
    }

    private async Task<CallResult> SendAsync(byte[] frame)
    {
        if (!IsConnected)
        {
            return CallResult.NotConnected;
        }
        var expected = new TaskCompletionSource<FrameKind>(TaskCreationOptions.RunContinuationsAsynchronously);
        Volatile.Write(ref answer, expected);
        // Started before the write, so the 1 s runs from the moment the frame leaves.
        using var timeout = new CancellationTokenSource(CallTimeout, time);
        try
        {
            await port.WriteAsync(frame, stopping.Token).ConfigureAwait(false);
            await Task.WhenAny(expected.Task, lost.Task).WaitAsync(timeout.Token).ConfigureAwait(false);
            if (!expected.Task.IsCompleted)
            {
                return CallResult.NotConnected;
            }
            return await expected.Task.ConfigureAwait(false) == FrameKind.CallOk ? CallResult.Ok : CallResult.Failed;
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            return CallResult.Failed;
        }
        catch (Exception e)
            when (e is IOException
                or InvalidOperationException
                or UnauthorizedAccessException
                or ObjectDisposedException
                or OperationCanceledException
            )
        {
            lost.TrySetResult();
            return CallResult.NotConnected;
        }
        finally
        {
            Volatile.Write(ref answer, null);
        }
    }

    private async Task ReadAsync()
    {
        var reader = new FrameReader();
        var buffer = new byte[64];
        try
        {
            while (true)
            {
                int count;
                try
                {
                    count = await port.ReadAsync(buffer, stopping.Token).ConfigureAwait(false);
                }
                catch (TimeoutException)
                {
                    continue;
                }
                // A serial port has no end of stream: the Windows driver ends a read on a quiet line with
                // no bytes. A failed port throws; a silent one misses the 5 s heartbeat timeout.
                if (count == 0)
                {
                    continue;
                }
                foreach (var frame in reader.Push(buffer.AsSpan(0, count)))
                {
                    Receive(frame);
                }
            }
        }
        catch (Exception e)
            when (e is IOException or InvalidOperationException or UnauthorizedAccessException or ObjectDisposedException)
        {
            // The serial driver reports a pulled cable through any of these.
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
        lost.TrySetResult();
    }

    private void Receive(Frame frame)
    {
        if (frame.Kind == FrameKind.Heartbeat)
        {
            Interlocked.Exchange(ref lastHeartbeatTicks, time.GetUtcNow().UtcTicks);
            firstHeartbeat.TrySetResult(frame.SystemId);
        }
        else
        {
            // An answer nobody waits for, e.g. one arriving after the 1 s, is dropped.
            Volatile.Read(ref answer)?.TrySetResult(frame.Kind);
        }
    }

    public async ValueTask DisposeAsync()
    {
        calls.Writer.TryComplete();
        await stopping.CancelAsync().ConfigureAwait(false);
        await port.DisposeAsync().ConfigureAwait(false);
        await reading.ConfigureAwait(false);
        await calling.ConfigureAwait(false);
        stopping.Dispose();
    }

    private sealed record PendingCall(byte[] Frame)
    {
        public TaskCompletionSource<CallResult> Result { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
