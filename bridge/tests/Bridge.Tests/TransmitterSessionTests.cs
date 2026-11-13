using Microsoft.Extensions.Time.Testing;

namespace OrderProcessor.Bridge.Tests;

public sealed class TransmitterSessionTests : IDisposable
{
    // Frames confirmed on the device on 2026-11-10, System ID 433 (#23, TD186 protocol).
    private static readonly byte[] Heartbeat = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0x55, 0x55, 0x55, 0xB6, 0x69];
    private static readonly byte[] CallPager21 = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0x00, 0x15, 0x80, 0x4C, 0x69];
    private static readonly byte[] CallOk = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0xAA, 0xAA, 0xAA, 0xB5, 0x69];

    private static readonly byte[] CallFailed = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0xEE, 0xEE, 0xEE, 0x81, 0x69];

    private readonly FakeTimeProvider time = new();
    private readonly FakeSerialStream port = new();

    public void Dispose() => port.Dispose();

    [Fact(Timeout = 10_000)]
    public async Task Learns_the_system_id_from_a_heartbeat_after_junk_bytes()
    {
        // #25: junk arrives when the port opens; the bridge resyncs on FE 9A.
        port.Send([0x00, 0xFE, 0x13, 0x9A, 0xFE]);
        port.Send(Heartbeat);

        var session = await TransmitterSession.OpenAsync(port, time, TestContext.Current.CancellationToken);

        Assert.NotNull(session);
        Assert.Equal(433, session.SystemId);
    }

    [Fact(Timeout = 10_000)]
    public async Task Learns_the_system_id_when_reads_come_back_empty_before_the_heartbeat()
    {
        // #31: the Windows serial driver may end a read with no bytes or a timeout while the line is quiet.
        port.ReadsNothing();
        port.TimesOut();
        port.Send(Heartbeat);

        var session = await TransmitterSession.OpenAsync(port, time, TestContext.Current.CancellationToken);

        Assert.NotNull(session);
        Assert.Equal(433, session.SystemId);
    }

    [Fact(Timeout = 10_000)]
    public async Task Reads_that_come_back_empty_keep_the_transmitter_connected()
    {
        // #31
        await using var session = await Open();

        port.ReadsNothing();
        port.TimesOut();
        await port.Drained();

        Assert.True(session.IsConnected);
        port.OnWrite = _ => port.Send(CallOk);
        Assert.Equal(CallResult.Ok, await session.CallAsync(21, TestContext.Current.CancellationToken));
    }

    [Fact(Timeout = 10_000)]
    public async Task A_port_without_a_valid_heartbeat_within_3_s_is_closed()
    {
        // #25: a heartbeat with a wrong checksum is not a valid one.
        port.Send([0xFE, 0x9A, 0x05, 0x01, 0xB1, 0x55, 0x55, 0x55, 0xB7, 0x69]);

        var opening = TransmitterSession.OpenAsync(port, time, TestContext.Current.CancellationToken);
        await port.Drained();
        time.Advance(TimeSpan.FromSeconds(3));

        Assert.Null(await opening);
        Assert.True(port.Disposed);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_call_answered_with_call_ok_reports_ok()
    {
        await using var session = await Open();
        port.OnWrite = _ => port.Send(CallOk);

        var result = await session.CallAsync(21, TestContext.Current.CancellationToken);

        Assert.Equal(CallResult.Ok, result);
        Assert.Equal([CallPager21], port.Written);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_call_answered_with_call_failed_reports_failed()
    {
        await using var session = await Open();
        port.OnWrite = _ => port.Send(CallFailed);

        Assert.Equal(CallResult.Failed, await session.CallAsync(21, TestContext.Current.CancellationToken));
    }

    [Fact(Timeout = 10_000)]
    public async Task A_call_not_answered_within_1_s_reports_failed()
    {
        await using var session = await Open();

        var call = session.CallAsync(21, TestContext.Current.CancellationToken);
        await port.NextWrite();
        time.Advance(TimeSpan.FromSeconds(1));

        Assert.Equal(CallResult.Failed, await call);
    }

    [Fact(Timeout = 10_000)]
    public async Task Calls_go_out_one_at_a_time_in_the_order_they_arrive()
    {
        await using var session = await Open();

        var first = session.CallAsync(21, TestContext.Current.CancellationToken);
        var second = session.CallAsync(22, TestContext.Current.CancellationToken);
        await port.NextWrite();
        Assert.Single(port.Written);
        port.Send(CallOk);
        await port.NextWrite();
        port.Send(CallFailed);

        Assert.Equal(CallResult.Ok, await first);
        Assert.Equal(CallResult.Failed, await second);
        Assert.Equal([21, 22], port.Written.Select(frame => (frame[5] << 8) | frame[6]));
    }

    [Fact(Timeout = 10_000)]
    public async Task Without_a_heartbeat_for_5_s_the_transmitter_is_not_connected()
    {
        await using var session = await Open();
        time.Advance(TimeSpan.FromSeconds(4));
        port.Send(Heartbeat);
        await port.Drained();
        time.Advance(TimeSpan.FromSeconds(4));
        Assert.True(session.IsConnected);

        time.Advance(TimeSpan.FromSeconds(1));

        Assert.False(session.IsConnected);
        Assert.Equal(CallResult.NotConnected, await session.CallAsync(21, TestContext.Current.CancellationToken));
        Assert.Empty(port.Written);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_failed_port_is_not_connected()
    {
        await using var session = await Open();

        port.Fail();
        await session.Lost;

        Assert.False(session.IsConnected);
        Assert.Equal(CallResult.NotConnected, await session.CallAsync(21, TestContext.Current.CancellationToken));
    }

    [Fact(Timeout = 10_000)]
    public async Task A_call_the_port_fails_to_write_reports_not_connected()
    {
        await using var session = await Open();
        port.FailWrites();

        Assert.Equal(CallResult.NotConnected, await session.CallAsync(21, TestContext.Current.CancellationToken));
        Assert.False(session.IsConnected);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_group_call_sends_the_vendor_group_call_frame_and_reports_ok()
    {
        // #33: pager 3FFF with command 10, acked with call OK on the venue's TD186 (#34).
        byte[] groupCall = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0x3F, 0xFF, 0x10, 0x05, 0x69];
        await using var session = await Open();
        port.OnWrite = _ => port.Send(CallOk);

        var result = await session.GroupCallAsync(TestContext.Current.CancellationToken);

        Assert.Equal(CallResult.Ok, result);
        Assert.Equal([groupCall], port.Written);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_group_call_answered_with_call_failed_reports_failed()
    {
        // #33
        await using var session = await Open();
        port.OnWrite = _ => port.Send(CallFailed);

        Assert.Equal(CallResult.Failed, await session.GroupCallAsync(TestContext.Current.CancellationToken));
    }

    [Fact(Timeout = 10_000)]
    public async Task A_group_call_without_a_heartbeat_for_5_s_reports_not_connected()
    {
        // #33
        await using var session = await Open();
        time.Advance(TimeSpan.FromSeconds(5));

        Assert.Equal(CallResult.NotConnected, await session.GroupCallAsync(TestContext.Current.CancellationToken));
        Assert.Empty(port.Written);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_group_call_waits_its_turn_behind_a_pager_call()
    {
        // #33
        await using var session = await Open();

        var call = session.CallAsync(21, TestContext.Current.CancellationToken);
        var groupCall = session.GroupCallAsync(TestContext.Current.CancellationToken);
        await port.NextWrite();
        Assert.Single(port.Written);
        port.Send(CallOk);
        await port.NextWrite();
        port.Send(CallOk);

        Assert.Equal(CallResult.Ok, await call);
        Assert.Equal(CallResult.Ok, await groupCall);
        Assert.Equal([0x80, 0x10], port.Written.Select(frame => (int)frame[7]));
    }

    [Fact(Timeout = 10_000)]
    public async Task A_power_off_sends_a_call_to_pager_999_and_reports_ok()
    {
        // #32: the keypad's power-off number, acked with call OK on the venue's TD186 (#34).
        byte[] powerOff = [0xFE, 0x9A, 0x05, 0x01, 0xB1, 0x03, 0xE7, 0x80, 0x21, 0x69];
        await using var session = await Open();
        port.OnWrite = _ => port.Send(CallOk);

        var result = await session.PowerOffAsync(TestContext.Current.CancellationToken);

        Assert.Equal(CallResult.Ok, result);
        Assert.Equal([powerOff], port.Written);
    }

    [Fact(Timeout = 10_000)]
    public async Task A_power_off_answered_with_call_failed_reports_failed()
    {
        // #32
        await using var session = await Open();
        port.OnWrite = _ => port.Send(CallFailed);

        Assert.Equal(CallResult.Failed, await session.PowerOffAsync(TestContext.Current.CancellationToken));
    }

    [Fact(Timeout = 10_000)]
    public async Task A_power_off_without_a_heartbeat_for_5_s_reports_not_connected()
    {
        // #32
        await using var session = await Open();
        time.Advance(TimeSpan.FromSeconds(5));

        Assert.Equal(CallResult.NotConnected, await session.PowerOffAsync(TestContext.Current.CancellationToken));
        Assert.Empty(port.Written);
    }

    private async Task<TransmitterSession> Open()
    {
        port.Send(Heartbeat);
        var session = await TransmitterSession.OpenAsync(port, time, TestContext.Current.CancellationToken);
        Assert.NotNull(session);
        return session;
    }
}
