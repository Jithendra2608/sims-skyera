/**
 * RGB + thermal inspection abstraction.
 * Simulated sensor products — not a learned vision model.
 */

import type { SurvivorPriority } from "../types";
import {
  classifySurvivorPriority,
  type SurvivorTriageInput,
} from "../triage/classifySurvivor";

export interface SpectralInspectionInput {
  readonly survivorId: string;
  readonly heartRateBpm: number;
  readonly temperatureC: number;
  readonly conscious: boolean;
  readonly hazardProximityMeters: number;
}

export interface InspectionReport {
  readonly survivorId: string;
  readonly rgb: {
    readonly movementDetected: boolean;
    readonly visibleInjuryLikely: boolean;
  };
  readonly thermal: {
    readonly temperatureC: number;
    readonly heatAnomaly: boolean;
  };
  readonly priority: SurvivorPriority;
  readonly rationale: string;
}

export function analyzeInspection(
  input: SpectralInspectionInput,
): InspectionReport {
  const movementDetected = input.conscious;
  const visibleInjuryLikely = !input.conscious || input.heartRateBpm >= 130;
  const heatAnomaly = input.temperatureC <= 35 || input.temperatureC >= 38.5;

  const triage: SurvivorTriageInput = {
    heartRateBpm: input.heartRateBpm,
    temperatureC: input.temperatureC,
    conscious: input.conscious,
    hazardProximityMeters: input.hazardProximityMeters,
  };
  const priority = classifySurvivorPriority(triage);

  const reasons: string[] = [];
  if (!input.conscious) {
    reasons.push("RGB: no voluntary motion");
  } else {
    reasons.push("RGB: motion present");
  }
  if (visibleInjuryLikely) {
    reasons.push("RGB: injury signature likely");
  }
  if (heatAnomaly) {
    reasons.push(
      `THERMAL: ${input.temperatureC.toFixed(1)}C anomaly`,
    );
  } else {
    reasons.push(`THERMAL: ${input.temperatureC.toFixed(1)}C nominal`);
  }
  if (input.hazardProximityMeters < 6) {
    reasons.push("ENV: inside hazard standoff");
  }

  return {
    survivorId: input.survivorId,
    rgb: { movementDetected, visibleInjuryLikely },
    thermal: { temperatureC: input.temperatureC, heatAnomaly },
    priority,
    rationale: `${priority} · ${reasons.join(" · ")}`,
  };
}
