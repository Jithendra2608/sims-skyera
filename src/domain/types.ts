import type { InspectionReport } from "./detection/inspectSensors";
import type { GroundRoute } from "./routing/planGroundRoutes";
import type { MissionPhase } from "../simulation/types";

/** Priority levels reserved for future triage. */
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
  readonly rescue: GroundRoute;
  readonly evacuation: GroundRoute;
  readonly status: Exclude<OperatorCaseStatus, "NONE">;
}

/**
 * Placeholder domain façade — intentionally empty behavior.
 */
export interface MissionDomain {
  readonly getPhase: () => MissionPhase;
}

export function createMissionDomainPlaceholder(): MissionDomain {
  return {
    getPhase: () => "IDLE",
  };
}
