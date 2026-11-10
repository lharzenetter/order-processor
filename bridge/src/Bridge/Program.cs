using System.Net.NetworkInformation;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging.EventLog;
using OrderProcessor.Bridge;

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("The pager bridge runs on Windows only.");
    return 1;
}

// The server reaches the bridge at BRIDGE_URL, http://host.docker.internal:9186 by default (#23).
const int Port = 9186;

var builder = WebApplication.CreateBuilder(
    new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory }
);
builder.Services.AddWindowsService(options => options.ServiceName = "order-processor-bridge");
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
builder.Logging.AddFilter<EventLogLoggerProvider>("OrderProcessor", LogLevel.Information);
builder.WebHost.ConfigureKestrel(kestrel =>
{
    var adapters = NetworkInterface
        .GetAllNetworkInterfaces()
        .Where(adapter => adapter.OperationalStatus == OperationalStatus.Up)
        .SelectMany(adapter =>
            adapter.GetIPProperties().UnicastAddresses.Select(unicast => new NetworkAdapter(adapter.Name, unicast.Address))
        );
    foreach (var address in ListenAddresses.Of(adapters))
    {
        kestrel.Listen(address, Port);
    }
});
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase))
);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<ISerialPortSource, WindowsSerialPortSource>();
builder.Services.AddSingleton<Transmitter>();
builder.Services.AddHostedService<TransmitterKeeper>();

var app = builder.Build();

app.MapPost(
    "/calls",
    async (CallRequest request, Transmitter transmitter, CancellationToken cancellationToken) =>
        request.Pager is int pager and >= 1 and <= 0xFFFF
            ? Results.Ok(new { result = await transmitter.CallAsync(pager, cancellationToken) })
            : Results.BadRequest()
);
app.MapGet("/status", (Transmitter transmitter) => new { connected = transmitter.IsConnected });

await app.RunAsync();
return 0;

internal sealed record CallRequest(int? Pager);
