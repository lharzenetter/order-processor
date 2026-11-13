using Microsoft.Extensions.Logging;

namespace OrderProcessor.Bridge;

/// <summary>The TD186 on whatever serial port it answers on.</summary>
public sealed partial class Transmitter(ISerialPortSource ports, TimeProvider time, ILogger<Transmitter> logger)
    : IAsyncDisposable
{
    private TransmitterSession? session;

    public bool IsConnected => Volatile.Read(ref session)?.IsConnected == true;

    /// <summary>Completes when the port of the connected transmitter fails; at once without one.</summary>
    public Task Lost => Volatile.Read(ref session)?.Lost ?? Task.CompletedTask;

    /// <summary>
    /// Keeps a connected transmitter; otherwise closes the lost one and scans for it again: CH340
    /// ports first, then every other serial port, accepting a port only once a heartbeat arrives.
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken)
    {
        if (IsConnected)
        {
            return;
        }
        if (Interlocked.Exchange(ref session, null) is { } lost)
        {
            LogLost();
            await lost.DisposeAsync().ConfigureAwait(false);
        }
        var candidates = ports.List();
        foreach (var isCh340 in new[] { true, false })
        {
            var found = await FindAsync([.. candidates.Where(c => c.IsCh340 == isCh340)], cancellationToken)
                .ConfigureAwait(false);
            if (found is not null)
            {
                Volatile.Write(ref session, found);
                return;
            }
        }
    }

    public Task<CallResult> CallAsync(int pager, CancellationToken cancellationToken) =>
        Volatile.Read(ref session) is { IsConnected: true } current
            ? current.CallAsync(pager, cancellationToken)
            : Task.FromResult(CallResult.NotConnected);

    public Task<CallResult> GroupCallAsync(CancellationToken cancellationToken) =>
        Volatile.Read(ref session) is { IsConnected: true } current
            ? current.GroupCallAsync(cancellationToken)
            : Task.FromResult(CallResult.NotConnected);

    public Task<CallResult> PowerOffAsync(CancellationToken cancellationToken) =>
        Volatile.Read(ref session) is { IsConnected: true } current
            ? current.PowerOffAsync(cancellationToken)
            : Task.FromResult(CallResult.NotConnected);

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref session, null) is { } current)
        {
            await current.DisposeAsync().ConfigureAwait(false);
        }
    }

    // Opens every candidate at once, so a scan takes about 3 s however many ports there are.
    private async Task<TransmitterSession?> FindAsync(
        IReadOnlyList<SerialPortCandidate> candidates,
        CancellationToken cancellationToken
    )
    {
        var opening = new List<(string Name, Task<TransmitterSession?> Session)>();
        foreach (var candidate in candidates)
        {
            try
            {
                var stream = ports.Open(candidate.Name);
                opening.Add((candidate.Name, TransmitterSession.OpenAsync(stream, time, cancellationToken)));
            }
            catch (Exception e)
                when (e is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
            {
                LogCannotOpen(candidate.Name, e.Message);
            }
        }
        await Task.WhenAll(opening.Select(o => o.Session)).ConfigureAwait(false);
        foreach (var (silent, _) in opening.Where(o => o.Session.Result is null))
        {
            LogNoHeartbeat(silent);
        }
        var answered = opening.Where(o => o.Session.Result is not null).ToList();
        if (answered.Count == 0)
        {
            return null;
        }
        var (name, chosen) = answered[0];
        if (answered.Count > 1)
        {
            LogSeveral(string.Join(", ", answered.Select(a => a.Name)), name);
        }
        foreach (var (_, other) in answered.Skip(1))
        {
            await other.Result!.DisposeAsync().ConfigureAwait(false);
        }
        var found = chosen.Result!;
        LogConnected(name, found.SystemId);
        return found;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Transmitter connected on {Port}, System ID {SystemId}")]
    private partial void LogConnected(string port, int systemId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Transmitter not connected, scanning the serial ports again")]
    private partial void LogLost();

    [LoggerMessage(Level = LogLevel.Warning, Message = "Transmitters answer on {Ports}; using {Port}")]
    private partial void LogSeveral(string ports, string port);

    [LoggerMessage(Level = LogLevel.Debug, Message = "No heartbeat on {Port} within 3 s")]
    private partial void LogNoHeartbeat(string port);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Cannot open {Port}: {Reason}")]
    private partial void LogCannotOpen(string port, string reason);
}
