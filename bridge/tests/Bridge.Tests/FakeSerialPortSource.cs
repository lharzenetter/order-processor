namespace OrderProcessor.Bridge.Tests;

/// <summary>The COM ports Windows lists, each with whatever is plugged into it.</summary>
public sealed class FakeSerialPortSource : ISerialPortSource
{
    private readonly List<(SerialPortCandidate Candidate, Func<FakeSerialStream> Plug)> ports = [];
    private readonly Dictionary<string, TaskCompletionSource<FakeSerialStream>> opened = [];

    public List<string> OpenedNames { get; } = [];

    public void Add(string name, bool isCh340, Func<FakeSerialStream> plug)
    {
        ports.Add((new SerialPortCandidate(name, isCh340), plug));
    }

    public void Remove(string name) => ports.RemoveAll(port => port.Candidate.Name == name);

    /// <summary>The stream the bridge opened last on <paramref name="name"/>.</summary>
    public Task<FakeSerialStream> Opened(string name)
    {
        lock (opened)
        {
            return Signal(name).Task;
        }
    }

    public IReadOnlyList<SerialPortCandidate> List() => [.. ports.Select(port => port.Candidate)];

    public Stream Open(string name)
    {
        var stream = ports.Single(port => port.Candidate.Name == name).Plug();
        lock (opened)
        {
            OpenedNames.Add(name);
            var signal = Signal(name);
            if (!signal.TrySetResult(stream))
            {
                opened[name] = new TaskCompletionSource<FakeSerialStream>(
                    TaskCreationOptions.RunContinuationsAsynchronously
                );
                opened[name].SetResult(stream);
            }
        }
        return stream;
    }

    public Task WaitForArrivalAsync(CancellationToken cancellationToken) =>
        Task.Delay(Timeout.Infinite, cancellationToken);

    private TaskCompletionSource<FakeSerialStream> Signal(string name)
    {
        if (!opened.TryGetValue(name, out var signal))
        {
            signal = new TaskCompletionSource<FakeSerialStream>(TaskCreationOptions.RunContinuationsAsynchronously);
            opened[name] = signal;
        }
        return signal;
    }
}
