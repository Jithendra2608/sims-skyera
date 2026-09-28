/**
 * Triage Priority Score Module.
 * Implements PS compliance formula:
 * Priority Score = conf × thermal × (1 / dist)
 *
 * Domain layer: Pure TypeScript, deterministic, NO Three.js imports.
 */

import type { SurvivorPriority } from "../types";

export interface TriageScoreInput {
  readonly survivorId: string;
  /** Optical YOLO or Fused detection confidence (0.0 – 1.0) */
  readonly confidence: number;
  /** Normalized thermal score / heat anomaly intensity (0.0 – 1.0) */
  readonly thermalScore: number;
  /**
   * Distance to nearest active hazard (or rescue barrier).
   * Proximity to danger scales urgency: closer danger (smaller dist) -> higher 1/dist -> higher priority.
   */
  readonly distanceMeters: number;
  readonly vitals: {
    readonly heartRateBpm: number;
    readonly temperatureC: number;
    readonly conscious: boolean;
  };
}

export interface TriageEvaluation {
  readonly survivorId: string;
  readonly confidence: number;
  readonly thermalScore: number;
  readonly distanceMeters: number;
  /** Calculated priority score: conf × thermal × (1 / dist) */
  readonly rawPriorityScore: number;
  /** Scaled score for GCS telemetry display (0 – 100) */
  readonly normalizedScore: number;
  readonly priority: SurvivorPriority;
  readonly triageCategory: "IMMEDIATE (P1)" | "DELAYED (P2)" | "MINIMAL (P3)";
  readonly explanation: string;
}

/**
 * Calculates triage priority score according to PS formula:
 * Score = conf × thermal × (1 / dist)
 */
export function calculatePriorityScore(
  confidence: number,
  thermalScore: number,
  distanceMeters: number,
): number {
  const safeConfidence = Math.max(0.05, Math.min(1.0, confidence));
  const safeThermal = Math.max(0.05, Math.min(1.0, thermalScore));
  // Clamp distance to minimum 1.0 meter to prevent division by zero or singularity
  const safeDist = Math.max(1.0, distanceMeters);

  const score = safeConfidence * safeThermal * (1.0 / safeDist);
  return Number(score.toFixed(4));
}

/**
 * Full clinical + mathematical triage evaluation combining the formula
 * with vital signs triage criteria.
 */
export function evaluateSurvivorTriage(input: TriageScoreInput): TriageEvaluation {
  const rawScore = calculatePriorityScore(
    input.confidence,
    input.thermalScore,
    input.distanceMeters,
  );

  // Scaled score for 0-100 HUD presentation (a score of 0.20 maps to ~100)
  const normalizedScore = Math.min(100, Math.round(rawScore * 500));

  const isCriticalVitals =
    !input.vitals.conscious ||
    input.vitals.temperatureC <= 35.0 ||
    input.vitals.temperatureC >= 38.5 ||
    input.vitals.heartRateBpm >= 140 ||
    input.vitals.heartRateBpm <= 50;

  let priority: SurvivorPriority = "P3";
  let triageCategory: TriageEvaluation["triageCategory"] = "MINIMAL (P3)";

  if (isCriticalVitals || rawScore >= 0.08 || input.distanceMeters < 6.0) {
    priority = "P1";
    triageCategory = "IMMEDIATE (P1)";
  } else if (rawScore >= 0.035 || input.vitals.heartRateBpm >= 110 || input.distanceMeters < 14.0) {
    priority = "P2";
    triageCategory = "DELAYED (P2)";
  } else {
    priority = "P3";
    triageCategory = "MINIMAL (P3)";
  }

  const explanation =
    `Priority Score: ${rawScore.toFixed(4)} [conf: ${(input.confidence * 100).toFixed(0)}% × ` +
    `thermal: ${(input.thermalScore * 100).toFixed(0)}% × 1/dist: ${(1 / Math.max(1, input.distanceMeters)).toFixed(3)}] ` +
    `→ ${triageCategory}`;

  return {
    survivorId: input.survivorId,
    confidence: input.confidence,
    thermalScore: input.thermalScore,
    distanceMeters: input.distanceMeters,
    rawPriorityScore: rawScore,
    normalizedScore,
    priority,
    triageCategory,
    explanation,
  };
}
