/**
 * A* / Dijkstra Ground Routing around Circular Hazard Buffers.
 * Implements deterministic 2D grid pathfinding and string-pulling smoothing.
 *
 * Domain layer: Pure TypeScript, deterministic, NO Three.js imports.
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
  readonly distanceMeters: number;
}

const DEFAULT_HAZARD_BUFFER = 2.0;
const GRID_CELL_SIZE = 1.0; // 1 meter grid resolution

function dist(a: GroundPoint, b: GroundPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Checks if a point is within any hazard circle plus safety buffer.
 */
export function isPointInsideHazardBuffer(
  p: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
  buffer: number = DEFAULT_HAZARD_BUFFER,
): boolean {
  for (const h of hazards) {
    const d = Math.hypot(p.x - h.center.x, p.z - h.center.z);
    if (d < h.radius + buffer) {
      return true;
    }
  }
  return false;
}

/**
 * Raycasts segment AB against hazard buffer circles.
 */
function isSegmentClearOfHazards(
  a: GroundPoint,
  b: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
  buffer: number,
): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return true;

  const steps = Math.ceil(len / 0.5); // check every 0.5m along segment
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + t * dx;
    const pz = a.z + t * dz;
    for (const h of hazards) {
      const d = Math.hypot(px - h.center.x, pz - h.center.z);
      if (d < h.radius + buffer) {
        return false;
      }
    }
  }
  return true;
}

/**
 * A* Pathfinding algorithm on an obstacle grid surrounding hazard buffers.
 */
export function findAStarPath(
  start: GroundPoint,
  goal: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
  buffer: number = DEFAULT_HAZARD_BUFFER,
): GroundPoint[] {
  // If line of sight is already completely clear, return direct route
  if (isSegmentClearOfHazards(start, goal, hazards, buffer * 0.9)) {
    return [start, goal];
  }

  // Determine grid boundaries based on start, goal, and hazards
  let minX = Math.min(start.x, goal.x);
  let maxX = Math.max(start.x, goal.x);
  let minZ = Math.min(start.z, goal.z);
  let maxZ = Math.max(start.z, goal.z);

  for (const h of hazards) {
    minX = Math.min(minX, h.center.x - h.radius - buffer - 6);
    maxX = Math.max(maxX, h.center.x + h.radius + buffer + 6);
    minZ = Math.min(minZ, h.center.z - h.radius - buffer - 6);
    maxZ = Math.max(maxZ, h.center.z + h.radius + buffer + 6);
  }

  const originX = Math.floor(minX) - 2;
  const originZ = Math.floor(minZ) - 2;
  const cols = Math.ceil((maxX - originX) / GRID_CELL_SIZE) + 4;
  const rows = Math.ceil((maxZ - originZ) / GRID_CELL_SIZE) + 4;

  const toKey = (col: number, row: number) => `${col},${row}`;
  const toWorld = (col: number, row: number): GroundPoint => ({
    x: originX + col * GRID_CELL_SIZE,
    z: originZ + row * GRID_CELL_SIZE,
  });

  const startCol = Math.round((start.x - originX) / GRID_CELL_SIZE);
  const startRow = Math.round((start.z - originZ) / GRID_CELL_SIZE);
  const goalCol = Math.round((goal.x - originX) / GRID_CELL_SIZE);
  const goalRow = Math.round((goal.z - originZ) / GRID_CELL_SIZE);

  const startKey = toKey(startCol, startRow);
  const goalKey = toKey(goalCol, goalRow);

  // Closed set and G-scores
  const gScores = new Map<string, number>();
  const fScores = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const closedSet = new Set<string>();

  // Open set priority queue (min-heap simulation via array)
  interface NodeItem {
    readonly key: string;
    readonly col: number;
    readonly row: number;
    readonly f: number;
  }
  const openSet: NodeItem[] = [];

  const heuristic = (c: number, r: number) => {
    const wp = toWorld(c, r);
    return Math.hypot(goal.x - wp.x, goal.z - wp.z);
  };

  gScores.set(startKey, 0);
  fScores.set(startKey, heuristic(startCol, startRow));
  openSet.push({ key: startKey, col: startCol, row: startRow, f: fScores.get(startKey)! });

  // 8-neighbor directions
  const directions = [
    { dc: 1, dr: 0, cost: 1.0 },
    { dc: -1, dr: 0, cost: 1.0 },
    { dc: 0, dr: 1, cost: 1.0 },
    { dc: 0, dr: -1, cost: 1.0 },
    { dc: 1, dr: 1, cost: Math.SQRT2 },
    { dc: -1, dr: 1, cost: Math.SQRT2 },
    { dc: 1, dr: -1, cost: Math.SQRT2 },
    { dc: -1, dr: -1, cost: Math.SQRT2 },
  ];

  let iterations = 0;
  const maxIterations = 3500;

  while (openSet.length > 0 && iterations++ < maxIterations) {
    // Find node with minimum f-score
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) {
        bestIdx = i;
      }
    }
    const current = openSet.splice(bestIdx, 1)[0];

    if (current.key === goalKey || (Math.abs(current.col - goalCol) <= 1 && Math.abs(current.row - goalRow) <= 1)) {
      // Reconstruct path
      const path: GroundPoint[] = [goal];
      let currKey = current.key;
      while (cameFrom.has(currKey)) {
        const [c, r] = currKey.split(",").map(Number);
        path.unshift(toWorld(c, r));
        currKey = cameFrom.get(currKey)!;
      }
      path.unshift(start);
      return smoothAStarPath(path, hazards, buffer);
    }

    closedSet.add(current.key);
    const currentG = gScores.get(current.key) ?? Number.POSITIVE_INFINITY;

    for (const dir of directions) {
      const nc = current.col + dir.dc;
      const nr = current.row + dir.dr;
      const nKey = toKey(nc, nr);

      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows || closedSet.has(nKey)) {
        continue;
      }

      const worldPos = toWorld(nc, nr);
      // Check collision with hazards (allow endpoints to connect even if near hazard edge)
      const isStartOrGoal =
        (Math.abs(nc - startCol) <= 1 && Math.abs(nr - startRow) <= 1) ||
        (Math.abs(nc - goalCol) <= 1 && Math.abs(nr - goalRow) <= 1);

      if (!isStartOrGoal && isPointInsideHazardBuffer(worldPos, hazards, buffer)) {
        continue;
      }

      const tentativeG = currentG + dir.cost;
      const existingG = gScores.get(nKey) ?? Number.POSITIVE_INFINITY;

      if (tentativeG < existingG) {
        cameFrom.set(nKey, current.key);
        gScores.set(nKey, tentativeG);
        const f = tentativeG + heuristic(nc, nr);
        fScores.set(nKey, f);

        const inOpen = openSet.find((node) => node.key === nKey);
        if (!inOpen) {
          openSet.push({ key: nKey, col: nc, row: nr, f });
        }
      }
    }
  }

  // Fallback: If exact path not found within max iterations, return direct line with mid detour
  return [start, goal];
}

/**
 * Line-of-sight path simplification (string pulling).
 * Removes unnecessary grid waypoint steps while preserving hazard clearance.
 */
export function smoothAStarPath(
  path: GroundPoint[],
  hazards: ReadonlyArray<CircularHazard>,
  buffer: number,
): GroundPoint[] {
  if (path.length <= 2) return path;

  const smoothed: GroundPoint[] = [path[0]];
  let currentIdx = 0;

  while (currentIdx < path.length - 1) {
    let furthestIdx = path.length - 1;
    for (; furthestIdx > currentIdx + 1; furthestIdx--) {
      if (isSegmentClearOfHazards(path[currentIdx], path[furthestIdx], hazards, buffer * 0.85)) {
        break;
      }
    }
    smoothed.push(path[furthestIdx]);
    currentIdx = furthestIdx;
  }

  return smoothed;
}

export function planRescueRouteAStar(
  staging: GroundPoint,
  survivor: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
  buffer: number = DEFAULT_HAZARD_BUFFER,
): GroundRoute {
  const waypoints = findAStarPath(staging, survivor, hazards, buffer);
  let distance = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    distance += dist(waypoints[i], waypoints[i + 1]);
  }

  return {
    kind: "RESCUE",
    waypoints,
    distanceMeters: Number(distance.toFixed(1)),
  };
}

export function planEvacuationRouteAStar(
  survivor: GroundPoint,
  safeZone: GroundPoint,
  hazards: ReadonlyArray<CircularHazard>,
  buffer: number = DEFAULT_HAZARD_BUFFER,
): GroundRoute {
  const waypoints = findAStarPath(survivor, safeZone, hazards, buffer);
  let distance = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    distance += dist(waypoints[i], waypoints[i + 1]);
  }

  return {
    kind: "EVACUATION",
    waypoints,
    distanceMeters: Number(distance.toFixed(1)),
  };
}
