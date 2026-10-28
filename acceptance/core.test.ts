import { it } from "vitest";
import { coreWindow } from "./core-driver";
import { scenarios } from "./scenario";
import "./scenarios/handover";
import "./scenarios/hand-on";
import "./scenarios/cancel-and-sold-out";

for (const { name, run } of scenarios()) {
  it(name, () => run(coreWindow()));
}
