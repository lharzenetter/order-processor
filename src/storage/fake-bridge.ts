import type { Fetch, PagerCallResult } from "./server-log";

/**
 * A double of the pager bridge's HTTP API (#23: `POST /calls`, `GET /status`), for the server and
 * its fake to relay to. Its switches stand for the bridge's answers and its failures.
 */
export interface FakeBridge {
  readonly fetch: Fetch;
  /** The pagers called, in order. */
  readonly calls: readonly number[];
  /** What the next pager calls are answered with (default ok). */
  answerCalls(result: PagerCallResult): void;
  /** What `GET /status` reports (default connected). */
  connectTransmitter(connected: boolean): void;
  /** Every request fails as if nothing listened. */
  goUnreachable(): void;
  /** Requests are taken but never answered. */
  goSilent(): void;
}

export function createFakeBridge(): FakeBridge {
  const calls: number[] = [];
  let result: PagerCallResult = "ok";
  let connected = true;
  let failure: "unreachable" | "silent" | null = null;

  function answer(method: string, url: URL, body: unknown): Response {
    if (method === "POST" && url.pathname === "/calls") {
      const pager =
        typeof body === "object" && body !== null && "pager" in body
          ? body.pager
          : undefined;
      if (typeof pager === "number") {
        calls.push(pager);
      }
      return Response.json({ result });
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
    answerCalls(next) {
      result = next;
    },
    connectTransmitter(next) {
      connected = next;
    },
    goUnreachable() {
      failure = "unreachable";
    },
    goSilent() {
      failure = "silent";
    },
  };
}
