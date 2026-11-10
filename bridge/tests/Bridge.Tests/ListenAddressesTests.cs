using System.Net;

namespace OrderProcessor.Bridge.Tests;

public class ListenAddressesTests
{
    [Fact]
    public void Listens_on_loopback_and_the_docker_adapter_never_on_the_venue_wifi()
    {
        // #25: plain HTTP without authentication must stay out of reach of the venue Wi-Fi.
        NetworkAdapter[] adapters =
        [
            new("WLAN", IPAddress.Parse("192.168.178.20")),
            new("Ethernet", IPAddress.Parse("192.168.178.21")),
            new("vEthernet (WSL (Hyper-V firewall))", IPAddress.Parse("172.24.16.1")),
            new("vEthernet (WSL (Hyper-V firewall))", IPAddress.Parse("fe80::1")),
            new("vEthernet (Default Switch)", IPAddress.Parse("172.30.0.1")),
            new("Loopback Pseudo-Interface 1", IPAddress.Loopback),
        ];

        Assert.Equal(
            [IPAddress.Loopback, IPAddress.Parse("172.24.16.1")],
            ListenAddresses.Of(adapters)
        );
    }

    [Fact]
    public void Without_a_docker_adapter_listens_on_loopback_only()
    {
        Assert.Equal([IPAddress.Loopback], ListenAddresses.Of([new("WLAN", IPAddress.Parse("10.0.0.5"))]));
    }
}
