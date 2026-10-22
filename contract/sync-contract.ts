import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readImportFile } from "../src/storage/index";
import type { Fetch, OpenStream, StreamMessage } from "../src/storage/index";

export const CONTRACT_CODE = "ABCD2345";
const BASE = "https://kirbe.example.de";

/** One implementation of the sync protocol: the fake in `storage/`, or the real `server/`. */
export interface SyncTarget {
  readonly fetch: Fetch;
  readonly openStream: OpenStream;
  /** Only the real server writes archive files. */
  readonly archives?: () => readonly unknown[];
  close(): void;
}

function event(seq: number, id = `id-${String(seq)}`) {
  return { id, seq, at: 1_000 * seq, type: "pagerMarkedMissing", pager: seq };
}

/**
 * The protocol scenarios (server-sync 02), written once and run against both the double and the
 * real server, so the double can't drift from what the iPads meet at the Fest.
 */
export function describeSyncContract(
  name: string,
  makeTarget: () => SyncTarget,
): void {
  describe(`the sync protocol: ${name}`, () => {
    let target: SyncTarget;

    beforeEach(() => {
      target = makeTarget();
    });

    afterEach(() => {
      target.close();
    });

    async function call(
      path: string,
      init: { method?: string; body?: unknown; code?: string } = {},
    ): Promise<{ status: number; body: unknown }> {
      const response = await target.fetch(`${BASE}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "X-Pairing-Code": init.code ?? CONTRACT_CODE,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      // A 401 need not carry a body.
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    }

    async function head() {
      const { body } = await call("/log");
      return body as {
        logId: string;
        lastSeq: number;
        ids: string[];
        formatVersion: unknown;
      };
    }

    function post(logId: string, body: object) {
      return call("/log/events", {
        method: "POST",
        body: { logId, event: body },
      });
    }

    function listen(type: string) {
      const messages: StreamMessage[] = [];
      const stream = target.openStream(
        `${BASE}/log/stream?code=${CONTRACT_CODE}`,
      );
      stream.addEventListener(type, (message) => messages.push(message));
      return { messages, stream };
    }

    async function until(check: () => boolean): Promise<void> {
      for (let i = 0; i < 200 && !check(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    it("starts with an empty log of no format", async () => {
      expect(await head()).toMatchObject({
        formatVersion: null,
        lastSeq: 0,
        ids: [],
      });
    });

    it("appends only at lastSeq + 1, and answers a known id with its seq", async () => {
      const { logId } = await head();
      expect(await post(logId, event(1))).toEqual({
        status: 201,
        body: { seq: 1 },
      });
      expect(await post(logId, event(1, "late"))).toEqual({
        status: 409,
        body: { logId, lastSeq: 1 },
      });
      expect(await post(logId, event(1))).toEqual({
        status: 201,
        body: { seq: 1 },
      });
      expect((await call("/log/events?after=0")).body).toEqual([event(1)]);
    });

    it("refuses an append to another log, and a wrong pairing code", async () => {
      expect((await post("other-log", event(1))).status).toBe(409);
      expect((await call("/log", { code: "WRONG234" })).status).toBe(401);
    });

    it("lists ids in seq order and sends appended events with their seq as id", async () => {
      const { logId } = await head();
      const { messages, stream } = listen("appended");
      await post(logId, event(1, "b"));
      await post(logId, event(2, "a"));
      await until(() => messages.length === 2);
      stream.close();
      expect((await head()).ids).toEqual(["b", "a"]);
      expect(messages.map((m) => m.lastEventId)).toEqual(["1", "2"]);
      expect(JSON.parse(String(messages[1]?.data))).toEqual(event(2, "a"));
    });

    it("replaces the log only from the current one, minting a new log and announcing it", async () => {
      const { logId } = await head();
      const { messages, stream } = listen("log");
      await until(() => messages.length === 1);
      expect(
        (
          await call("/log", {
            method: "PUT",
            body: {
              ifLogId: "other-log",
              formatVersion: 1,
              events: [],
              device: "iPad 1",
              reason: "newFest",
            },
          })
        ).status,
      ).toBe(409);

      const replaced = await call("/log", {
        method: "PUT",
        body: {
          ifLogId: logId,
          formatVersion: 1,
          events: [event(1)],
          device: "iPad 1",
          reason: "import",
        },
      });
      expect(replaced.status).toBe(200);
      const newLogId = (replaced.body as { logId: string }).logId;
      expect(newLogId).not.toBe(logId);
      await until(() => messages.length === 2);
      stream.close();
      expect(JSON.parse(String(messages[1]?.data))).toEqual({
        logId: newLogId,
        previousLogId: logId,
        lastSeq: 1,
        device: "iPad 1",
        reason: "import",
      });
      expect(await head()).toMatchObject({ formatVersion: 1, lastSeq: 1 });
    });

    it.runIf(name === "the real server")(
      "archives the replaced log as a file this app can import",
      async () => {
        const { logId } = await head();
        await post(logId, event(1));
        await call("/log", {
          method: "PUT",
          body: {
            ifLogId: logId,
            formatVersion: 1,
            events: [],
            device: "iPad 1",
            reason: "newFest",
          },
        });
        const archives = target.archives?.() ?? [];
        expect(archives).toHaveLength(1);
        // The archive of a log that only ever got appends keeps a null format, so check with 1.
        const file = { ...(archives[0] as object), formatVersion: 1 };
        expect(readImportFile(file)).toEqual([event(1)]);
      },
    );
  });
}
