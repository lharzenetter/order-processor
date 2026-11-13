// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TransmitterSection } from "./TransmitterSection";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function render(openOrders: number): void {
  act(() => {
    root.render(
      <TransmitterSection
        connected={true}
        onTestCall={() => Promise.resolve()}
        openOrders={openOrders}
        onGroupCall={() => Promise.resolve()}
        onPowerOff={() => Promise.resolve()}
        pagerCallsOn={false}
        switchEnabled={true}
        onSwitchPagerCalls={() => undefined}
      />,
    );
  });
}

function tap(label: string): void {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) {
    throw new Error(`no button ${label}`);
  }
  act(() => {
    button.click();
  });
}

function confirmation(): string | null {
  return container.querySelector("dialog p")?.textContent ?? null;
}

// #33
it("keeps the group call's question as tapped while another iPad closes and opens orders", () => {
  render(2);
  tap("Alle Pager rufen");
  const asked = "2 Bestellungen noch offen. Trotzdem alle Pager rufen?";
  expect(confirmation()).toBe(asked);

  render(0);
  expect(confirmation()).toBe(asked);

  render(1);
  expect(confirmation()).toBe(asked);
});
