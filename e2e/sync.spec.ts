import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { boardRow, gerufenLine, longPress, openApp, takeOrder } from "./window";

// The flows share the one real sync server, so they run one after another.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const SERVER = "https://localhost:8443";
const ADDRESS = "localhost:8443";
const CODE = "KIRBE234";
const BRIDGE = "http://127.0.0.1:9186";

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
  expect((await request.put(`${BRIDGE}/fake`, { data: {} })).status()).toBe(
    200,
  );
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

test("a Küchenanzeige shows only the waiting plates of its Auswahl", async ({
  browser,
}) => {
  const window = await ipad(browser);
  await connect(window, "Annahme");
  await connectedAs(window, "Annahme");
  await closeVerwaltung(window);
  await takeOrder(window, { Flammkuchen: 2, Braten: 1 }, 7);

  const kitchen = await ipad(browser);
  await connect(kitchen, "Küche");
  await connectedAs(kitchen, "Küche");
  const verwaltung = kitchen.getByRole("region", { name: "Verwaltung" });
  await verwaltung.getByRole("button", { name: "Küchenanzeige…" }).click();
  const auswahl = kitchen.getByRole("dialog", {
    name: "Auswahl für die Küchenanzeige",
  });
  await auswahl
    .getByRole("button", { name: "Flammkuchen", exact: true })
    .click();
  await auswahl.getByRole("button", { name: "Flammkuchen Veggie" }).click();
  await auswahl.getByRole("button", { name: "Küchenanzeige zeigen" }).click();

  const display = kitchen.getByTestId("kitchen-display");
  const flammkuchen = display.getByRole("group", {
    name: "Flammkuchen",
    exact: true,
  });
  await expect(flammkuchen).toHaveText("2Flammkuchen");
  await expect(
    display.getByRole("group", { name: "Flammkuchen Veggie" }),
  ).toHaveText("0Flammkuchen Veggie");
  await expect(display).not.toContainText("Braten");
  await expect(
    kitchen.getByRole("button", { name: /Neue Bestellung/ }),
  ).toHaveCount(0);

  await takeOrder(window, { Flammkuchen: 1 }, 8);
  await expect(flammkuchen).toHaveText("3Flammkuchen");

  await kitchen.reload();
  await expect(flammkuchen).toHaveText("3Flammkuchen", { timeout: 40_000 });

  await kitchen.context().setOffline(true);
  await kitchen.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const stale = kitchen.getByRole("alert");
  await expect(stale).toHaveText("Keine Verbindung – Zahlen veraltet", {
    timeout: 40_000,
  });
  await kitchen.context().setOffline(false);
  await expect(stale).toBeHidden({ timeout: 40_000 });

  await longPress(kitchen, "Küchenanzeige (lange drücken)");
  await kitchen
    .getByRole("dialog", { name: "Küchenanzeige" })
    .getByRole("button", { name: "Küchenanzeige beenden" })
    .click();
  await expect(
    kitchen.getByRole("button", { name: /^\+ Neue Bestellung/ }),
  ).toBeVisible();
  await connectedAs(kitchen, "Küche");
});

test("Testruf calls a pager from the Verwaltung and records nothing", async ({
  browser,
  request,
}) => {
  // #26
  const page = await ipad(browser);
  await connect(page, "Annahme");
  await connectedAs(page, "Annahme");
  const verwaltung = page.getByRole("region", { name: "Verwaltung" });
  const sender = verwaltung.getByRole("region", { name: "Sender" });
  await expect(sender).toContainText("Sender verbunden");

  await sender.getByLabel("Testruf an Pager").fill("21");
  await sender.getByRole("button", { name: "Rufen" }).click();
  await expect(page.getByRole("status")).toContainText("Pager 21 gerufen");
  // The short toast goes away by itself.
  await expect(page.getByRole("status")).not.toContainText("Pager 21 gerufen");

  await request.put(`${BRIDGE}/fake`, { data: { result: "failed" } });
  await sender.getByRole("button", { name: "Rufen" }).click();
  const failed = page.getByRole("status");
  await expect(failed).toContainText("Pager 21 nicht gerufen");
  await page.waitForTimeout(5_000);
  await expect(failed).toContainText("Pager 21 nicht gerufen");

  await request.put(`${BRIDGE}/fake`, { data: { result: "ok" } });
  await failed.getByRole("button", { name: "Erneut senden" }).click();
  await expect(failed).toContainText("Pager 21 gerufen");
  await expect(failed).not.toContainText("nicht gerufen");
  const bridge = (await (await request.get(`${BRIDGE}/fake`)).json()) as {
    calls: number[];
  };
  expect(bridge.calls).toEqual([21]);

  await request.put(`${BRIDGE}/fake`, {
    data: { connected: false, result: "notConnected" },
  });
  await expect(sender).toContainText("Sender nicht verbunden", {
    timeout: 10_000,
  });
  await sender.getByLabel("Testruf an Pager").fill("7");
  await sender.getByRole("button", { name: "Rufen" }).click();
  const byHand = "Sender nicht verbunden – Pager 7 von Hand rufen";
  await expect(page.getByRole("status")).toContainText(byHand);
  await page.getByRole("button", { name: `${byHand} – schließen` }).click();
  await expect(page.getByRole("status")).not.toContainText(byHand);

  await expect(verwaltung).toContainText("Ereignisse im Protokoll: 0");
});

test("buzz, re-buzz and hand on call the pager of the order the plate is now with", async ({
  browser,
  request,
}) => {
  // #27
  async function bridgeCalls(): Promise<number[]> {
    const fake = (await (await request.get(`${BRIDGE}/fake`)).json()) as {
      calls: number[];
    };
    return fake.calls;
  }
  const page = await ipad(browser);
  await connect(page, "Annahme");
  await connectedAs(page, "Annahme");
  await closeVerwaltung(page);
  await takeOrder(page, { Braten: 1 }, 12);
  await takeOrder(page, { Braten: 1 }, 5);
  await takeOrder(page, { Pommes: 3 }, 9);
  expect(await bridgeCalls()).toEqual([]);

  await boardRow(page, "Braten")
    .getByRole("button", { name: "Pager 12 rufen" })
    .click();
  await expect(page.getByRole("status")).toContainText("Pager 12 gerufen");
  await boardRow(page, "Pommes")
    .getByRole("button", { name: "Alle 3" })
    .click();
  await expect(page.getByRole("status")).toContainText("Pager 9 gerufen");
  await gerufenLine(page, 12, "Braten")
    .getByRole("button", { name: "Nochmal rufen" })
    .click();
  await expect.poll(bridgeCalls).toEqual([12, 9, 12]);

  await gerufenLine(page, 12, "Braten")
    .getByRole("button", { name: "Ausgeben…" })
    .click();
  await page
    .getByRole("dialog", { name: "Pager 12" })
    .getByRole("button", { name: "Etwas stimmt nicht …" })
    .click();
  await page
    .getByRole("dialog", { name: "Pager 12 — etwas stimmt nicht" })
    .getByRole("button", { name: /Braten weitergeben/ })
    .click();
  await expect(page.getByRole("status")).toContainText("Pager 5 gerufen");
  await expect.poll(bridgeCalls).toEqual([12, 9, 12, 5]);
  await page
    .getByRole("dialog", { name: "Pager 12 — etwas stimmt nicht" })
    .getByRole("button", { name: "Fenster schließen" })
    .click();
  await page
    .getByRole("dialog", { name: "Pager 12" })
    .getByRole("button", { name: "Schließen", exact: true })
    .click();

  await header(page)
    .getByRole("button", { name: /Rückgängig/ })
    .click();
  await expect(page.getByRole("status")).toContainText("Rückgängig:");
  await expect(gerufenLine(page, 12, "Braten")).toBeVisible();
  expect(await bridgeCalls()).toEqual([12, 9, 12, 5]);

  // A failed call stays, naming the pager, until resent or tapped away.
  await request.put(`${BRIDGE}/fake`, { data: { result: "failed" } });
  await gerufenLine(page, 12, "Braten")
    .getByRole("button", { name: "Nochmal rufen" })
    .click();
  const failed = page.getByRole("status");
  await expect(failed).toContainText("Pager 12 nicht gerufen");
  await request.put(`${BRIDGE}/fake`, { data: { result: "ok" } });
  await failed.getByRole("button", { name: "Erneut senden" }).click();
  await expect(failed).not.toContainText("nicht gerufen");
  await expect.poll(bridgeCalls).toEqual([12]);
  await expect(header(page)).not.toContainText("Sender getrennt");

  await request.put(`${BRIDGE}/fake`, {
    data: { connected: false, result: "notConnected" },
  });
  await expect(header(page)).toContainText("Sender getrennt", {
    timeout: 10_000,
  });
  await request.put(`${BRIDGE}/fake`, { data: {} });
  await expect(header(page)).not.toContainText("Sender getrennt", {
    timeout: 10_000,
  });
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
