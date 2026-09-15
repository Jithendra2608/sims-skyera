/**
 * Simulation Core contracts.
 * MUST NOT import Three.js or presentation modules.
 */

/** Fixed-timestep clock state (seconds). */
export interface SimulationClock {
  /** Accumulated simulation time */
  readonly elapsedSeconds: number;
  /** Fixed step used for deterministic updates */
  readonly fixedDeltaSeconds: number;
  /** Monotonic tick count */
  readonly tick: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type FlightMode =
  | "DISARMED"
  | "LANDED"
  | "TAKEOFF"
  | "HOVER"
  | "NAVIGATING"
  | "LANDING";

export interface DroneState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly speed: number;
  readonly headingRadians: number;
  readonly pitchRadians: number;
  readonly rollRadians: number;
  readonly armed: boolean;
  readonly flightMode: FlightMode;
  readonly targetPosition: Vec3 | null;
  readonly batteryPercent: number;
}

/**
 * Placeholder world snapshot. Disaster content arrives in later phases.
 */
export interface WorldState {
  readonly scenarioId: string | null;
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
}

/**
 * Mission phase names reserved for the eventual FSM.
 * No transitions are implemented in the architecture reset.
 */
export type MissionPhase =
  | "IDLE"
  | "MISSION_INITIALIZED"
  | "TAKEOFF"
  | "SEARCHING"
  | "ANOMALY_DETECTED"
  | "INSPECTING"
  | "CLASSIFYING"
  | "PRIORITIZED"
  | "SEARCH_CONTINUING"
  | "AWAITING_HUMAN_APPROVAL"
  | "ROUTE_GENERATED"
  | "RESCUE_ACTIVE"
  | "MISSION_COMPLETE";

export interface MissionState {
  readonly phase: MissionPhase;
}

export type SimulationEvent =
  | { readonly type: "tick"; readonly tick: number }
  | { readonly type: "reset" };

export interface SimulationSnapshot {
  readonly clock: SimulationClock;
  readonly world: WorldState;
  readonly drone: DroneState;
  readonly mission: MissionState;
}

export interface SimulationCore {
  readonly getSnapshot: () => SimulationSnapshot;
  /** Advance one fixed step. */
  readonly step: () => void;
  readonly reset: () => void;
  /** Flight controls */
  readonly arm: () => void;
  readonly disarm: () => void;
  readonly takeoff: (targetAltitude?: number) => void;
  readonly flyTo: (target: Vec3) => void;
  readonly land: () => void;
}

