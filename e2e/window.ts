import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Headless Chromium has no Share sheet; the export then falls back to a download.
export async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined });
  });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: /^\+ Neue Bestellung/ }),
  ).toBeVisible();
}

export async function takeOrder(
  page: Page,
  plates: Readonly<Record<string, number>>,
  pager: number,
): Promise<void> {
  await page.getByRole("button", { name: /^\+ Neue Bestellung/ }).click();
  const intake = page.getByRole("dialog", { name: "Neue Bestellung" });
  for (const [label, count] of Object.entries(plates)) {
    for (let i = 0; i < count; i++) {
      await intake
        .getByRole("button", { name: new RegExp(`^${label}`) })
        .first()
        .click();
    }
  }
  for (const digit of String(pager)) {
    await intake.getByRole("button", { name: `Ziffer ${digit}` }).click();
  }
  const total = Object.values(plates).reduce((a, b) => a + b, 0);
  await intake
    .getByRole("button", {
      name: `Bestellung anlegen · ${String(total)} Teller · Pager ${String(pager)}`,
    })
    .click();
  await expect(intake).toBeHidden();
  await expect(page.getByRole("status")).toContainText(
    `Bestellung auf Pager ${String(pager)}`,
  );
}

export function boardRow(page: Page, label: string) {
  return page.getByRole("row", { name: label, exact: true });
}

export function gerufenLine(page: Page, pager: number, label: string) {
  return page
    .getByRole("region", { name: "Gerufen" })
    .getByRole("group", { name: `Pager ${String(pager)} ${label}` });
}

// The guarded buttons fire only after being held.
export async function longPress(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name }).hover();
  await page.mouse.down();
  await page.waitForTimeout(1_800);
  await page.mouse.up();
}
