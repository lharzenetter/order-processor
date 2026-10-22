import { describe, expect, it } from "vitest";
import {
  certDaysLeft,
  deviceNameProblem,
  isServerAddress,
  serverTestText,
} from "./server-settings";

describe("the Server section's fields", () => {
  it.each([
    ["kirbe.example.de", true],
    ["localhost:8443", true],
    ["192.168.178.2", true],
    ["https://kirbe.example.de", false],
    ["http://kirbe.example.de", false],
    ["kirbe.example.de/log", false],
    ["", false],
    ["kirbe .de", false],
    ["kirbe.de:99999", false],
  ])("takes “%s” as an address: %s", (address, ok) => {
    expect(isServerAddress(address)).toBe(ok);
  });

  it.each([
    ["Annahme", null],
    ["  Annahme  ", null],
    ["   ", "Gerätename fehlt"],
    ["x".repeat(20), null],
    ["x".repeat(21), "Höchstens 20 Zeichen"],
  ])("checks the device name “%s”", (name, problem) => {
    expect(deviceNameProblem(name)).toBe(problem);
  });
});

describe("the certificate notice", () => {
  it("counts whole days left", () => {
    const day = 24 * 60 * 60_000;
    expect(certDaysLeft(10 * day + 5, 0)).toBe(10);
    expect(certDaysLeft(-1, 0)).toBe(0);
  });
});

describe("the Verbinden result", () => {
  it.each([
    [
      { kind: "unreachable" },
      "Server nicht erreichbar. Adresse, WLAN und Zertifikat prüfen.",
    ],
    [{ kind: "pairingCode" }, "Kopplungscode falsch."],
    [
      { kind: "ok", eventCount: 3, certExpiresAt: null },
      "Verbunden. Server hat 3 Ereignisse.",
    ],
  ] as const)("says %o as text", (result, text) => {
    expect(serverTestText(result)).toBe(text);
  });
});
