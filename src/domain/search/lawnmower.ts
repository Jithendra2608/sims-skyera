/**
 * Deterministic predefined lawnmower / grid search.
 * Domain logic only — no Three.js, no random wander.
 */

export interface SearchWaypoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LawnmowerSearchParams {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly altitude: number;
  readonly laneSpacing: number;
}

/** Operational box covering Urban Sector 7 hazards and survivor placements. */
export const SECTOR7_SEARCH_BOX = {
  minX: -26,
  maxX: 26,
  minZ: -26,
  maxZ: 26,
  altitude: 8,
  /** Slightly under 2× sensor radius at 8 m AGL / 60° FOV (~4.6 m radius). */
  laneSpacing: 7,
} as const satisfies LawnmowerSearchParams;

function laneCoordinates(
  min: number,
  max: number,
  spacing: number,
): number[] {
  if (max < min) {
    return [min];
  }
  const lanes: number[] = [];
  for (let value = min; value < max - 1e-6; value += spacing) {
    lanes.push(value);
  }
  const last = lanes[lanes.length - 1];
  if (last === undefined || max - last > 0.5) {
    lanes.push(max);
  }
  return lanes;
}

/**
 * Alternating east–west legs along north–south lane progression.
 */
export function planLawnmowerSearch(
  params: LawnmowerSearchParams,
): ReadonlyArray<SearchWaypoint> {
  const lanes = laneCoordinates(params.minZ, params.maxZ, params.laneSpacing);
  const waypoints: SearchWaypoint[] = [];

  lanes.forEach((z, laneIndex) => {
    if (laneIndex % 2 === 0) {
      waypoints.push({ x: params.minX, y: params.altitude, z });
      waypoints.push({ x: params.maxX, y: params.altitude, z });
    } else {
      waypoints.push({ x: params.maxX, y: params.altitude, z });
      waypoints.push({ x: params.minX, y: params.altitude, z });
    }
  });

  return waypoints;
}
