import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncServer } from "../server/index.ts";
import type { Fetch } from "../src/storage/index";
import { openSseStream } from "./sse-stream";
import { CONTRACT_CODE, describeSyncContract } from "./sync-contract";

describeSyncContract("the real server", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kirbe-contract-"));
  const server = createSyncServer({
    pairingCode: CONTRACT_CODE,
    allowedOrigin: "https://lharzenetter.github.io",
    dataDir,
    certExpiresAt: () => null,
    log: () => undefined,
  });
  const fetch: Fetch = (input, init) => server.handle(new Request(input, init));
  return {
    fetch,
    openStream: (url) => openSseStream(fetch, url),
    archives() {
      const dir = join(dataDir, "archive");
      return readdirSync(dir).map((file): unknown =>
        JSON.parse(readFileSync(join(dir, file), "utf8")),
      );
    },
    close() {
      server.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
});
