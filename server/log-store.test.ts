import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLogStore } from "./log-store.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "kirbe-store-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("openLogStore", () => {
  it("writes with synchronous=FULL, so no acknowledged append is lost to a pulled plug", () => {
    // server-sync 05: pulling the plug is allowed
    const store = openLogStore(join(dataDir, "kirbe.sqlite"));

    expect(store.synchronous()).toBe(2);
    store.close();
  });
});
