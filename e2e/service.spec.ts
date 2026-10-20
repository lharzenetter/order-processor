import { expect, test } from "@playwright/test";
import { boardRow, gerufenLine, openApp, takeOrder } from "./window";

test("take an order, buzz it, hand it over and take the pager back", async ({
  page,
}) => {
  await openApp(page);
  await takeOrder(page, { Braten: 1, Pommes: 1 }, 7);
  await expect(page.getByText("1 offen · 29 Pager frei")).toBeVisible();

  await boardRow(page, "Braten")
    .getByRole("button", { name: "Pager 7 rufen" })
    .click();
  await boardRow(page, "Pommes")
    .getByRole("button", { name: "Pager 7 rufen" })
    .click();
  await expect(gerufenLine(page, 7, "Braten")).toBeVisible();

  await gerufenLine(page, 7, "Braten")
    .getByRole("button", { name: "1 Teller ausgeben" })
    .click();
  const remaining = page.getByRole("dialog", { name: "Pager 7" });
  await expect(remaining).toContainText(
    "Pager 7 bleibt beim Gast — noch offen:",
  );
  await remaining.getByRole("button", { name: "1 Teller ausgeben" }).click();

  const pagerBack = page.getByRole("dialog", { name: "Pager 7 zurücknehmen" });
  await expect(pagerBack).toBeVisible();
  await pagerBack.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("0 offen · 30 Pager frei")).toBeVisible();
});

test("a partial pickup keeps the pager with the guest", async ({ page }) => {
  await openApp(page);
  await takeOrder(page, { Braten: 2 }, 12);
  await boardRow(page, "Braten")
    .getByRole("button", { name: "Pager 12 rufen" })
    .click();
  await expect(boardRow(page, "Braten")).toContainText("1/2");

  await page.getByRole("button", { name: /^Gast zeigt Pager …/ }).click();
  const keypad = page.getByRole("dialog", { name: "Ausgabe — Pager-Nummer" });
  await keypad.getByRole("button", { name: "Ziffer 1" }).click();
  await keypad.getByRole("button", { name: "Ziffer 2" }).click();
  await keypad.getByRole("button", { name: "Bestellung zeigen" }).click();

  const order = page.getByRole("dialog", { name: "Pager 12" });
  await expect(order.getByRole("group", { name: "Braten" })).toContainText(
    "1 gerufen",
  );
  await order.getByRole("button", { name: "1 Teller ausgeben" }).click();

  await expect(order).toContainText("Pager 12 bleibt beim Gast — noch offen:");
  await expect(order.getByRole("group", { name: "Braten" })).toContainText(
    "1 wartet",
  );
  await order.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(page.getByText("1 offen · 29 Pager frei")).toBeVisible();
});

test("a reload keeps the open orders", async ({ page }) => {
  await openApp(page);
  await takeOrder(page, { Maultaschen: 1 }, 3);
  await takeOrder(page, { Maultaschen: 2 }, 9);
  await boardRow(page, "Maultaschen")
    .getByRole("button", { name: "Pager 3 rufen" })
    .click();
  // Shown only once it is stored.
  await expect(gerufenLine(page, 3, "Maultaschen")).toBeVisible();

  await page.reload();
  await expect(page.getByText("2 offen · 28 Pager frei")).toBeVisible();
  await expect(gerufenLine(page, 3, "Maultaschen")).toBeVisible();
  await expect(boardRow(page, "Maultaschen")).toContainText("0/2");
});

test("Rückgängig reverts the last action and names it", async ({ page }) => {
  await openApp(page);
  await takeOrder(page, { Schäufele: 1 }, 5);
  await boardRow(page, "Schäufele")
    .getByRole("button", { name: "Pager 5 rufen" })
    .click();

  const undo = page.getByRole("button", { name: /Rückgängig/ });
  await expect(undo).toContainText("Schäufele gerufen → Pager 5");
  await undo.click();
  await expect(page.getByRole("status")).toContainText(
    "Rückgängig: Schäufele gerufen → Pager 5",
  );
  await expect(gerufenLine(page, 5, "Schäufele")).toBeHidden();
  await expect(boardRow(page, "Schäufele")).toContainText("0/1");

  await undo.click();
  await expect(page.getByText("0 offen · 30 Pager frei")).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(undo).toContainText("nichts rückgängig zu machen");
});

// GitHub issue #1: on the window iPad the create button was cut off below the pager quick-taps.
test("the create button stays on screen in the intake", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: /^\+ Neue Bestellung/ }).click();
  const intake = page.getByRole("dialog", { name: "Neue Bestellung" });
  // A missing pager adds the Fehlend line, the tallest the pager column gets.
  await intake.getByRole("button", { name: "Pager fehlt…" }).click();
  await intake
    .getByRole("button", { name: "Pager 30 als fehlend markieren" })
    .click();
  await intake.getByRole("button", { name: "Fertig" }).click();

  await expect(
    intake.getByRole("button", { name: /^Bestellung anlegen/ }),
  ).toBeInViewport({ ratio: 1 });
});

// GitHub issue #1: when the dialog has to scroll, the create button stays pinned at its bottom.
test("the create button stays pinned when the intake scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 480 });
  await openApp(page);
  await page.getByRole("button", { name: /^\+ Neue Bestellung/ }).click();
  const intake = page.getByRole("dialog", { name: "Neue Bestellung" });
  const create = intake.getByRole("button", { name: /^Bestellung anlegen/ });
  await expect(
    intake.getByRole("button", { name: "Pager 30" }),
  ).not.toBeInViewport();
  await expect(create).toBeInViewport({ ratio: 1 });

  await intake
    .getByRole("button", { name: "Pager 30" })
    .scrollIntoViewIfNeeded();
  await expect(create).toBeInViewport({ ratio: 1 });
});

test("a pager with the guest can't be picked in the intake", async ({
  page,
}) => {
  await openApp(page);
  await takeOrder(page, { Pommes: 1 }, 7);
  await page.getByRole("button", { name: /^\+ Neue Bestellung/ }).click();
  const intake = page.getByRole("dialog", { name: "Neue Bestellung" });
  await expect(
    intake.getByRole("button", { name: "Pager 7, beim Gast" }),
  ).toBeDisabled();
  await expect(
    intake.getByRole("button", { name: "Pager 8", exact: true }),
  ).toBeEnabled();
});
