export type {
  HitlCase,
  MissionDomain,
  MissionPhase,
  MissionStateId,
  OperatorCaseStatus,
  OperatorDecision,
  OperatorDecisionAction,
  RouteRecommendation,
  SurvivorPriority,
} from "./types";
export { createMissionDomainPlaceholder } from "./types";

// Mission FSM (CDR §8 Flowchart)
export {
  createInitialMissionFsmContext,
  transitionMissionFsm,
  tickMissionFsm,
} from "./mission/missionFsm";
export type {
  MissionFsmContext,
  MissionFsmEvent,
} from "./mission/missionFsm";

// Search module (15–20 m AGL lawnmower)
export {
  planLawnmowerSearch,
  SECTOR7_SEARCH_BOX,
  DEFAULT_SEARCH_ALTITUDE,
  TRANSIT_100M_WAYPOINT,
} from "./search/lawnmower";
export type { LawnmowerSearchParams, SearchWaypoint } from "./search/lawnmower";

// Detection module (Simulated YOLO + Thermal Fusion)
export {
  fuseYoloAndThermal,
  simulateYoloOpticalDetection,
  simulateThermalMeasurement,
} from "./detection/yoloThermalFusion";
export type {
  FusedDetectionReport,
  SensorFusionInput,
  YoloDetection,
  ThermalMeasurement,
  FusionVerificationStatus,
} from "./detection/yoloThermalFusion";
export { analyzeInspection } from "./detection/inspectSensors";
export type { InspectionReport } from "./detection/inspectSensors";

// Triage module (Priority Score: conf × thermal × 1/dist)
export {
  calculatePriorityScore,
  evaluateSurvivorTriage,
} from "./triage/priorityScore";
export type {
  TriageEvaluation,
  TriageScoreInput,
} from "./triage/priorityScore";
export {
  classifySurvivorPriority,
  distanceToNearestHazard,
} from "./triage/classifySurvivor";

// Routing module (A* / Dijkstra around hazard buffers)
export {
  findAStarPath,
  planRescueRouteAStar,
  planEvacuationRouteAStar,
  isPointInsideHazardBuffer,
  smoothAStarPath,
} from "./routing/astarRouting";
export {
  planEvacuationRoute,
  planRescueRoute,
} from "./routing/planGroundRoutes";
export type { GroundRoute, GroundPoint, CircularHazard } from "./routing/astarRouting";
