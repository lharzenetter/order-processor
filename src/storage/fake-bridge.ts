import type { Fetch, PagerCallResult } from "./server-log";

/**
 * A double of the pager bridge's HTTP API (#23: `POST /calls`, `GET /status`; #33:
 * `POST /group-calls`; #32: `POST /power-offs`), for the server and its fake to relay to. Its switches stand for the
 * bridge's answers and its failures.
 */
export interface FakeBridge {
  readonly fetch: Fetch;
  /** The pagers called, in order. */
  readonly calls: readonly number[];
  /** How many group calls arrived. */
  readonly groupCalls: number;
  /** How many power-offs arrived. */
  readonly powerOffs: number;
  /** What the next pager calls, group calls and power-offs are answered with (default ok). */
  answerCalls(result: PagerCallResult): void;
  /** What `GET /status` reports (default connected). */
  connectTransmitter(connected: boolean): void;
  /** Calls are answered with a body that holds no result. */
  answerGarbage(): void;
  /** Every request fails as if nothing listened. */
  goUnreachable(): void;
  /** Requests are taken but never answered. */
  goSilent(): void;
}

export function createFakeBridge(): FakeBridge {
  const calls: number[] = [];
  let groupCalls = 0;
  let powerOffs = 0;
  let result: PagerCallResult = "ok";
  let connected = true;
  let failure: "unreachable" | "silent" | "garbage" | null = null;

  function callAnswer(): Response {
    return failure === "garbage"
      ? new Response("<html>", { status: 200 })
      : Response.json({ result });
  }

  function answer(method: string, url: URL, body: unknown): Response {
    if (method === "POST" && url.pathname === "/calls") {
      const pager =
        typeof body === "object" && body !== null && "pager" in body
          ? body.pager
          : undefined;
      if (typeof pager === "number") {
        calls.push(pager);
      }
      return callAnswer();
    }
    if (method === "POST" && url.pathname === "/group-calls") {
      groupCalls += 1;
      return callAnswer();
    }
    if (method === "POST" && url.pathname === "/power-offs") {
      powerOffs += 1;
      return callAnswer();
    }
    if (method === "GET" && url.pathname === "/status") {
      return Response.json({ connected });
    }
    return new Response(null, { status: 404 });
  }

  function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
    if (failure === "unreachable") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (failure === "silent") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    const body: unknown =
      typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    return Promise.resolve(answer(init.method ?? "GET", new URL(input), body));
  }

  return {
    fetch: fakeFetch,
    get calls() {
      return calls;
    },
    get groupCalls() {
      return groupCalls;
    },
    get powerOffs() {
      return powerOffs;
    },
    answerCalls(next) {
      result = next;
    },
    connectTransmitter(next) {
      connected = next;
    },
    answerGarbage() {
      failure = "garbage";
    },
    goUnreachable() {
      failure = "unreachable";
    },
    goSilent() {
      failure = "silent";
    },
  };
}
