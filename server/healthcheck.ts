import { request } from "node:https";

// The compose healthcheck: a liveness check over the container's own loopback, so the certificate
// (issued for kirbe.<domain>, not 127.0.0.1) is not verified. It reads PORT and PAIRING_CODE from
// the same environment as main.ts, the only other entry point.
const DEFAULT_PORT = "8443";
const TIMEOUT_MS = 4_000;

const port =
  process.env.PORT === undefined || process.env.PORT === ""
    ? DEFAULT_PORT
    : process.env.PORT;

const probe = request(
  {
    host: "127.0.0.1",
    port,
    path: "/log",
    method: "GET",
    headers: { "X-Pairing-Code": process.env.PAIRING_CODE ?? "" },
    rejectUnauthorized: false,
    timeout: TIMEOUT_MS,
  },
  (response) => {
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);
probe.on("timeout", () => {
  probe.destroy();
});
probe.on("error", () => {
  process.exit(1);
});
probe.end();
