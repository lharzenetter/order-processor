import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { text } from "node:stream/consumers";

// A double of the pager bridge (#23) for the e2e flows: it answers `POST /calls`,
// `POST /group-calls` (#33) and `GET /status` like the real one, and `PUT /fake` sets what it answers. Plain HTTP on loopback,
// as the real bridge listens.
export const FAKE_BRIDGE_PORT = 9186;

interface Behaviour {
  connected: boolean;
  result: "ok" | "failed" | "notConnected";
}

const DEFAULT_BEHAVIOUR: Behaviour = { connected: true, result: "ok" };
let behaviour: Behaviour = { ...DEFAULT_BEHAVIOUR };
let calls: number[] = [];
let groupCalls = 0;

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const route = `${request.method ?? "GET"} ${request.url ?? "/"}`;
  const body: unknown =
    request.method === "GET"
      ? null
      : JSON.parse((await text(request)) || "null");
  switch (route) {
    case "POST /calls": {
      const pager =
        typeof body === "object" && body !== null && "pager" in body
          ? body.pager
          : null;
      if (typeof pager === "number") calls.push(pager);
      reply(response, 200, { result: behaviour.result });
      return;
    }
    case "POST /group-calls":
      groupCalls += 1;
      reply(response, 200, { result: behaviour.result });
      return;
    case "GET /status":
      reply(response, 200, { connected: behaviour.connected });
      return;
    case "GET /fake":
      reply(response, 200, { ...behaviour, calls, groupCalls });
      return;
    case "PUT /fake":
      behaviour = { ...DEFAULT_BEHAVIOUR, ...(body as Partial<Behaviour>) };
      calls = [];
      groupCalls = 0;
      reply(response, 200, behaviour);
      return;
    default:
      reply(response, 404, null);
  }
}

export function startFakeBridge(): void {
  createServer((request, response) => {
    void handle(request, response);
  }).listen(FAKE_BRIDGE_PORT, "127.0.0.1");
}
