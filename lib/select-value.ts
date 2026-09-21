/**
 * Keeps a select's value inside the list it is chosen from.
 *
 * Base UI resolves a trigger's label by finding the selected value among the
 * options and, when it is missing, falls back to printing the value itself —
 * so a stale selection renders as a bare `dom_x7fK…` where a domain name
 * should be. That is not a display bug to paper over in the trigger: it is the
 * correct symptom of a value that no longer refers to anything on offer, and
 * the fix belongs where the value is chosen.
 *
 * Two ways a selection goes stale, both of which have bitten this codebase:
 *
 *  - the initial value is taken from a **wider list** than the options — an
 *    address picked from every address, offered from only the unbound ones;
 *  - the options **shrink underneath it**, which is what binding an address
 *    does to the list of addresses still available to bind.
 *
 * Falling back to the first remaining option keeps the control usable rather
 * than leaving it empty, and means the label is always a label.
 */
export function keepWithin<T extends { id: string }>(
  value: string,
  options: readonly T[],
): string {
  return options.some((option) => option.id === value)
    ? value
    : (options[0]?.id ?? '');
}
