import { expect, test } from "@playwright/test";
import { longPress, openApp, takeOrder } from "./window";

test("Neues Fest starten clears only after an export or a long press", async ({
  page,
}) => {
  await openApp(page);
  await takeOrder(page, { Pommes: 1 }, 4);
  await page.getByRole("button", { name: "Verwaltung" }).click();
  const verwaltung = page.getByRole("region", { name: "Verwaltung" });
  await expect(verwaltung).toContainText("Letzter Export: noch nie");

  await verwaltung.getByRole("button", { name: "Neues Fest starten…" }).click();
  const guard = page.getByRole("dialog", { name: "Neues Fest starten" });
  await expect(guard).toContainText("1 Ereignisse, 1 offene Bestellungen");
  // A plain tap does nothing.
  await guard.getByRole("button", { name: /Ohne Export leeren/ }).click();
  await expect(guard).toBeVisible();

  const download = page.waitForEvent("download");
  await guard.getByRole("button", { name: "Exportieren und leeren" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^kirbe-pager-.*\.json$/,
  );
  await expect(guard).toBeHidden();
  await verwaltung.getByRole("button", { name: "← Zurück" }).click();
  await expect(page.getByText("0 offen · 30 Pager frei")).toBeVisible();

  await takeOrder(page, { Pommes: 1 }, 6);
  await page.getByRole("button", { name: "Verwaltung" }).click();
  await verwaltung.getByRole("button", { name: "Neues Fest starten…" }).click();
  await longPress(page, "Ohne Export leeren (lange drücken)");
  await expect(guard).toBeHidden();
  await verwaltung.getByRole("button", { name: "← Zurück" }).click();
  await expect(page.getByText("0 offen · 30 Pager frei")).toBeVisible();
});

test("Importieren replaces the log from an export, guarded", async ({
  page,
}, testInfo) => {
  await openApp(page);
  await takeOrder(page, { Fleischkäs: 2 }, 17);
  await page.getByRole("button", { name: "Verwaltung" }).click();
  const verwaltung = page.getByRole("region", { name: "Verwaltung" });
  const download = page.waitForEvent("download");
  await verwaltung.getByRole("button", { name: /Exportieren/ }).click();
  const exported = testInfo.outputPath("export.json");
  await (await download).saveAs(exported);
  await expect(verwaltung).not.toContainText("noch nie");

  await verwaltung.getByRole("button", { name: "Neues Fest starten…" }).click();
  await longPress(page, "Ohne Export leeren (lange drücken)");
  await verwaltung.getByRole("button", { name: "← Zurück" }).click();
  await takeOrder(page, { Pommes: 1 }, 2);

  await page.getByRole("button", { name: "Verwaltung" }).click();
  await verwaltung.getByLabel("Export-Datei wählen").setInputFiles(exported);
  const guard = page.getByRole("dialog", { name: "Importieren" });
  await expect(guard).toContainText("Ersetzt 1 Ereignisse");
  await longPress(page, "Ohne Export importieren (lange drücken)");
  await expect(guard).toBeHidden();
  await verwaltung.getByRole("button", { name: "← Zurück" }).click();

  await expect(page.getByText("1 offen · 29 Pager frei")).toBeVisible();
  await page.getByRole("button", { name: /Ausgabe…/ }).click();
  const keypad = page.getByRole("dialog", { name: "Ausgabe — Pager-Nummer" });
  await keypad.getByRole("button", { name: "Ziffer 1" }).click();
  await keypad.getByRole("button", { name: "Ziffer 7" }).click();
  await keypad.getByRole("button", { name: "Bestellung zeigen" }).click();
  await expect(
    page.getByRole("dialog", { name: "Pager 17" }).getByRole("group", {
      name: "Fleischkäs",
    }),
  ).toContainText("2 wartet");
});

test("Importieren rejects a file it can't read and keeps the log", async ({
  page,
}) => {
  await openApp(page);
  await takeOrder(page, { Pommes: 1 }, 8);
  await page.getByRole("button", { name: "Verwaltung" }).click();
  const verwaltung = page.getByRole("region", { name: "Verwaltung" });
  await verwaltung.getByLabel("Export-Datei wählen").setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ app: "kirbe-pager", formatVersion: 99, events: [] }),
    ),
  });
  const guard = page.getByRole("dialog", { name: "Importieren" });
  await longPress(page, "Ohne Export importieren (lange drücken)");
  await expect(guard.getByRole("alert")).toContainText("Format 99");
  await guard.getByRole("button", { name: "Abbrechen" }).click();
  await verwaltung.getByRole("button", { name: "← Zurück" }).click();
  await expect(page.getByText("1 offen · 29 Pager frei")).toBeVisible();
});
