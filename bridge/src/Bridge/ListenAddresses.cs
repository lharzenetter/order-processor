using System.Net;
using System.Net.Sockets;

namespace OrderProcessor.Bridge;

public sealed record NetworkAdapter(string Name, IPAddress Address);

/// <summary>Where the bridge listens: loopback and the Docker adapter, never the venue Wi-Fi (#23).</summary>
public static class ListenAddresses
{
    public static IReadOnlyList<IPAddress> Of(IEnumerable<NetworkAdapter> adapters) =>
        [
            IPAddress.Loopback,
            .. adapters
                .Where(adapter => adapter.Address.AddressFamily == AddressFamily.InterNetwork)
                .Where(adapter => IsDockerAdapter(adapter.Name))
                .Select(adapter => adapter.Address)
                .Distinct(),
        ];

    // Docker Desktop's WSL2 backend reaches Windows through the "vEthernet (WSL …)" Hyper-V adapter,
    // the older Hyper-V backend through "vEthernet (DockerNAT)".
    private static bool IsDockerAdapter(string name) =>
        name.StartsWith("vEthernet (", StringComparison.OrdinalIgnoreCase)
        && (
            name.Contains("WSL", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Docker", StringComparison.OrdinalIgnoreCase)
        );
}
