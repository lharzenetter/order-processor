import { platesText } from "../core/index";
import type { OrderView } from "../core/index";

/** The line above the order popup's main button: whether the pager comes back with this handover. */
export function handoverConsequence(
  view: OrderView,
  take: Readonly<Record<string, number>>,
): string {
  const left = view.lines.flatMap((line) => {
    const count = line.buzzed + line.waiting - (take[line.productId] ?? 0);
    return count > 0 ? [{ productId: line.productId, count }] : [];
  });
  const pager = `Pager ${String(view.pager)}`;
  return left.length === 0
    ? `Danach ${pager} zurücknehmen.`
    : `Danach bleibt ${pager} beim Gast – ${platesText(left)} noch offen.`;
}
