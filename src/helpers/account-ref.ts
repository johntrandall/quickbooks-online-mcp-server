/**
 * Coerce a caller-supplied parent reference into the QBO reference-object
 * shape `{ value: "<id>" }` used by Account.ParentRef.
 *
 * QBO's ParentRef is a nested *reference object*, never a scalar. Earlier code
 * ran ParentRef through a scalar field-type map that called String() on it,
 * turning a `{ value: "307" }` object into the literal "[object Object]" — which
 * QBO rejected with error code 2010 ("failed to parse json object; a property
 * specified is unsupported or invalid"). This helper normalizes the accepted
 * caller forms into the one shape QBO expects.
 *
 * Accepts:
 *   - { value: "307" }  (canonical QBO reference object)
 *   - "307"             (bare string id)
 *   - 307               (numeric id)
 * Returns undefined for null/undefined so callers can skip the field.
 */
export function normalizeParentRef(value: unknown): { value: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && value !== null && "value" in (value as Record<string, unknown>)) {
    return { value: String((value as Record<string, unknown>).value) };
  }
  return { value: String(value) };
}
