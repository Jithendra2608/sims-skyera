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

export const DEFAULT_SEARCH_ALTITUDE = 18; // Specified 15–20 m AGL

/**
 * Ingress transit waypoint for the TRANSIT_100M phase.
 * Represents the transit corridor from staging base (0,0) to Earthquake Zone center.
 */
export const TRANSIT_100M_WAYPOINT: SearchWaypoint = {
  x: 0,
  y: DEFAULT_SEARCH_ALTITUDE,
  z: 45, // Center of earthquake zone
};

/** Operational box centered on Earthquake Zone at 15–20 m AGL. */
export const SECTOR7_SEARCH_BOX = {
  minX: -15,
  maxX: 15,
  minZ: 30, // Earthquake zone starts at Z=30
  maxZ: 60, // Earthquake zone ends at Z=60
  altitude: DEFAULT_SEARCH_ALTITUDE,
  /** Optimal coverage: at 18m AGL / 60° FOV, ground footprint diameter is ~20.8m. 14m gives 33% lateral overlap. */
  laneSpacing: 14,
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
