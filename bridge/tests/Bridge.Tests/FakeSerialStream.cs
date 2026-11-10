using System.Threading.Channels;

namespace OrderProcessor.Bridge.Tests;

/// <summary>A serial port with a scripted TD186 on the far end.</summary>
public sealed class FakeSerialStream : Stream
{
    private readonly Channel<Func<byte[]>> incoming = Channel.CreateUnbounded<Func<byte[]>>();
    private readonly Channel<byte[]> writes = Channel.CreateUnbounded<byte[]>();
    private readonly List<byte[]> written = [];
    private byte[] pending = [];
    private TaskCompletionSource drained = NewSignal();
    private int queued;
    private bool failWrites;

    public bool Disposed { get; private set; }

    /// <summary>Called with each frame the bridge writes, e.g. to answer it.</summary>
    public Action<byte[]>? OnWrite { get; set; }

    public IReadOnlyList<byte[]> Written
    {
        get
        {
            lock (written)
            {
                return [.. written];
            }
        }
    }

    /// <summary>Bytes the transmitter sends to the bridge.</summary>
    public void Send(params byte[] bytes) => Enqueue(() => bytes);

    /// <summary>The next read returns no bytes, as a Windows serial driver may.</summary>
    public void ReadsNothing() => Enqueue(() => []);

    /// <summary>The next read times out with nothing received.</summary>
    public void TimesOut() => Enqueue(() => throw new TimeoutException("The operation has timed out."));

    private void Enqueue(Func<byte[]> read)
    {
        lock (incoming)
        {
            queued++;
            if (drained.Task.IsCompleted)
            {
                drained = NewSignal();
            }
        }
        incoming.Writer.TryWrite(read);
    }

    /// <summary>The cable is pulled: every read from now on fails.</summary>
    public void Fail() => incoming.Writer.TryComplete(new IOException("The device is not connected."));

    /// <summary>Writes fail while reads still wait, as when a driver gives up halfway.</summary>
    public void FailWrites() => failWrites = true;

    /// <summary>Completes once the bridge has read everything sent so far and waits for more.</summary>
    public Task Drained()
    {
        lock (incoming)
        {
            return drained.Task;
        }
    }

    public async Task<byte[]> NextWrite() => await writes.Reader.ReadAsync();

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (pending.Length == 0)
        {
            lock (incoming)
            {
                if (queued == 0)
                {
                    drained.TrySetResult();
                }
            }
            Func<byte[]> read;
            try
            {
                read = await incoming.Reader.ReadAsync(cancellationToken);
            }
            catch (ChannelClosedException e) when (e.InnerException is { } inner)
            {
                throw inner;
            }
            lock (incoming)
            {
                queued--;
            }
            pending = read();
        }
        var count = Math.Min(buffer.Length, pending.Length);
        pending.AsSpan(0, count).CopyTo(buffer.Span);
        pending = pending[count..];
        return count;
    }

    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (failWrites || incoming.Reader.Completion.IsFaulted)
        {
            throw new IOException("The device is not connected.");
        }
        var frame = buffer.ToArray();
        lock (written)
        {
            written.Add(frame);
        }
        writes.Writer.TryWrite(frame);
        OnWrite?.Invoke(frame);
        return ValueTask.CompletedTask;
    }

    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    protected override void Dispose(bool disposing)
    {
        Disposed = true;
        incoming.Writer.TryComplete(new ObjectDisposedException(nameof(FakeSerialStream)));
        base.Dispose(disposing);
    }

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override void Flush() { }

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}
