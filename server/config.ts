export interface ServerConfig {
  readonly pairingCode: string;
  readonly allowedOrigin: string;
  readonly certFile: string;
  readonly keyFile: string;
  readonly dataDir: string;
  readonly port: number;
  readonly cert: Buffer;
  readonly key: Buffer;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly problems: readonly string[] };

const MIN_PAIRING_CODE_LENGTH = 8;
const DEFAULT_PORT = 8443;
const MAX_PORT = 65_535;

function required(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  problems: string[],
): string | undefined {
  const value = env[name];
  if (value === undefined || value === "") {
    problems.push(`${name} is missing.`);
    return undefined;
  }
  return value;
}

function readable(
  name: string,
  path: string | undefined,
  readFile: (path: string) => Buffer,
  problems: string[],
): Buffer | undefined {
  if (path === undefined) return undefined;
  try {
    return readFile(path);
  } catch {
    problems.push(`${name} cannot be read: ${path}.`);
    return undefined;
  }
}

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return DEFAULT_PORT;
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= MAX_PORT ? port : undefined;
}

// Every problem is reported at once so a broken .env is fixed in one go. The pairing code's value
// never appears in a problem: the output lands in `docker compose logs`.
export function readConfig(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => Buffer,
): ConfigResult {
  const problems: string[] = [];

  const pairingCode = required(env, "PAIRING_CODE", problems);
  if (
    pairingCode !== undefined &&
    pairingCode.length < MIN_PAIRING_CODE_LENGTH
  ) {
    problems.push(
      `PAIRING_CODE is too short: it needs at least ${String(MIN_PAIRING_CODE_LENGTH)} characters.`,
    );
  }

  const allowedOrigin = required(env, "ALLOWED_ORIGIN", problems);
  if (allowedOrigin !== undefined && !isOrigin(allowedOrigin)) {
    problems.push(
      "ALLOWED_ORIGIN must be an origin like https://example.org, with no path.",
    );
  }

  const certFile = required(env, "CERT_FILE", problems);
  const keyFile = required(env, "KEY_FILE", problems);
  const dataDir = required(env, "DATA_DIR", problems);
  const cert = readable("CERT_FILE", certFile, readFile, problems);
  const key = readable("KEY_FILE", keyFile, readFile, problems);

  const port = parsePort(env.PORT);
  if (port === undefined) {
    problems.push(`PORT must be a whole number from 1 to ${String(MAX_PORT)}.`);
  }

  if (
    problems.length > 0 ||
    pairingCode === undefined ||
    allowedOrigin === undefined ||
    certFile === undefined ||
    keyFile === undefined ||
    dataDir === undefined ||
    cert === undefined ||
    key === undefined ||
    port === undefined
  ) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    config: {
      pairingCode,
      allowedOrigin,
      certFile,
      keyFile,
      dataDir,
      port,
      cert,
      key,
    },
  };
}
