/**
 * A tiny shape matcher for the JSON fixtures in tests/fixtures/.
 *   "string" | "number" | "boolean" | "null" | "object" | "array" | "any"   a type — join with | for alternatives
 *   "string?"                                                         the key may be absent
 *   { key: shape }                                                    an object that must have (at least) these keys
 *   { "$array": shape, "$min": 1 }                                    an array whose every element matches shape
 * Extra keys are allowed (the API may grow); missing or wrongly typed ones are reported with their path.
 */
export type Shape = string | { $array: Shape; $min?: number } | { [key: string]: Shape };

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

export function matchShape(value: unknown, shape: Shape, path = "$"): string[] {
  if (typeof shape === "string") {
    const optional = shape.endsWith("?");
    const types = (optional ? shape.slice(0, -1) : shape).split("|");
    if (value === undefined) return optional ? [] : [`${path}: missing`];
    return types.includes("any") || types.includes(typeOf(value)) ? [] : [`${path}: expected ${shape}, got ${typeOf(value)}`];
  }
  if ("$array" in shape) {
    const { $array: itemShape, $min: min = 0 } = shape as { $array: Shape; $min?: number };
    if (!Array.isArray(value)) return [`${path}: expected an array, got ${typeOf(value)}`];
    const errors = value.length < min ? [`${path}: expected at least ${min} item(s), got ${value.length}`] : [];
    value.forEach((item, i) => errors.push(...matchShape(item, itemShape, `${path}[${i}]`)));
    return errors;
  }
  if (typeOf(value) !== "object") return [`${path}: expected an object, got ${typeOf(value)}`];
  const errors: string[] = [];
  for (const [key, sub] of Object.entries(shape)) errors.push(...matchShape((value as Record<string, unknown>)[key], sub, `${path}.${key}`));
  return errors;
}

/** Keys that must never appear anywhere in a response (secrets, internals, other people's data). */
export function findForbiddenKeys(value: unknown, forbidden: string[], path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbiddenKeys(v, forbidden, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(forbidden.includes(k) ? [`${path}.${k}`] : []), ...findForbiddenKeys(v, forbidden, `${path}.${k}`)]);
  }
  return [];
}
