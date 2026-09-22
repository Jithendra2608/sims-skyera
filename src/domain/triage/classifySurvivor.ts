/**
 * Explainable P1/P2/P3 classification.
 * Recommendation only — human remains decision authority.
 */

import type { SurvivorPriority } from "../types";

export interface HazardProximityInput {
  readonly center: { readonly x: number; readonly z: number };
  readonly radius: number;
}

export interface SurvivorTriageInput {
  readonly heartRateBpm: number;
  readonly temperatureC: number;
  readonly conscious: boolean;
  readonly hazardProximityMeters: number;
}

export function distanceToNearestHazard(
  position: { readonly x: number; readonly z: number },
  hazards: ReadonlyArray<HazardProximityInput>,
): number {
  if (hazards.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (const hazard of hazards) {
    const centerDist = Math.hypot(
      position.x - hazard.center.x,
      position.z - hazard.center.z,
    );
    const edgeDist = Math.max(0, centerDist - hazard.radius);
    if (edgeDist < nearest) {
      nearest = edgeDist;
    }
  }
  return nearest;
}

/**
 * P1 critical, P2 serious, P3 stable.
 * Factors: temperature, movement/consciousness, heart rate, environmental danger.
 */
export function classifySurvivorPriority(
  input: SurvivorTriageInput,
): SurvivorPriority {
  const hypothermic = input.temperatureC <= 35;
  const febrile = input.temperatureC >= 38.5;
  const tachycardia = input.heartRateBpm >= 140;
  const bradycardia = input.heartRateBpm <= 50;
  const inHazard = input.hazardProximityMeters < 6;

  if (
    !input.conscious ||
    hypothermic ||
    febrile ||
    tachycardia ||
    bradycardia ||
    inHazard
  ) {
    return "P1";
  }

  const elevatedHr = input.heartRateBpm >= 110;
  const nearHazard = input.hazardProximityMeters < 14;
  if (elevatedHr || nearHazard) {
    return "P2";
  }

  return "P3";
}
