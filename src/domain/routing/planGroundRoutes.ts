/**
 * Ground rescue / evacuation paths with circular hazard standoff.
 * Deterministic geometry only — no random AI navigation.
 */

export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

export interface CircularHazard {
  readonly center: { readonly x: number; readonly z: number };
  readonly radius: number;
}

export interface GroundRoute {
  readonly kind: "RESCUE" | "EVACUATION";
  readonly waypoints: ReadonlyArray<GroundPoint>;
}

const STANDOFF_METERS = 3.5;
const MAX_DETOURS = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lineHitsHazard(
  a: GroundPoint,
  b: GroundPoint,
  hazard: CircularHazard,
  extra: number,
): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = 0;
  if (len2 > 1e-8) {
    t = clamp(
      ((hazard.center.x - a.x) * dx + (hazard.center.z - a.z) * dz) / len2,
      0,
      1,
    );
  }
  const px = a.x + t * dx;
  const pz = a.z + t * dz;
  const limit = hazard.radius + extra;
  return Math.hypot(px - hazard.center.x, pz - hazard.center.z) < limit;
}

function detourPoint(
  a: GroundPoint,
  b: GroundPoint,
  hazard: CircularHazard,
  extra: number,
): GroundPoint {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let nx = -dz;
  let nz = dx;
  const nlen = Math.hypot(nx, nz) || 1;
  nx /= nlen;
  nz /= nlen;
  const r = hazard.radius + extra;
  const left: GroundPoint = {
    x: hazard.center.x + nx * r,
    z: hazard.center.z + nz * r,
  };
  const right: GroundPoint = {
    x: hazard.center.x - nx * r,
    z: hazard.center.z - nz * r,
  };
  const leftCost =
    Math.hypot(left.x - a.x, left.z - a.z) +
    Math.hypot(left.x - b.x, left.z - b.z);
  const rightCost =
    Math.hypot(right.x - a.x, right.z - a.z) +
    Math.hypot(right.x - b.x, right.z - b.z);
  return leftCost <= rightCost ? left : right;
}

export function planAvoidingHazards(
  from: GroundPoint,
  to: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
): ReadonlyArray<GroundPoint> {
  const points: GroundPoint[] = [from];
  let current = from;
  for (let i = 0; i < MAX_DETOURS; i++) {
    const hit = hazards.find((hazard) =>
      lineHitsHazard(current, to, hazard, STANDOFF_METERS),
    );
    if (!hit) {
      points.push(to);
      return points;
    }
    current = detourPoint(current, to, hit, STANDOFF_METERS);
    points.push(current);
  }
  points.push(to);
  return points;
}

export function planRescueRoute(
  staging: GroundPoint,
  survivor: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
): GroundRoute {
  return {
    kind: "RESCUE",
    waypoints: planAvoidingHazards(staging, survivor, hazards),
  };
}

export function planEvacuationRoute(
  survivor: GroundPoint,
  safeZone: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
): GroundRoute {
  return {
    kind: "EVACUATION",
    waypoints: planAvoidingHazards(survivor, safeZone, hazards),
  };
}
