/** Joins the class names that apply; CSS Module lookups may be undefined. */
export function cx(
  ...names: readonly (string | false | null | undefined)[]
): string {
  return names.filter(Boolean).join(" ");
}
