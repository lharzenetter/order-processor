import { it } from "vitest";
import { coreWindow } from "./core-driver";
import { scenarios } from "./scenario";
import "./scenarios/handover";
import "./scenarios/hand-on";
import "./scenarios/cancel-and-sold-out";
import "./scenarios/abandoned-order";
import "./scenarios/undo";
import "./scenarios/reporting";
import "./scenarios/pager-calls";

for (const { name, run } of scenarios()) {
  it(name, () => run(coreWindow()));
}
