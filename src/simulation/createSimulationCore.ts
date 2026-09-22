import type { SimulationAdapter } from "../adapters/ports";
import {
  analyzeInspection,
  distanceToNearestHazard,
  planEvacuationRoute,
  planLawnmowerSearch,
  planRescueRoute,
  SECTOR7_SEARCH_BOX,
} from "../domain";
import type { HitlCase, OperatorCaseStatus } from "../domain/types";
import type {
  DroneState,
  FlightMode,
  HazardZone,
  InspectState,
  SearchPlanState,
  SimulationCore,
  SimulationSnapshot,
  StagingBase,
  SurvivorEntity,
  Vec3,
} from "./types";

const FIXED_DELTA_SECONDS = 1 / 60;

// Drone kinematics tuning
const MAX_HORIZONTAL_SPEED = 8.0; // m/s
const MAX_VERTICAL_SPEED = 3.0; // m/s
const HORIZONTAL_ACCEL = 4.5; // m/s^2
const VERTICAL_ACCEL = 3.5; // m/s^2
const YAW_RATE = 2.8; // rad/s
const TILT_SMOOTH_FACTOR = 6.0; // smoothing for pitch/roll response
const BATTERY_DRAIN_ARMED_PER_SEC = 0.008; // % per second
const BATTERY_DRAIN_FLYING_PER_SEC = 0.035; // % per second
const INSPECT_HOLD_TICKS = 120;
const INSPECT_ALTITUDE = 5;
const INITIAL_EVACUATION_ZONE = { x: 6, z: 38 };

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function normalizeAngle(rad: number): number {
  let a = rad % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function shortestAngleDiff(target: number, current: number): number {
  return normalizeAngle(target - current);
}

// Initial Disaster World Scenario
const INITIAL_STAGING_BASE: StagingBase = {
  position: { x: 0, y: 0, z: 0 },
  radius: 6,
};

const INITIAL_HAZARDS: ReadonlyArray<HazardZone> = [
  {
    id: "HZ-01",
    kind: "FIRE",
    center: { x: 22, z: -18 },
    radius: 11,
    severity: "CRITICAL",
    description: "Chemical Refinery Flash Fire — High Toxic Fumes",
  },
  {
    id: "HZ-02",
    kind: "FLOOD",
    center: { x: -18, z: -20 },
    radius: 13,
    severity: "MEDIUM",
    description: "Storm Surge Contaminated Flood Water",
  },
  {
    id: "HZ-03",
    kind: "COLLAPSE",
    center: { x: -16, z: 18 },
    radius: 10,
    severity: "HIGH",
    description: "Commercial Complex Concrete Structural Collapse",
  },
];

const INITIAL_SURVIVOR_SEEDS: ReadonlyArray<
  Omit<
    SurvivorEntity,
    | "priority"
    | "hazardProximityMeters"
    | "detected"
    | "detectedAtTick"
    | "inspected"
    | "operatorStatus"
  >
> = [
  {
    id: "SV-01",
    name: "Survivor Alpha",
    position: { x: 16, y: 0, z: 14 },
    vitalSigns: { heartRateBpm: 112, temperatureC: 36.7, conscious: true },
  },
  {
    id: "SV-02",
    name: "Survivor Bravo",
    position: { x: 20, y: 0, z: -12 },
    vitalSigns: { heartRateBpm: 145, temperatureC: 38.8, conscious: false },
  },
  {
    id: "SV-03",
    name: "Survivor Charlie",
    position: { x: -14, y: 0, z: 15 },
    vitalSigns: { heartRateBpm: 64, temperatureC: 34.8, conscious: false },
  },
  {
    id: "SV-04",
    name: "Survivor Delta",
    position: { x: -22, y: 0, z: -12 },
    vitalSigns: { heartRateBpm: 82, temperatureC: 36.6, conscious: true },
  },
];

function seedSurvivors(
  seeds: typeof INITIAL_SURVIVOR_SEEDS,
  hazards: ReadonlyArray<HazardZone>,
): ReadonlyArray<SurvivorEntity> {
  return seeds.map((seed) => ({
    ...seed,
    detected: false,
    detectedAtTick: null,
    hazardProximityMeters: distanceToNearestHazard(seed.position, hazards),
    priority: "UNCLASSIFIED",
    inspected: false,
    operatorStatus: "NONE",
  }));
}

const INITIAL_SURVIVORS = seedSurvivors(INITIAL_SURVIVOR_SEEDS, INITIAL_HAZARDS);

function initialSnapshot(): SimulationSnapshot {
  return {
    clock: {
      elapsedSeconds: 0,
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
      tick: 0,
    },
    world: {
      scenarioId: "DISASTER_URBAN_SECTOR_7",
      bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
      survivors: INITIAL_SURVIVORS,
      hazards: INITIAL_HAZARDS,
      stagingBase: INITIAL_STAGING_BASE,
      evacuationZone: INITIAL_EVACUATION_ZONE,
      rescueRover: {
        active: false,
        position: { x: 0, y: 0, z: 0 },
        headingRadians: 0,
        speed: 0,
        targetSurvivorId: null,
        phase: "IDLE",
        routeIndex: 0,
        currentRoute: [],
      },
    },
    drone: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      headingRadians: 0,
      pitchRadians: 0,
      rollRadians: 0,
      armed: false,
      flightMode: "DISARMED",
      targetPosition: null,
      batteryPercent: 100,
      sensorFovDegrees: 60,
      sensorGroundRadius: 0,
      anomalyDetectedCount: 0,
    },
    mission: {
      phase: "IDLE",
      search: null,
      inspect: null,
      inspectQueue: [],
      cases: [],
      totalRescuedCount: 0,
    },
  };
}

/**
 * Deterministic simulation core with 60 Hz kinematics & sensor anomaly detection.
 * Strictly decoupled from Three.js and presentation.
 */
export function createSimulationCore(
  _adapter: SimulationAdapter,
): SimulationCore {
  let snapshot = initialSnapshot();

  const updateKinematics = (dt: number): DroneState => {
    const current = snapshot.drone;

    // Disarmed / battery dead
    if (!current.armed || current.batteryPercent <= 0) {
      if (current.position.y > 0.05) {
        // Free fall / emergency descent if airborne and disarmed
        const newVy = current.velocity.y - 9.81 * dt;
        const newY = Math.max(0, current.position.y + newVy * dt);
        return {
          ...current,
          position: { ...current.position, y: newY },
          velocity: { x: 0, y: newY === 0 ? 0 : newVy, z: 0 },
          speed: Math.abs(newVy),
          flightMode: newY === 0 ? "LANDED" : "LANDING",
          pitchRadians: current.pitchRadians * 0.9,
          rollRadians: current.rollRadians * 0.9,
          sensorGroundRadius: 0,
        };
      }
      return {
        ...current,
        velocity: { x: 0, y: 0, z: 0 },
        speed: 0,
        pitchRadians: 0,
        rollRadians: 0,
        flightMode: current.position.y <= 0.05 ? "LANDED" : current.flightMode,
        sensorGroundRadius: 0,
      };
    }

    // Armed: calculate battery drain
    const isAirborne = current.position.y > 0.1;
    const drainRate = isAirborne
      ? BATTERY_DRAIN_FLYING_PER_SEC
      : BATTERY_DRAIN_ARMED_PER_SEC;
    const newBattery = Math.max(0, current.batteryPercent - drainRate * dt);

    let pos: Vec3 = { ...current.position };
    let vel: Vec3 = { ...current.velocity };
    let heading = current.headingRadians;
    let pitch = current.pitchRadians;
    let roll = current.rollRadians;
    let mode: FlightMode = current.flightMode;
    let target = current.targetPosition;

    if (target) {
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dz = target.z - pos.z;
      const distH = Math.hypot(dx, dz);
      const dist3D = Math.hypot(dx, dy, dz);

      // Target arrival check
      if (dist3D < 0.2) {
        if (mode === "LANDING" || target.y === 0) {
          pos = { ...pos, y: 0 };
          vel = { x: 0, y: 0, z: 0 };
          mode = "LANDED";
          target = null;
        } else {
          mode = "HOVER";
          vel = { x: 0, y: 0, z: 0 };
          target = null;
        }
      } else {
        // Desired vertical velocity with proportional slow-down near target
        const desVy =
          Math.sign(dy) *
          Math.min(MAX_VERTICAL_SPEED, Math.sqrt(2 * VERTICAL_ACCEL * Math.abs(dy)));

        // Desired horizontal velocity
        let desVx = 0;
        let desVz = 0;
        if (distH > 0.05) {
          const desSpeedH = Math.min(
            MAX_HORIZONTAL_SPEED,
            Math.sqrt(2 * HORIZONTAL_ACCEL * distH),
          );
          desVx = (dx / distH) * desSpeedH;
          desVz = (dz / distH) * desSpeedH;
        }

        // Apply acceleration limits
        const dvx = clamp(
          desVx - vel.x,
          -HORIZONTAL_ACCEL * dt,
          HORIZONTAL_ACCEL * dt,
        );
        const dvy = clamp(
          desVy - vel.y,
          -VERTICAL_ACCEL * dt,
          VERTICAL_ACCEL * dt,
        );
        const dvz = clamp(
          desVz - vel.z,
          -HORIZONTAL_ACCEL * dt,
          HORIZONTAL_ACCEL * dt,
        );

        vel = {
          x: vel.x + dvx,
          y: vel.y + dvy,
          z: vel.z + dvz,
        };

        // Turn heading towards flight direction if moving horizontally
        if (distH > 0.3) {
          const desiredHeading = Math.atan2(dx, dz);
          const diff = shortestAngleDiff(desiredHeading, heading);
          const maxTurn = YAW_RATE * dt;
          heading += clamp(diff, -maxTurn, maxTurn);
          heading = normalizeAngle(heading);
        }

        // Calculate aerodynamic pitch/roll tilt
        const forwardSpeed =
          Math.sin(heading) * vel.x + Math.cos(heading) * vel.z;
        const rightSpeed =
          Math.cos(heading) * vel.x - Math.sin(heading) * vel.z;

        const desPitch = clamp(
          (-forwardSpeed / MAX_HORIZONTAL_SPEED) * 0.38,
          -0.45,
          0.45,
        );
        const desRoll = clamp(
          (rightSpeed / MAX_HORIZONTAL_SPEED) * 0.38,
          -0.45,
          0.45,
        );

        pitch += (desPitch - pitch) * clamp(TILT_SMOOTH_FACTOR * dt, 0, 1);
        roll += (desRoll - roll) * clamp(TILT_SMOOTH_FACTOR * dt, 0, 1);
      }
    } else {
      // No target: decelerate to complete stop
      vel = {
        x: vel.x * Math.max(0, 1 - 4 * dt),
        y: vel.y * Math.max(0, 1 - 4 * dt),
        z: vel.z * Math.max(0, 1 - 4 * dt),
      };
      pitch += (0 - pitch) * clamp(TILT_SMOOTH_FACTOR * dt, 0, 1);
      roll += (0 - roll) * clamp(TILT_SMOOTH_FACTOR * dt, 0, 1);
      if (mode === "TAKEOFF" || mode === "NAVIGATING") {
        mode = "HOVER";
      }
    }

    // Integrate position
    const nextY = Math.max(0, pos.y + vel.y * dt);
    pos = {
      x: pos.x + vel.x * dt,
      y: nextY,
      z: pos.z + vel.z * dt,
    };

    if (pos.y <= 0.02) {
      if (mode === "LANDING" || !current.armed) {
        pos = { ...pos, y: 0 };
        vel = { x: 0, y: 0, z: 0 };
        mode = current.armed ? "LANDED" : "DISARMED";
        pitch = 0;
        roll = 0;
      }
    }

    const currentSpeed = Math.hypot(vel.x, vel.y, vel.z);

    // Calculate dynamic ground footprint radius from sensor FOV
    const sensorRadius =
      pos.y > 0.4
        ? Math.tan(((current.sensorFovDegrees * Math.PI) / 360)) * pos.y
        : 0;

    return {
      position: pos,
      velocity: vel,
      speed: currentSpeed,
      headingRadians: heading,
      pitchRadians: pitch,
      rollRadians: roll,
      armed: current.armed,
      flightMode: mode,
      targetPosition: target,
      batteryPercent: newBattery,
      sensorFovDegrees: current.sensorFovDegrees,
      sensorGroundRadius: sensorRadius,
      anomalyDetectedCount: current.anomalyDetectedCount,
    };
  };

  return {
    getSnapshot: () => snapshot,
    step: () => {
      const nextDrone = updateKinematics(FIXED_DELTA_SECONDS);

      let updatedSurvivors = snapshot.world.survivors;
      const newlyDetectedIds: string[] = [];
      if (nextDrone.position.y >= 1.2 && nextDrone.sensorGroundRadius > 0.5) {
        updatedSurvivors = snapshot.world.survivors.map((s) => {
          if (s.detected) return s;
          const distH = Math.hypot(
            nextDrone.position.x - s.position.x,
            nextDrone.position.z - s.position.z,
          );
          if (distH <= nextDrone.sensorGroundRadius) {
            newlyDetectedIds.push(s.id);
            return {
              ...s,
              detected: true,
              detectedAtTick: snapshot.clock.tick,
              hazardProximityMeters: distanceToNearestHazard(
                s.position,
                snapshot.world.hazards,
              ),
            };
          }
          return s;
        });
      }

      const totalDetected = updatedSurvivors.filter((s) => s.detected).length;
      const queued = Array.from(
        new Set([...snapshot.mission.inspectQueue, ...newlyDetectedIds]),
      );

      snapshot = {
        ...snapshot,
        clock: {
          ...snapshot.clock,
          elapsedSeconds:
            snapshot.clock.elapsedSeconds + snapshot.clock.fixedDeltaSeconds,
          tick: snapshot.clock.tick + 1,
        },
        drone: {
          ...nextDrone,
          anomalyDetectedCount: totalDetected,
        },
        world: {
          ...snapshot.world,
          survivors: updatedSurvivors,
        },
        mission: {
          ...snapshot.mission,
          inspectQueue: queued,
          phase: deriveMissionPhase(
            snapshot.mission,
            nextDrone,
            snapshot.world,
          ),
        },
      };

      tickInspection();
      maybeStartInspection();
      advanceGridSearchIfArrived();
      tickRescueRover();
    },
    reset: () => {
      snapshot = initialSnapshot();
    },
    arm: () => {
      if (!snapshot.drone.armed) {
        snapshot = {
          ...snapshot,
          drone: {
            ...snapshot.drone,
            armed: true,
            flightMode: snapshot.drone.position.y > 0.1 ? "HOVER" : "LANDED",
          },
        };
      }
    },
    disarm: () => {
      snapshot = {
        ...snapshot,
        drone: {
          ...snapshot.drone,
          armed: false,
          flightMode: "DISARMED",
          targetPosition: null,
        },
        mission: {
          ...snapshot.mission,
          phase: "IDLE",
          inspect: null,
          inspectQueue: [],
          search: snapshot.mission.search
            ? { ...snapshot.mission.search, active: false, paused: false }
            : null,
        },
      };
    },
    takeoff: (targetAltitude = SECTOR7_SEARCH_BOX.altitude) => {
      const pos = snapshot.drone.position;
      snapshot = {
        ...snapshot,
        drone: {
          ...snapshot.drone,
          armed: true,
          flightMode: "TAKEOFF",
          targetPosition: { x: pos.x, y: Math.max(2, targetAltitude), z: pos.z },
        },
        mission: {
          ...snapshot.mission,
          phase:
            snapshot.mission.search?.active ? "SEARCHING" : "TAKEOFF",
        },
      };
    },
    flyTo: (target: Vec3) => {
      applyFlyTo(target);
    },
    land: () => {
      const pos = snapshot.drone.position;
      snapshot = {
        ...snapshot,
        drone: {
          ...snapshot.drone,
          flightMode: "LANDING",
          targetPosition: { x: pos.x, y: 0, z: pos.z },
        },
        mission: {
          ...snapshot.mission,
          inspect: null,
          search: snapshot.mission.search
            ? { ...snapshot.mission.search, active: false, paused: false }
            : null,
        },
      };
    },
    startGridSearch: () => {
      const waypoints = planLawnmowerSearch(SECTOR7_SEARCH_BOX);
      const search: SearchPlanState = {
        pattern: "LAWNMOWER",
        active: true,
        paused: false,
        waypointIndex: -1,
        waypoints,
      };
      snapshot = {
        ...snapshot,
        mission: {
          ...snapshot.mission,
          phase: "SEARCHING",
          search,
          inspect: null,
          inspectQueue: snapshot.mission.inspectQueue,
          cases: snapshot.mission.cases,
        },
      };

      if (snapshot.drone.position.y < 2) {
        const pos = snapshot.drone.position;
        snapshot = {
          ...snapshot,
          drone: {
            ...snapshot.drone,
            armed: true,
            flightMode: "TAKEOFF",
            targetPosition: {
              x: pos.x,
              y: SECTOR7_SEARCH_BOX.altitude,
              z: pos.z,
            },
          },
        };
        return;
      }

      const first = waypoints[0];
      if (first) {
        applyFlyTo(first);
        snapshot = {
          ...snapshot,
          mission: {
            ...snapshot.mission,
            phase: "SEARCHING",
            search: { ...search, waypointIndex: 0, paused: false },
          },
        };
      }
    },
    abortSearch: () => {
      snapshot = {
        ...snapshot,
        mission: {
          ...snapshot.mission,
          inspect: null,
          search: snapshot.mission.search
            ? { ...snapshot.mission.search, active: false, paused: false }
            : null,
        },
      };
    },
    approveCase: (survivorId: string) => {
      applyHitlDecision(survivorId, "APPROVED");
    },
    rejectCase: (survivorId: string) => {
      applyHitlDecision(survivorId, "REJECTED");
    },
    markFalsePositive: (survivorId: string) => {
      applyHitlDecision(survivorId, "FALSE_POSITIVE");
    },
  };

  function applyFlyTo(target: Vec3): void {
    snapshot = {
      ...snapshot,
      drone: {
        ...snapshot.drone,
        armed: true,
        flightMode: "NAVIGATING",
        targetPosition: { ...target },
      },
    };
  }

  function pauseSearch(): void {
    if (!snapshot.mission.search) {
      return;
    }
    snapshot = {
      ...snapshot,
      mission: {
        ...snapshot.mission,
        search: { ...snapshot.mission.search, paused: true },
      },
    };
  }

  function resumeSearchAfterInspect(): void {
    const search = snapshot.mission.search;
    if (!search?.active) {
      snapshot = {
        ...snapshot,
        mission: { ...snapshot.mission, inspect: null },
      };
      return;
    }
    const current = search.waypoints[Math.max(0, search.waypointIndex)];
    snapshot = {
      ...snapshot,
      mission: {
        ...snapshot.mission,
        inspect: null,
        search: { ...search, paused: false },
        phase: "SEARCH_CONTINUING",
      },
    };
    if (current) {
      applyFlyTo(current);
    }
  }

  function maybeStartInspection(): void {
    if (snapshot.mission.inspect) {
      return;
    }
    const nextId = snapshot.mission.inspectQueue[0];
    if (!nextId) {
      return;
    }
    const survivor = snapshot.world.survivors.find((s) => s.id === nextId);
    if (!survivor || survivor.inspected) {
      snapshot = {
        ...snapshot,
        mission: {
          ...snapshot.mission,
          inspectQueue: snapshot.mission.inspectQueue.filter((id) => id !== nextId),
        },
      };
      return;
    }

    pauseSearch();
    applyFlyTo({
      x: survivor.position.x,
      y: INSPECT_ALTITUDE,
      z: survivor.position.z,
    });
    const inspect: InspectState = {
      survivorId: nextId,
      holdTicksRemaining: INSPECT_HOLD_TICKS,
      transiting: true,
    };
    snapshot = {
      ...snapshot,
      mission: {
        ...snapshot.mission,
        inspect,
        inspectQueue: snapshot.mission.inspectQueue.filter((id) => id !== nextId),
        phase: "ANOMALY_DETECTED",
      },
    };
  }

  function completeInspection(survivorId: string): void {
    const survivor = snapshot.world.survivors.find((s) => s.id === survivorId);
    if (!survivor) {
      resumeSearchAfterInspect();
      return;
    }
    const report = analyzeInspection({
      survivorId: survivor.id,
      heartRateBpm: survivor.vitalSigns.heartRateBpm,
      temperatureC: survivor.vitalSigns.temperatureC,
      conscious: survivor.vitalSigns.conscious,
      hazardProximityMeters: survivor.hazardProximityMeters,
    });
    const staging = {
      x: snapshot.world.stagingBase.position.x,
      z: snapshot.world.stagingBase.position.z,
    };
    const evac = snapshot.world.evacuationZone;
    const hitlCase: HitlCase = {
      survivorId: survivor.id,
      report,
      rescue: planRescueRoute(staging, survivor.position, snapshot.world.hazards),
      evacuation: planEvacuationRoute(
        survivor.position,
        evac,
        snapshot.world.hazards,
      ),
      status: "PENDING",
    };
    snapshot = {
      ...snapshot,
      world: {
        ...snapshot.world,
        survivors: snapshot.world.survivors.map((s) =>
          s.id === survivorId
            ? {
                ...s,
                inspected: true,
                priority: report.priority,
                operatorStatus: "PENDING",
              }
            : s,
        ),
      },
      mission: {
        ...snapshot.mission,
        cases: [...snapshot.mission.cases.filter((c) => c.survivorId !== survivorId), hitlCase],
        phase: "AWAITING_HUMAN_APPROVAL",
      },
    };
    resumeSearchAfterInspect();
  }

  function tickInspection(): void {
    const inspect = snapshot.mission.inspect;
    if (!inspect) {
      return;
    }
    const drone = snapshot.drone;
    if (inspect.transiting) {
      if (drone.targetPosition === null && drone.flightMode !== "TAKEOFF") {
        snapshot = {
          ...snapshot,
          mission: {
            ...snapshot.mission,
            inspect: { ...inspect, transiting: false },
            phase: "INSPECTING",
          },
        };
      }
      return;
    }
    const remaining = inspect.holdTicksRemaining - 1;
    if (remaining <= 0) {
      snapshot = {
        ...snapshot,
        mission: {
          ...snapshot.mission,
          inspect: { ...inspect, holdTicksRemaining: 0 },
          phase: "CLASSIFYING",
        },
      };
      completeInspection(inspect.survivorId);
      return;
    }
    snapshot = {
      ...snapshot,
      mission: {
        ...snapshot.mission,
        inspect: { ...inspect, holdTicksRemaining: remaining },
        phase: "INSPECTING",
      },
    };
  }

  function applyHitlDecision(
    survivorId: string,
    status: Exclude<OperatorCaseStatus, "NONE">,
  ): void {
    const approvedCase = snapshot.mission.cases.find(
      (c) => c.survivorId === survivorId,
    );
    let nextRover = snapshot.world.rescueRover;
    // Only dispatch from staging if the rover is currently idle
    if (status === "APPROVED" && approvedCase && !nextRover.active) {
      nextRover = {
        active: true,
        position: {
          x: snapshot.world.stagingBase.position.x,
          y: 0,
          z: snapshot.world.stagingBase.position.z,
        },
        headingRadians: 0,
        speed: 6.5,
        targetSurvivorId: survivorId,
        phase: "TRANSIT_TO_CASUALTY",
        routeIndex: 0,
        currentRoute: approvedCase.rescue.waypoints,
      };
    }

    snapshot = {
      ...snapshot,
      world: {
        ...snapshot.world,
        rescueRover: nextRover,
        survivors: snapshot.world.survivors.map((s) =>
          s.id === survivorId ? { ...s, operatorStatus: status } : s,
        ),
      },
      mission: {
        ...snapshot.mission,
        cases: snapshot.mission.cases.map((c) =>
          c.survivorId === survivorId ? { ...c, status } : c,
        ),
        phase: status === "APPROVED" ? "RESCUE_ACTIVE" : snapshot.mission.phase,
      },
    };
  }

  function tickRescueRover(): void {
    const rover = snapshot.world.rescueRover;
    if (!rover.active || rover.currentRoute.length === 0) {
      return;
    }

    const currentWp = rover.currentRoute[rover.routeIndex];
    if (!currentWp) {
      return;
    }

    const dx = currentWp.x - rover.position.x;
    const dz = currentWp.z - rover.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.6) {
      if (rover.routeIndex + 1 < rover.currentRoute.length) {
        snapshot = {
          ...snapshot,
          world: {
            ...snapshot.world,
            rescueRover: {
              ...rover,
              routeIndex: rover.routeIndex + 1,
            },
          },
        };
      } else {
        if (rover.phase === "TRANSIT_TO_CASUALTY") {
          const targetCase = snapshot.mission.cases.find(
            (c) => c.survivorId === rover.targetSurvivorId,
          );
          if (targetCase) {
            snapshot = {
              ...snapshot,
              world: {
                ...snapshot.world,
                rescueRover: {
                  ...rover,
                  phase: "EVACUATING",
                  routeIndex: 0,
                  currentRoute: targetCase.evacuation.waypoints,
                },
              },
            };
          }
        } else if (rover.phase === "EVACUATING") {
          const deliveredId = rover.targetSurvivorId;
          const nextRescuedCount = snapshot.mission.totalRescuedCount + 1;
          const allResolved =
            nextRescuedCount >= snapshot.world.survivors.length;

          // Find next approved case that is not yet delivered/resolved
          const nextApproved = snapshot.mission.cases.find((c) => {
            if (c.status !== "APPROVED" || c.survivorId === deliveredId) {
              return false;
            }
            const s = snapshot.world.survivors.find((surv) => surv.id === c.survivorId);
            return s && s.operatorStatus !== "RESOLVED";
          });

          // Mark delivered case as RESOLVED in mission cases
          const updatedCases = snapshot.mission.cases.map((c) =>
            c.survivorId === deliveredId ? { ...c, status: "RESOLVED" as const } : c,
          );

          if (nextApproved) {
            const nextSurv = snapshot.world.survivors.find(
              (s) => s.id === nextApproved.survivorId,
            );
            const transitRoute = nextSurv
              ? planRescueRoute(
                  { x: rover.position.x, z: rover.position.z },
                  nextSurv.position,
                  snapshot.world.hazards,
                ).waypoints
              : nextApproved.rescue.waypoints;

            snapshot = {
              ...snapshot,
              world: {
                ...snapshot.world,
                survivors: snapshot.world.survivors.map((s) =>
                  s.id === deliveredId
                    ? { ...s, operatorStatus: "RESOLVED" }
                    : s,
                ),
                rescueRover: {
                  ...rover,
                  phase: "TRANSIT_TO_CASUALTY",
                  routeIndex: 0,
                  targetSurvivorId: nextApproved.survivorId,
                  currentRoute: transitRoute,
                },
              },
              mission: {
                ...snapshot.mission,
                cases: updatedCases,
                totalRescuedCount: nextRescuedCount,
              },
            };
          } else {
            snapshot = {
              ...snapshot,
              world: {
                ...snapshot.world,
                survivors: snapshot.world.survivors.map((s) =>
                  s.id === deliveredId
                    ? { ...s, operatorStatus: "RESOLVED" }
                    : s,
                ),
                rescueRover: {
                  ...rover,
                  phase: "DELIVERED",
                  active: false,
                  speed: 0,
                  currentRoute: [],
                  targetSurvivorId: null,
                },
              },
              mission: {
                ...snapshot.mission,
                cases: updatedCases,
                totalRescuedCount: nextRescuedCount,
                phase: allResolved
                  ? "MISSION_COMPLETE"
                  : snapshot.mission.phase,
              },
            };
          }
        }
      }
    } else {
      const heading = Math.atan2(dx, dz);
      const stepDist = Math.min(dist, rover.speed * FIXED_DELTA_SECONDS);
      snapshot = {
        ...snapshot,
        world: {
          ...snapshot.world,
          rescueRover: {
            ...rover,
            position: {
              x: rover.position.x + Math.sin(heading) * stepDist,
              y: 0,
              z: rover.position.z + Math.cos(heading) * stepDist,
            },
            headingRadians: heading,
          },
        },
      };
    }
  }

  function advanceGridSearchIfArrived(): void {
    const search = snapshot.mission.search;
    if (!search?.active || search.paused || snapshot.mission.inspect) {
      return;
    }

    const drone = snapshot.drone;
    if (drone.flightMode === "TAKEOFF" || drone.flightMode === "LANDING") {
      return;
    }
    if (drone.targetPosition !== null) {
      return;
    }

    const nextIndex = search.waypointIndex + 1;
    if (nextIndex >= search.waypoints.length) {
      snapshot = {
        ...snapshot,
        mission: {
          ...snapshot.mission,
          phase: snapshot.mission.cases.some((c) => c.status === "PENDING")
            ? "AWAITING_HUMAN_APPROVAL"
            : snapshot.world.rescueRover.active
            ? "RESCUE_ACTIVE"
            : "SEARCH_CONTINUING",
          search: { ...search, active: false, paused: false },
        },
      };
      applyFlyTo({ x: 0, y: SECTOR7_SEARCH_BOX.altitude, z: 0 });
      return;
    }

    const nextWp = search.waypoints[nextIndex];
    if (!nextWp) {
      return;
    }
    applyFlyTo(nextWp);
    snapshot = {
      ...snapshot,
      mission: {
        ...snapshot.mission,
        phase: "SEARCHING",
        search: { ...search, waypointIndex: nextIndex },
      },
    };
  }
}

function deriveMissionPhase(
  mission: SimulationSnapshot["mission"],
  drone: DroneState,
  world?: SimulationSnapshot["world"],
): SimulationSnapshot["mission"]["phase"] {
  if (
    mission.phase === "MISSION_COMPLETE" ||
    (world &&
      mission.totalRescuedCount >= world.survivors.length &&
      world.survivors.length > 0)
  ) {
    return "MISSION_COMPLETE";
  }
  if (mission.inspect) {
    return mission.inspect.transiting ? "ANOMALY_DETECTED" : "INSPECTING";
  }
  if (mission.cases.some((c) => c.status === "PENDING")) {
    return "AWAITING_HUMAN_APPROVAL";
  }
  if (world?.rescueRover.active) {
    return "RESCUE_ACTIVE";
  }
  if (mission.search?.active && !mission.search.paused) {
    return "SEARCHING";
  }
  if (drone.flightMode === "TAKEOFF") {
    return "TAKEOFF";
  }
  return mission.phase;
}
