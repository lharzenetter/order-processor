import { platesText } from "../core/index";
import type { PlateCount } from "../core/index";

/** The order popup's main button: the plates themselves, so staff check them before they go out. */
export function handOverLabel(plates: readonly PlateCount[]): string {
  return plates.length === 0 ? "Ausgeben" : `${platesText(plates)} ausgeben`;
}

/** Opens the note after a handover, since the popup that follows no longer lists those plates. */
export function handedOverText(plates: readonly PlateCount[]): string {
  return `Ausgegeben: ${platesText(plates)}.`;
}
