import { DISTRICTS, DIVISIONS, UNIONS, UPAZILAS, type Place } from "../data/bd-geo";

/**
 * Bangladesh's divisions, districts, upazilas and unions (the Bangladesh-geocode data, worker/src/data/bd-geo.ts) for the shop's delivery
 * address: the checkout asks one level at a time, and an order is checked against the same lists — a district in its division, an upazila in
 * its district, a union in its upazila — before it is stored with the names as chosen.
 */
export type GeoLevel = "divisions" | "districts" | "upazilas" | "unions";

const LEVELS: Record<GeoLevel, Place[]> = { divisions: DIVISIONS, districts: DISTRICTS, upazilas: UPAZILAS, unions: UNIONS };
const index = (list: Place[]) => new Map(list.map((p) => [p[0], p]));
const BY_ID: Record<GeoLevel, Map<number, Place>> = { divisions: index(DIVISIONS), districts: index(DISTRICTS), upazilas: index(UPAZILAS), unions: index(UNIONS) };

export interface GeoPlace {
  id: number;
  name_en: string;
  name_bn: string;
}

/** The places of one level inside `parent` (the divisions need none; -1 = all of the level), by English name. */
export function geoChildren(level: GeoLevel, parent: number): GeoPlace[] {
  return LEVELS[level].filter((p) => level === "divisions" || parent === -1 || p[1] === parent).map(([id, , en, bn]) => ({ id, name_en: en, name_bn: bn }));
}

export interface GeoChoice {
  division_id: number;
  district_id: number;
  /** 0 = the district's town or city area (the data lists the upazilas around a city, not the city's own thanas) */
  upazila_id: number;
  /** 0 = not given */
  union_id: number;
}

/** The names of a chosen place, smallest first ("Subil, Debidwar, Comilla, Chattagram"), or null when the levels do not fit together. */
export function geoPlace(c: GeoChoice): { en: string; bn: string } | null {
  const division = BY_ID.divisions.get(c.division_id);
  const district = BY_ID.districts.get(c.district_id);
  if (!division || !district || district[1] !== division[0]) return null;
  const parts: Place[] = [];
  if (c.upazila_id) {
    const upazila = BY_ID.upazilas.get(c.upazila_id);
    if (!upazila || upazila[1] !== district[0]) return null;
    if (c.union_id) {
      const union = BY_ID.unions.get(c.union_id);
      if (!union || union[1] !== upazila[0]) return null;
      parts.push(union);
    }
    parts.push(upazila);
  } else if (c.union_id) return null;
  else parts.push([0, 0, `${district[2]} city / town area`, `${district[3]} শহর এলাকা`]);
  parts.push(district, division);
  return { en: parts.map((p) => p[2]).join(", "), bn: parts.map((p) => p[3]).join(", ") };
}

export const isDistrict = (id: number) => BY_ID.districts.has(id);
