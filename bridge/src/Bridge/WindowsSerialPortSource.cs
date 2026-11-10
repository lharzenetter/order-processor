using System.IO.Ports;
using System.Management;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;

namespace OrderProcessor.Bridge;

/// <summary>The COM ports Windows lists, with the CH340 ones told apart through WMI.</summary>
[SupportedOSPlatform("windows")]
public sealed partial class WindowsSerialPortSource : ISerialPortSource, IDisposable
{
    // The TD186 talks through a CH340 USB serial chip (#23).
    private const string Ch340Query =
        "SELECT Name FROM Win32_PnPEntity WHERE PNPDeviceID LIKE '%VID_1A86&PID_7523%'";

    private readonly ManagementEventWatcher arrivals = new(
        new WqlEventQuery("SELECT * FROM Win32_DeviceChangeEvent WHERE EventType = 2")
    );
    private readonly SemaphoreSlim arrived = new(0);

    public WindowsSerialPortSource()
    {
        arrivals.EventArrived += (_, _) => arrived.Release();
        arrivals.Start();
    }

    public IReadOnlyList<SerialPortCandidate> List()
    {
        var ch340 = Ch340PortNames();
        return
        [
            .. SerialPort
                .GetPortNames()
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase)
                .Select(name => new SerialPortCandidate(name, ch340.Contains(name))),
        ];
    }

    public Stream Open(string name)
    {
        var port = new SerialPort(name, 9600, Parity.None, 8, StopBits.One)
        {
            Handshake = Handshake.None,
            RtsEnable = true,
            // Wakes a blocking read on a quiet line, so a cancelled read ends within 500 ms.
            ReadTimeout = 500,
        };
        try
        {
            port.Open();
            return new OwnedSerialStream(port);
        }
        catch
        {
            port.Dispose();
            throw;
        }
    }

    public async Task WaitForArrivalAsync(CancellationToken cancellationToken)
    {
        await arrived.WaitAsync(cancellationToken).ConfigureAwait(false);
        // Several events arrive for one plug-in; one rescan covers them all.
        while (arrived.Wait(0, CancellationToken.None)) { }
    }

    public void Dispose()
    {
        arrivals.Stop();
        arrivals.Dispose();
        arrived.Dispose();
    }

    private static HashSet<string> Ch340PortNames()
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var searcher = new ManagementObjectSearcher(Ch340Query);
        using var devices = searcher.Get();
        foreach (var device in devices)
        {
            using (device)
            {
                // e.g. "USB-SERIAL CH340 (COM4)"
                if (device["Name"] is string name && ComPort().Match(name) is { Success: true } match)
                {
                    names.Add(match.Groups[1].Value);
                }
            }
        }
        return names;
    }

    [GeneratedRegex(@"\((COM\d+)\)")]
    private static partial Regex ComPort();

    /// <summary>The port's stream, closing the port with it.</summary>
    private sealed class OwnedSerialStream(SerialPort port) : Stream
    {
        private readonly Stream stream = port.BaseStream;

        public override bool CanRead => stream.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => stream.CanWrite;
        public override long Length => throw new NotSupportedException();
        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush() => stream.Flush();

        public override int Read(byte[] buffer, int offset, int count) => stream.Read(buffer, offset, count);

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        // Blocking reads on a pool thread: on the TD186's CH340, async reads return empty at once in a busy
        // loop and fail now and then, while a blocking read with a timeout gets every heartbeat
        // (tools/serial-read-probe.ps1, on the hardware 2026-11-10).
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            new(Task.Run(() => ReadBlocking(buffer, cancellationToken), cancellationToken));

        private int ReadBlocking(Memory<byte> buffer, CancellationToken cancellationToken)
        {
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    return stream.Read(buffer.Span);
                }
                catch (TimeoutException)
                {
                    // Nothing arrived within the read timeout; read again.
                }
            }
        }

        public override void Write(byte[] buffer, int offset, int count) => stream.Write(buffer, offset, count);

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            stream.WriteAsync(buffer, offset, count, cancellationToken);

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default) =>
            stream.WriteAsync(buffer, cancellationToken);

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                port.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
