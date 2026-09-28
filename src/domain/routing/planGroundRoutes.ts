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

function dist(a: GroundPoint, b: GroundPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Returns the closest point on segment AB to hazard center C.
 */
function closestPointOnSegment(
  a: GroundPoint,
  b: GroundPoint,
  c: { readonly x: number; readonly z: number },
): { point: GroundPoint; t: number; dist: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) {
    return { point: a, t: 0, dist: dist(a, c) };
  }
  const t = clamp(((c.x - a.x) * dx + (c.z - a.z) * dz) / len2, 0, 1);
  const px = a.x + t * dx;
  const pz = a.z + t * dz;
  return {
    point: { x: px, z: pz },
    t,
    dist: Math.hypot(px - c.x, pz - c.z),
  };
}

/**
 * Checks whether segment AB cuts through a hazard circle.
 * Ignores endpoints that are legitimately inside or near the hazard (e.g. trapped survivor in collapse).
 */
function segmentHitsHazard(
  a: GroundPoint,
  b: GroundPoint,
  hazard: CircularHazard,
  buffer: number,
): boolean {
  const safeRadius = hazard.radius + buffer;
  const distA = dist(a, hazard.center);
  const distB = dist(b, hazard.center);

  // If both endpoints are already inside or on the boundary, allow direct access
  if (distA <= safeRadius && distB <= safeRadius) {
    return false;
  }

  const { t, dist: d } = closestPointOnSegment(a, b, hazard.center);
  // Only consider obstacles genuinely between the endpoints
  if (t <= 0.05 || t >= 0.95) {
    return false;
  }

  return d < safeRadius;
}

/**
 * Computes a smooth tangent detour point around a circular hazard.
 */
function computeDetour(
  a: GroundPoint,
  b: GroundPoint,
  hazard: CircularHazard,
  buffer: number,
): GroundPoint {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;

  const r = hazard.radius + buffer + 0.8;
  const left: GroundPoint = {
    x: hazard.center.x + nx * r,
    z: hazard.center.z + nz * r,
  };
  const right: GroundPoint = {
    x: hazard.center.x - nx * r,
    z: hazard.center.z - nz * r,
  };

  const leftCost = dist(a, left) + dist(left, b);
  const rightCost = dist(a, right) + dist(right, b);
  return leftCost <= rightCost ? left : right;
}

/**
 * Subdivides segment AB around intersecting hazards (depth limit 2 to keep path minimal and smooth).
 */
function planSubdivided(
  a: GroundPoint,
  b: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
  depth: number,
): GroundPoint[] {
  if (depth > 2) {
    return [b];
  }

  // Find the hazard causing the deepest penetration on segment AB
  let worstHazard: CircularHazard | null = null;
  let worstPenetration = 0;

  for (const h of hazards) {
    if (segmentHitsHazard(a, b, h, STANDOFF_METERS)) {
      const { dist: d } = closestPointOnSegment(a, b, h.center);
      const pen = (h.radius + STANDOFF_METERS) - d;
      if (pen > worstPenetration) {
        worstPenetration = pen;
        worstHazard = h;
      }
    }
  }

  if (!worstHazard) {
    return [b];
  }

  const detour = computeDetour(a, b, worstHazard, STANDOFF_METERS);
  const leg1 = planSubdivided(a, detour, hazards, depth + 1);
  const leg2 = planSubdivided(detour, b, hazards, depth + 1);

  return [...leg1, ...leg2];
}

/**
 * Line-of-sight path simplification (string-pulling) to remove any unnecessary bends.
 */
function smoothPath(
  points: GroundPoint[],
  hazards: ReadonlyArray<CircularHazard>,
): GroundPoint[] {
  if (points.length <= 2) return points;

  const smoothed: GroundPoint[] = [points[0]];
  let currentIdx = 0;

  while (currentIdx < points.length - 1) {
    let furthestIdx = points.length - 1;
    for (; furthestIdx > currentIdx + 1; furthestIdx--) {
      const a = points[currentIdx];
      const b = points[furthestIdx];
      const blocked = hazards.some((h) =>
        segmentHitsHazard(a, b, h, STANDOFF_METERS * 0.8),
      );
      if (!blocked) {
        break;
      }
    }
    smoothed.push(points[furthestIdx]);
    currentIdx = furthestIdx;
  }

  return smoothed;
}

export function planAvoidingHazards(
  from: GroundPoint,
  to: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
): ReadonlyArray<GroundPoint> {
  const rawWaypoints = [from, ...planSubdivided(from, to, hazards, 0)];
  return smoothPath(rawWaypoints, hazards);
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
