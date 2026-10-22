import { describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";

const READABLE_FILES: Readonly<Record<string, string>> = {
  "/certs/kirbe.crt": "CERT",
  "/certs/kirbe.key": "KEY",
};

function readFile(path: string): Buffer {
  const content = READABLE_FILES[path];
  if (content === undefined) {
    throw new Error(`ENOENT: no such file or directory, open '${path}'`);
  }
  return Buffer.from(content);
}

const VALID_ENV = {
  PAIRING_CODE: "K7XM4PQR",
  ALLOWED_ORIGIN: "https://lharzenetter.github.io",
  CERT_FILE: "/certs/kirbe.crt",
  KEY_FILE: "/certs/kirbe.key",
  DATA_DIR: "/data",
};

describe("readConfig", () => {
  it("accepts a complete environment and defaults the port to 8443", () => {
    const result = readConfig(VALID_ENV, readFile);

    expect(result).toEqual({
      ok: true,
      config: {
        pairingCode: "K7XM4PQR",
        allowedOrigin: "https://lharzenetter.github.io",
        certFile: "/certs/kirbe.crt",
        keyFile: "/certs/kirbe.key",
        dataDir: "/data",
        port: 8443,
        cert: Buffer.from("CERT"),
        key: Buffer.from("KEY"),
      },
    });
  });

  it("takes the port from PORT", () => {
    const result = readConfig({ ...VALID_ENV, PORT: "9443" }, readFile);

    expect(result.ok && result.config.port).toBe(9443);
  });

  it("refuses to start without any variable and lists every problem at once", () => {
    const result = readConfig({}, readFile);

    expect(result).toEqual({
      ok: false,
      problems: [
        "PAIRING_CODE is missing.",
        "ALLOWED_ORIGIN is missing.",
        "CERT_FILE is missing.",
        "KEY_FILE is missing.",
        "DATA_DIR is missing.",
      ],
    });
  });

  it("refuses a pairing code shorter than 8 characters without printing it", () => {
    const result = readConfig(
      { ...VALID_ENV, PAIRING_CODE: "K7XM4PQ" },
      readFile,
    );

    expect(result).toEqual({
      ok: false,
      problems: ["PAIRING_CODE is too short: it needs at least 8 characters."],
    });
    expect(JSON.stringify(result)).not.toContain("K7XM4PQ");
  });

  it("refuses unreadable cert and key files, a bad port and an origin with a path together", () => {
    const result = readConfig(
      {
        ...VALID_ENV,
        CERT_FILE: "/certs/missing.crt",
        KEY_FILE: "/certs/missing.key",
        PORT: "http",
        ALLOWED_ORIGIN: "https://lharzenetter.github.io/order-processor/",
      },
      readFile,
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        "ALLOWED_ORIGIN must be an origin like https://example.org, with no path.",
        "CERT_FILE cannot be read: /certs/missing.crt.",
        "KEY_FILE cannot be read: /certs/missing.key.",
        "PORT must be a whole number from 1 to 65535.",
      ],
    });
  });

  it("treats an empty variable as missing", () => {
    const result = readConfig({ ...VALID_ENV, DATA_DIR: "" }, readFile);

    expect(result).toEqual({ ok: false, problems: ["DATA_DIR is missing."] });
  });
});
