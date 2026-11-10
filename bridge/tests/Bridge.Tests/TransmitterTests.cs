using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;

namespace OrderProcessor.Bridge.Tests;

public sealed class TransmitterTests : IAsyncDisposable
{
    private static readonly byte[] Heartbeat = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0x55, 0x55, 0x55, 0xB6, 0x69];
    private static readonly byte[] CallOk = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0xAA, 0xAA, 0xAA, 0xB5, 0x69];

    private readonly FakeTimeProvider time = new();
    private readonly FakeSerialPortSource ports = new();
    private readonly Transmitter transmitter;

    public TransmitterTests()
    {
        transmitter = new Transmitter(ports, time, NullLogger<Transmitter>.Instance);
    }

    public ValueTask DisposeAsync() => transmitter.DisposeAsync();

    [Fact(Timeout = 10_000)]
    public async Task Tries_ch340_ports_before_every_other_serial_port()
    {
        ports.Add("COM1", isCh340: false, TD186);
        ports.Add("COM4", isCh340: true, TD186);

        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        Assert.True(transmitter.IsConnected);
        Assert.Equal(["COM4"], ports.OpenedNames);
        Assert.Equal(CallResult.Ok, await transmitter.CallAsync(21, TestContext.Current.CancellationToken));
    }

    [Fact(Timeout = 10_000)]
    public async Task Accepts_another_port_only_after_its_heartbeat_and_closes_the_silent_ones()
    {
        ports.Add("COM4", isCh340: true, Silent);
        ports.Add("COM7", isCh340: false, Silent);
        ports.Add("COM9", isCh340: false, TD186);

        var connecting = transmitter.ConnectAsync(TestContext.Current.CancellationToken);
        await (await ports.Opened("COM4")).Drained();
        time.Advance(TimeSpan.FromSeconds(3));
        await (await ports.Opened("COM7")).Drained();
        await (await ports.Opened("COM9")).Drained();
        time.Advance(TimeSpan.FromSeconds(3));
        await connecting;

        Assert.True(transmitter.IsConnected);
        Assert.True((await ports.Opened("COM4")).Disposed);
        Assert.True((await ports.Opened("COM7")).Disposed);
        Assert.False((await ports.Opened("COM9")).Disposed);
    }

    [Fact(Timeout = 10_000)]
    public async Task Without_a_transmitter_a_call_reports_not_connected()
    {
        ports.Add("COM1", isCh340: false, Silent);

        var connecting = transmitter.ConnectAsync(TestContext.Current.CancellationToken);
        await (await ports.Opened("COM1")).Drained();
        time.Advance(TimeSpan.FromSeconds(3));
        await connecting;

        Assert.False(transmitter.IsConnected);
        Assert.Equal(CallResult.NotConnected, await transmitter.CallAsync(21, TestContext.Current.CancellationToken));
        Assert.True((await ports.Opened("COM1")).Disposed);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_port_that_cannot_be_opened_is_skipped()
    {
        ports.Add("COM2", isCh340: true, () => throw new UnauthorizedAccessException("Access to COM2 is denied."));
        ports.Add("COM4", isCh340: true, TD186);

        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        Assert.True(transmitter.IsConnected);
    }

    [Fact(Timeout = 10_000)]
    public async Task With_two_transmitters_takes_the_first_and_closes_the_other()
    {
        ports.Add("COM4", isCh340: true, TD186);
        ports.Add("COM5", isCh340: true, TD186);

        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        Assert.Equal(CallResult.Ok, await transmitter.CallAsync(21, TestContext.Current.CancellationToken));
        Assert.Single((await ports.Opened("COM4")).Written);
        Assert.True((await ports.Opened("COM5")).Disposed);
    }

    [Fact(Timeout = 10_000)]
    public async Task Picks_the_transmitter_up_again_after_it_is_unplugged_and_plugged_back_in()
    {
        // #25: re-plugged, the transmitter may come back on another COM port.
        ports.Add("COM4", isCh340: true, TD186);
        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        (await ports.Opened("COM4")).Fail();
        await transmitter.Lost;
        ports.Remove("COM4");
        ports.Add("COM6", isCh340: true, TD186);
        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        Assert.True(transmitter.IsConnected);
        Assert.Equal(CallResult.Ok, await transmitter.CallAsync(21, TestContext.Current.CancellationToken));
        Assert.Single((await ports.Opened("COM6")).Written);
    }

    [Fact(Timeout = 10_000)]
    public async Task Rescans_once_the_heartbeat_stops_for_5_s()
    {
        ports.Add("COM4", isCh340: true, TD186);
        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);
        var first = await ports.Opened("COM4");

        time.Advance(TimeSpan.FromSeconds(5));
        Assert.False(transmitter.IsConnected);
        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        Assert.True(first.Disposed);
        Assert.True(transmitter.IsConnected);
    }

    [Fact(Timeout = 10_000)]
    public async Task Keeps_a_connected_transmitter_without_rescanning()
    {
        ports.Add("COM4", isCh340: true, TD186);
        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        await transmitter.ConnectAsync(TestContext.Current.CancellationToken);

        Assert.Equal(["COM4"], ports.OpenedNames);
    }

    private FakeSerialStream TD186()
    {
        var stream = new FakeSerialStream();
        stream.Send(Heartbeat);
        stream.OnWrite = _ => stream.Send(CallOk);
        return stream;
    }

    private static FakeSerialStream Silent() => new();
}
