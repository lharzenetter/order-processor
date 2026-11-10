using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OrderProcessor.Bridge;

/// <summary>Keeps the transmitter connected: rescans every few seconds and on device arrival while it is not.</summary>
public sealed partial class TransmitterKeeper(
    Transmitter transmitter,
    ISerialPortSource ports,
    TimeProvider time,
    ILogger<TransmitterKeeper> logger
) : BackgroundService
{
    private static readonly TimeSpan HeartbeatCheck = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan RescanInterval = TimeSpan.FromSeconds(3);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await transmitter.ConnectAsync(stoppingToken).ConfigureAwait(false);
                var next = transmitter.IsConnected
                    ? Task.WhenAny(transmitter.Lost, Task.Delay(HeartbeatCheck, time, stoppingToken))
                    : Task.WhenAny(
                        ports.WaitForArrivalAsync(stoppingToken),
                        Task.Delay(RescanInterval, time, stoppingToken)
                    );
                await next.ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
#pragma warning disable CA1031 // Any crash must end the process so the service manager restarts it.
        catch (Exception e)
#pragma warning restore CA1031
        {
            LogCrashed(e);
            // A non-zero exit is what the service's recovery actions (sc failureflag 1) restart on.
            Environment.Exit(1);
        }
    }

    [LoggerMessage(Level = LogLevel.Critical, Message = "The pager bridge crashed; the service restarts it")]
    private partial void LogCrashed(Exception exception);
}
