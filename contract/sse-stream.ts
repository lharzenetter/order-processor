import type { Fetch, StreamMessage, SyncStream } from "../src/storage/index";

/** An `EventSource`-like reader over a `fetch` reply, for driving the real handler in-process. */
export function openSseStream(fetch: Fetch, url: string): SyncStream {
  const listeners = new Map<string, ((message: StreamMessage) => void)[]>();
  const controller = new AbortController();
  let closed = false;
  // Read through a call: `close()` can flip it while a read is awaited.
  function isClosed(): boolean {
    return closed;
  }

  function dispatch(block: string): void {
    let type = "message";
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) {
        continue;
      }
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") {
        type = value;
      } else if (field === "data") {
        data.push(value);
      } else if (field === "id") {
        id = value;
      }
    }
    if (data.length === 0) {
      return;
    }
    const message: StreamMessage =
      id === undefined
        ? { data: data.join("\n") }
        : { data: data.join("\n"), lastEventId: id };
    for (const listener of listeners.get(type) ?? []) {
      listener(message);
    }
  }

  function fail(): void {
    if (!closed) {
      for (const listener of listeners.get("error") ?? []) {
        listener({ data: "" });
      }
    }
  }

  void (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status !== 200 || response.body === null) {
        fail();
        return;
      }
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done || isClosed()) {
          break;
        }
        buffer += value;
        let end = buffer.indexOf("\n\n");
        while (end !== -1) {
          dispatch(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          end = buffer.indexOf("\n\n");
        }
      }
      void reader.cancel();
      fail();
    } catch {
      fail();
    }
  })();

  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close() {
      closed = true;
      controller.abort();
    },
  };
}
