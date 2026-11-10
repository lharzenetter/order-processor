namespace OrderProcessor.Bridge;

/// <summary>What the transmitter sends: a heartbeat, call OK or call failed.</summary>
public enum FrameKind
{
    Heartbeat,
    CallOk,
    CallFailed,
}

public readonly record struct Frame(FrameKind Kind, int SystemId);

/// <summary>TD186 serial frames: <c>FE 9A | 05 SS SS P1 P2 C | CS | 69</c> (#23, TD186 protocol).</summary>
public static class Frames
{
    public const int Length = 10;

    public static byte[] Call(int systemId, int pager)
    {
        byte[] frame =
        [
            0xFE,
            0x9A,
            0x05,
            (byte)(systemId >> 8),
            (byte)systemId,
            (byte)(pager >> 8),
            (byte)pager,
            0x80,
            0,
            0x69,
        ];
        frame[8] = Checksum(frame);
        return frame;
    }

    /// <summary>The frame at the start of <paramref name="bytes"/>, or null when it is not a valid one.</summary>
    public static Frame? Parse(ReadOnlySpan<byte> bytes)
    {
        if (
            bytes.Length < Length
            || bytes[0] != 0xFE
            || bytes[1] != 0x9A
            || bytes[2] != 0x05
            || bytes[9] != 0x69
            || bytes[8] != Checksum(bytes)
            || bytes[5] != bytes[6]
            || bytes[6] != bytes[7]
        )
        {
            return null;
        }
        FrameKind? kind = bytes[5] switch
        {
            0x55 or 0xF2 => FrameKind.Heartbeat,
            0xAA => FrameKind.CallOk,
            0xEE => FrameKind.CallFailed,
            _ => null,
        };
        return kind is { } k ? new Frame(k, (bytes[3] << 8) | bytes[4]) : null;
    }

    // The sum of the six bytes from 05 through C, mod 256; FE 9A is not included.
    private static byte Checksum(ReadOnlySpan<byte> frame)
    {
        var sum = 0;
        foreach (var b in frame[2..8])
        {
            sum += b;
        }
        return (byte)sum;
    }
}

/// <summary>Cuts the byte stream into frames, resyncing on <c>FE 9A</c> after junk bytes.</summary>
public sealed class FrameReader
{
    private readonly List<byte> buffer = [];

    public IReadOnlyList<Frame> Push(ReadOnlySpan<byte> bytes)
    {
        buffer.AddRange(bytes);
        var frames = new List<Frame>();
        var start = 0;
        while (buffer.Count - start >= 2)
        {
            if (buffer[start] != 0xFE || buffer[start + 1] != 0x9A)
            {
                start++;
                continue;
            }
            if (buffer.Count - start < Frames.Length)
            {
                break;
            }
            var frame = Frames.Parse(buffer.GetRange(start, Frames.Length).ToArray());
            if (frame is { } f)
            {
                frames.Add(f);
                start += Frames.Length;
            }
            else
            {
                start++;
            }
        }
        buffer.RemoveRange(0, start);
        return frames;
    }
}

public enum CallResult
{
    Ok,
    Failed,
    NotConnected,
}
