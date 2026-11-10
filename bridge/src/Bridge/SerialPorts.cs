namespace OrderProcessor.Bridge;

public sealed record SerialPortCandidate(string Name, bool IsCh340);

/// <summary>The serial ports of the machine.</summary>
public interface ISerialPortSource
{
    IReadOnlyList<SerialPortCandidate> List();

    /// <summary>Opens the port at 9600 8N1 with RTS on.</summary>
    Stream Open(string name);

    /// <summary>Completes when a device is plugged in.</summary>
    Task WaitForArrivalAsync(CancellationToken cancellationToken);
}
