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
// The bodiless endpoints require a header a browser cannot send without a CORS preflight, which the
// bridge never answers, so a page open on the venue PC cannot send them as a simple cross-origin
// POST (review of #32 and #33). /calls is covered already: it needs an application/json body.
const string CallerHeader = "X-Bridge-Caller";
app.MapPost(
    "/group-calls",
    async (HttpRequest request, Transmitter transmitter, CancellationToken cancellationToken) =>
        request.Headers[CallerHeader] == "server"
            ? Results.Ok(new { result = await transmitter.GroupCallAsync(cancellationToken) })
            : Results.StatusCode(StatusCodes.Status403Forbidden)
);
app.MapPost(
    "/power-offs",
    async (HttpRequest request, Transmitter transmitter, CancellationToken cancellationToken) =>
        request.Headers[CallerHeader] == "server"
            ? Results.Ok(new { result = await transmitter.PowerOffAsync(cancellationToken) })
            : Results.StatusCode(StatusCodes.Status403Forbidden)
);
app.MapGet("/status", (Transmitter transmitter) => new { connected = transmitter.IsConnected });

await app.RunAsync();
return 0;

internal sealed record CallRequest(int? Pager);
