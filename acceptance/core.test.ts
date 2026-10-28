import { it } from "vitest";
import { coreWindow } from "./core-driver";
import { scenarios } from "./scenario";
import "./scenarios/handover";

for (const { name, run } of scenarios()) {
  it(name, () => run(coreWindow()));
}
