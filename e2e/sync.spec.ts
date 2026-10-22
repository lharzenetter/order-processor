import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { longPress, openApp, takeOrder } from "./window";

// The flows share the one real sync server, so they run one after another.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const SERVER = "https://localhost:8443";
const ADDRESS = "localhost:8443";
const CODE = "KIRBE234";

// Between flows the server starts a fresh, empty log; there is no test-only endpoint.
test.beforeEach(async ({ request }) => {
  const headers = { "X-Pairing-Code": CODE };
  const head = (await (
    await request.get(`${SERVER}/log`, { headers })
  ).json()) as { logId: string };
  const reset = await request.put(`${SERVER}/log`, {
    headers,
    data: {
      ifLogId: head.logId,
      formatVersion: 1,
      events: [],
      device: "e2e",
      reason: "push",
    },
  });
  expect(reset.status()).toBe(200);
});

async function ipad(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openApp(page);
  return page;
}

function header(page: Page) {
  return page.getByRole("banner");
}

async function openVerwaltung(page: Page) {
  await header(page).getByRole("button", { name: "Verwaltung" }).click();
  return page.getByRole("region", { name: "Verwaltung" });
}

async function connect(page: Page, deviceName: string): Promise<void> {
  const verwaltung = await openVerwaltung(page);
  const server = verwaltung.getByRole("region", { name: "Server" });
  await server.getByLabel("Adresse").fill(ADDRESS);
  await server.getByLabel("Kopplungscode").fill(CODE);
  await server.getByLabel("Gerätename").fill(deviceName);
  await server.getByRole("button", { name: "Verbinden" }).click();
}

async function closeVerwaltung(page: Page): Promise<void> {
  await page.getByRole("button", { name: "← Zurück" }).click();
}

async function disconnect(page: Page): Promise<void> {
  const verwaltung = await openVerwaltung(page);
  await verwaltung.getByRole("button", { name: "Trennen" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Getrennt — dieses iPad arbeitet eigenständig weiter",
  );
  await closeVerwaltung(page);
}

function connectedAs(page: Page, deviceName: string) {
  return expect(header(page)).toContainText(`● Verbunden als ${deviceName}`, {
    timeout: 40_000,
  });
}

test("connect and share a log", async ({ browser }) => {
  const first = await ipad(browser);
  await takeOrder(first, { Braten: 1 }, 7);
  await connect(first, "iPad 1");
  const empty = first.getByRole("dialog", { name: "Server ist leer" });
  await expect(empty).toContainText("Dieses iPad hat 1 Ereignisse");
  await empty.getByRole("button", { name: "Hochladen und verbinden" }).click();
  await connectedAs(first, "iPad 1");
  await closeVerwaltung(first);

  const second = await ipad(browser);
  await connect(second, "iPad 2");
  await connectedAs(second, "iPad 2");
  await closeVerwaltung(second);
  await expect(second.getByText("1 offen · 29 Pager frei")).toBeVisible();

  await takeOrder(second, { Pommes: 1 }, 9);
  await expect(first.getByText("2 offen · 28 Pager frei")).toBeVisible();
  for (const page of [first, second]) {
    await expect(
      header(page).getByRole("button", { name: /Rückgängig/ }),
    ).toContainText("Neue Bestellung 1× Pommes → Pager 9 (iPad 2)");
  }

  await first.reload();
  await connectedAs(first, "iPad 1");
  await expect(first.getByText("2 offen · 28 Pager frei")).toBeVisible();
});

test("lost connection", async ({ browser }) => {
  const first = await ipad(browser);
  await connect(first, "iPad 1");
  await connectedAs(first, "iPad 1");
  await closeVerwaltung(first);
  const second = await ipad(browser);
  await connect(second, "iPad 2");
  await connectedAs(second, "iPad 2");
  await closeVerwaltung(second);

  await second.context().setOffline(true);
  // Offline emulation leaves an open stream alone; the iPad coming back from sleep reconnects.
  await second.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    second
      .getByRole("alert")
      .filter({ hasText: "Keine Verbindung zum Server" }),
  ).toContainText("Tippen gesperrt", { timeout: 40_000 });
  await expect(header(second)).toContainText("○ Keine Verbindung");
  await expect(second.getByTestId("board")).toHaveAttribute("inert");

  await takeOrder(first, { Braten: 1 }, 7);
  await second.context().setOffline(false);
  await connectedAs(second, "iPad 2");
  await expect(second.getByText("1 offen · 29 Pager frei")).toBeVisible();
  await expect(second.getByTestId("board")).not.toHaveAttribute("inert");
});

test("standalone fallback and recovery", async ({ browser }) => {
  const first = await ipad(browser);
  await connect(first, "iPad 1");
  await connectedAs(first, "iPad 1");
  await closeVerwaltung(first);
  const second = await ipad(browser);
  await connect(second, "iPad 2");
  await connectedAs(second, "iPad 2");
  await closeVerwaltung(second);

  await disconnect(second);
  await expect(header(second)).toContainText("Eigenständig");
  await takeOrder(second, { Braten: 1 }, 7);
  await takeOrder(second, { Pommes: 1 }, 8);

  await connect(second, "iPad 2");
  await connectedAs(second, "iPad 2");
  await expect(first.getByText("2 offen · 28 Pager frei")).toBeVisible();
});

test("following a replacement", async ({ browser }) => {
  const first = await ipad(browser);
  await connect(first, "iPad 1");
  await connectedAs(first, "iPad 1");
  await closeVerwaltung(first);
  await takeOrder(first, { Braten: 1 }, 7);
  const second = await ipad(browser);
  await connect(second, "iPad 2");
  await connectedAs(second, "iPad 2");
  await closeVerwaltung(second);
  await expect(second.getByText("1 offen · 29 Pager frei")).toBeVisible();

  const verwaltung = await openVerwaltung(first);
  await verwaltung.getByRole("button", { name: "Neues Fest starten…" }).click();
  await longPress(first, "Ohne Export leeren (lange drücken)");
  await expect(first.getByRole("status")).toContainText("Neues Fest gestartet");

  await expect(second.getByRole("status")).toContainText(
    "Neues Fest auf „iPad 1“ gestartet",
  );
  await expect(second.getByText("0 offen · 30 Pager frei")).toBeVisible();
  await connectedAs(second, "iPad 2");
});

test("an iPad holding events the server never saw must export first", async ({
  browser,
}) => {
  const first = await ipad(browser);
  await connect(first, "iPad 1");
  await connectedAs(first, "iPad 1");
  await closeVerwaltung(first);
  const second = await ipad(browser);
  await connect(second, "iPad 2");
  await connectedAs(second, "iPad 2");
  await closeVerwaltung(second);

  await disconnect(second);
  await takeOrder(second, { Braten: 1 }, 7);
  const verwaltung = await openVerwaltung(first);
  await verwaltung.getByRole("button", { name: "Neues Fest starten…" }).click();
  await longPress(first, "Ohne Export leeren (lange drücken)");

  await connect(second, "iPad 2");
  const diverged = second.getByRole("dialog", {
    name: "Anderes Protokoll auf dem Server",
  });
  await expect(diverged).toBeVisible();
  const replace = diverged.getByRole("button", {
    name: "2. Durch Server-Protokoll ersetzen",
  });
  await expect(replace).toBeDisabled();
  const download = second.waitForEvent("download");
  await diverged.getByRole("button", { name: "1. Exportieren" }).click();
  await download;
  await expect(
    diverged.getByRole("button", { name: "✓ Exportiert" }),
  ).toBeVisible();
  await replace.click();
  await connectedAs(second, "iPad 2");
  await closeVerwaltung(second);
  await expect(second.getByText("0 offen · 30 Pager frei")).toBeVisible();
});

test("standalone never reaches beyond this machine", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (request) => {
    hosts.add(new URL(request.url()).hostname);
  });
  await openApp(page);
  await takeOrder(page, { Braten: 1 }, 7);
  await expect(header(page)).toContainText("Eigenständig");
  expect([...hosts]).toEqual(["localhost"]);
});
