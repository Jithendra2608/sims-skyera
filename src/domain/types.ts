import type { FusedDetectionReport } from "./detection/yoloThermalFusion";
import type { InspectionReport } from "./detection/inspectSensors";
import type { GroundRoute } from "./routing/astarRouting";
import type { TriageEvaluation } from "./triage/priorityScore";

/**
 * CDR §8 Flowchart Mission States (PS Compliance):
 * IDLE → TAKEOFF → TRANSIT_100M → OPTICAL_SCAN → DETECT → THERMAL_CONFIRM → ALERT → RTL
 */
export type MissionStateId =
  | "IDLE"
  | "TAKEOFF"
  | "TRANSIT_100M"
  | "OPTICAL_SCAN"
  | "DETECT"
  | "THERMAL_CONFIRM"
  | "ALERT"
  | "RTL";

/** Backward-compatible alias for simulation layer */
export type MissionPhase = MissionStateId;

/** Priority levels for triage. */
export type SurvivorPriority = "P1" | "P2" | "P3" | "UNCLASSIFIED";

/**
 * Human remains decision authority.
 * Recommendations may be produced later; approval is required before rescue actions.
 */
export type OperatorDecisionAction =
  | "APPROVE_EVACUATION"
  | "DISPATCH_RESCUER"
  | "REJECT_REROUTE"
  | "MARK_FALSE_POSITIVE"
  | "MARK_RESOLVED";

export type OperatorCaseStatus =
  | "NONE"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "FALSE_POSITIVE"
  | "RESOLVED";

export interface OperatorDecision {
  readonly survivorId: string;
  readonly action: OperatorDecisionAction;
  readonly notes?: string;
}

export interface RouteRecommendation {
  readonly kind: "RESCUE" | "EVACUATION";
  readonly waypoints: ReadonlyArray<{ readonly x: number; readonly z: number }>;
}

export interface HitlCase {
  readonly survivorId: string;
  readonly report: InspectionReport;
  readonly fusion?: FusedDetectionReport;
  readonly triageEval?: TriageEvaluation;
  readonly rescue: GroundRoute;
  readonly evacuation: GroundRoute;
  readonly status: Exclude<OperatorCaseStatus, "NONE">;
}

export interface MissionDomain {
  readonly getPhase: () => MissionStateId;
}

export function createMissionDomainPlaceholder(): MissionDomain {
  return {
    getPhase: () => "IDLE",
  };
}
