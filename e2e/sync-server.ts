import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Starts the real sync server for the e2e flows on https://localhost:8443, with a throwaway
// certificate and a fresh data directory. It runs as Playwright's webServer, which starts before
// any globalSetup, so the certificate is written here. `pnpm sync-server` runs it for testing by
// hand.
const dir = mkdtempSync(join(tmpdir(), "kirbe-e2e-"));
const cert = join(dir, "localhost.crt");
const key = join(dir, "localhost.key");

function hasMkcert(): boolean {
  try {
    execFileSync("mkcert", ["-help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// mkcert signs with a CA this machine trusts, so a browser connects without a warning; Safari
// offers no way past a self-signed one. CI has no mkcert and ignores HTTPS errors anyway.
if (hasMkcert()) {
  execFileSync("mkcert", ["-cert-file", cert, "-key-file", key, "localhost"], {
    stdio: "ignore",
  });
} else {
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
}

process.env.PAIRING_CODE = "KIRBE234";
process.env.ALLOWED_ORIGIN = "http://localhost:4173";
process.env.CERT_FILE = cert;
process.env.KEY_FILE = key;
process.env.DATA_DIR = join(dir, "data");
process.env.PORT = "8443";

await import("../server/main.ts");
