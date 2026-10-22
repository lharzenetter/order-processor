import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Starts the real sync server for the e2e flows on https://localhost:8443, with a throwaway
// self-signed certificate and a fresh data directory. It runs as Playwright's webServer, which
// starts before any globalSetup, so the certificate is written here.
const dir = mkdtempSync(join(tmpdir(), "kirbe-e2e-"));
const cert = join(dir, "localhost.crt");
const key = join(dir, "localhost.key");
execFileSync("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-days",
  "30",
  "-subj",
  "/CN=localhost",
  "-addext",
  "subjectAltName=DNS:localhost",
  "-keyout",
  key,
  "-out",
  cert,
]);

process.env.PAIRING_CODE = "KIRBE234";
process.env.ALLOWED_ORIGIN = "http://localhost:4173";
process.env.CERT_FILE = cert;
process.env.KEY_FILE = key;
process.env.DATA_DIR = join(dir, "data");
process.env.PORT = "8443";

await import("../server/main.ts");
