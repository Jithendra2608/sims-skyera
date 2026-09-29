import type { SimulationAdapter } from "../adapters/ports";
import {
  analyzeInspection,
  createInitialMissionFsmContext,
  DEFAULT_SEARCH_ALTITUDE,
  distanceToNearestHazard,
  evaluateSurvivorTriage,
  fuseYoloAndThermal,
  planEvacuationRouteAStar,
  planLawnmowerSearch,
  planRescueRouteAStar,
  SECTOR7_SEARCH_BOX,
  simulateYoloOpticalDetection,
  tickMissionFsm,
  TRANSIT_100M_WAYPOINT,
  transitionMissionFsm,
} from "../domain";
import type {
  HitlCase,
  MissionFsmContext,
  OperatorCaseStatus,
} from "../domain";
import type {
  DisasterScenarioType,
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
const INSPECT_HOLD_TICKS = 90; // ~1.5s hold for FLIR thermal confirmation
const INSPECT_ALTITUDE = 10; // Confirmation hover altitude AGL

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

interface ScenarioData {
  readonly id: DisasterScenarioType;
  readonly name: string;
  readonly stagingBase: StagingBase;
  readonly evacuationZone: { readonly x: number; readonly z: number };
  readonly hazards: ReadonlyArray<HazardZone>;
  readonly survivorSeeds: ReadonlyArray<
    Omit<
      SurvivorEntity,
      | "priority"
      | "hazardProximityMeters"
      | "detected"
      | "detectedAtTick"
      | "inspected"
      | "operatorStatus"
    >
  >;
}

const SECTOR_7_SCENARIO: ScenarioData = {
  id: "SECTOR_7",
  name: "Sector 7 Disaster Response Zone",
  stagingBase: { position: { x: 0, y: 0, z: 0 }, radius: 6 },
  evacuationZone: { x: -8, z: -12 },
  hazards: [
    {
      id: "HZ-EARTHQUAKE",
      kind: "COLLAPSE",
      center: { x: 0, z: 45 },
      radius: 22,
      severity: "CRITICAL",
      description: "Earthquake Disaster Zone — Major Structural Collapse with Trapped Survivors",
    },
    {
      id: "HZ-FIRE-EAST",
      kind: "FIRE",
      center: { x: 18, z: -16 },
      radius: 8,
      severity: "HIGH",
      description: "Eastern Fire Zone — Industrial facility blaze with toxic smoke",
    },
    {
      id: "HZ-FIRE-WEST",
      kind: "FIRE",
      center: { x: -14, z: 15 },
      radius: 6,
      severity: "MEDIUM",
      description: "Western Fire Zone — Residential structure fire",
    },
  ],
  survivorSeeds: [
    // Earthquake zone survivors (trapped under debris)
    {
      id: "SV-01",
      name: "Survivor Alpha (Earthquake Zone - Trapped)",
      position: { x: 8, y: 0, z: 42 },
      vitalSigns: { heartRateBpm: 95, temperatureC: 36.2, conscious: true },
    },
    {
      id: "SV-02",
      name: "Survivor Bravo (Earthquake Zone - Crushed)",
      position: { x: -6, y: 0, z: 48 },
      vitalSigns: { heartRateBpm: 135, temperatureC: 38.2, conscious: false },
    },
    {
      id: "SV-03",
      name: "Survivor Charlie (Earthquake Zone - Buried)",
      position: { x: 12, y: 0, z: 38 },
      vitalSigns: { heartRateBpm: 78, temperatureC: 35.1, conscious: false },
    },
    {
      id: "SV-04",
      name: "Survivor Delta (Earthquake Zone - Pinned)",
      position: { x: -10, y: 0, z: 44 },
      vitalSigns: { heartRateBpm: 108, temperatureC: 36.8, conscious: true },
    },
    {
      id: "SV-05",
      name: "Survivor Echo (Earthquake Zone - Trapped)",
      position: { x: 5, y: 0, z: 52 },
      vitalSigns: { heartRateBpm: 142, temperatureC: 38.5, conscious: false },
    },
  ],
};

export const SCENARIOS: Record<DisasterScenarioType, ScenarioData> = {
  SECTOR_7: SECTOR_7_SCENARIO,
  EARTHQUAKE: SECTOR_7_SCENARIO,
  TSUNAMI: SECTOR_7_SCENARIO,
};

function seedSurvivors(
  seeds: ScenarioData["survivorSeeds"],
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

function createInitialSnapshot(scenarioId: DisasterScenarioType): SimulationSnapshot {
  const scenario = SCENARIOS[scenarioId];
  const survivors = seedSurvivors(scenario.survivorSeeds, scenario.hazards);
  return {
    clock: {
      elapsedSeconds: 0,
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
      tick: 0,
    },
    world: {
      scenarioId: scenario.id,
      bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 80 }, // Extended for earthquake zone
      survivors,
      hazards: scenario.hazards,
      stagingBase: scenario.stagingBase,
      evacuationZone: scenario.evacuationZone,
      rescueRover: {
        active: false,
        position: {
          x: scenario.stagingBase.position.x,
          y: 0,
          z: scenario.stagingBase.position.z,
        },
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
  let currentScenario: DisasterScenarioType = "SECTOR_7";
  let snapshot = createInitialSnapshot(currentScenario);
  let missionFsm: MissionFsmContext = createInitialMissionFsmContext();

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

      // Target arrival check (0.65m allows smooth 60Hz waypoint traversal without overshoot oscillations)
      if (dist3D < 0.65) {
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
      missionFsm = tickMissionFsm(missionFsm);
      const tick = snapshot.clock.tick;

      snapshot = {
        ...snapshot,
        clock: {
          ...snapshot.clock,
          elapsedSeconds:
            snapshot.clock.elapsedSeconds + snapshot.clock.fixedDeltaSeconds,
          tick: tick + 1,
        },
        drone: nextDrone,
      };

      stepMissionFsm(nextDrone);
      tickRescueRover();
    },
    reset: () => {
      snapshot = createInitialSnapshot(currentScenario);
      missionFsm = createInitialMissionFsmContext();
    },
    setScenario: (scenario: DisasterScenarioType) => {
      currentScenario = scenario;
      snapshot = createInitialSnapshot(scenario);
      missionFsm = createInitialMissionFsmContext();
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
      missionFsm = createInitialMissionFsmContext();
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
    takeoff: (targetAltitude = DEFAULT_SEARCH_ALTITUDE) => {
      const pos = snapshot.drone.position;
      missionFsm = transitionMissionFsm(
        missionFsm,
        { type: "START_MISSION" },
        snapshot.clock.tick,
      );
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
          phase: missionFsm.state,
        },
      };
    },
    flyTo: (target: Vec3) => {
      applyFlyTo(target);
    },
    land: () => {
      missionFsm = transitionMissionFsm(
        missionFsm,
        { type: "EMERGENCY_RTL", reason: "Operator commanded landing" },
        snapshot.clock.tick,
      );
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
          phase: missionFsm.state,
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
        waypointIndex: 0,
        waypoints,
      };

      missionFsm = transitionMissionFsm(
        missionFsm,
        { type: "START_MISSION" },
        snapshot.clock.tick,
      );

      const pos = snapshot.drone.position;
      const needsTakeoff = pos.y < DEFAULT_SEARCH_ALTITUDE - 1.0;

      if (needsTakeoff) {
        // Need to takeoff first, then transit to earthquake zone
        snapshot = {
          ...snapshot,
          drone: {
            ...snapshot.drone,
            armed: true,
            flightMode: "TAKEOFF",
            targetPosition: { x: pos.x, y: DEFAULT_SEARCH_ALTITUDE, z: pos.z },
          },
          mission: {
            ...snapshot.mission,
            phase: missionFsm.state,
            search,
            inspect: null,
            inspectQueue: snapshot.mission.inspectQueue,
            cases: snapshot.mission.cases,
          },
        };
      } else {
        // Already at altitude: transit to earthquake zone first, then start search
        snapshot = {
          ...snapshot,
          drone: {
            ...snapshot.drone,
            armed: true,
            flightMode: "NAVIGATING",
            targetPosition: TRANSIT_100M_WAYPOINT,
          },
          mission: {
            ...snapshot.mission,
            phase: missionFsm.state,
            search,
            inspect: null,
            inspectQueue: snapshot.mission.inspectQueue,
            cases: snapshot.mission.cases,
          },
        };
        applyFlyTo(TRANSIT_100M_WAYPOINT);
      }
    },
    abortSearch: () => {
      missionFsm = transitionMissionFsm(
        missionFsm,
        { type: "EMERGENCY_RTL", reason: "Operator aborted search" },
        snapshot.clock.tick,
      );
      snapshot = {
        ...snapshot,
        mission: {
          ...snapshot.mission,
          phase: missionFsm.state,
          inspect: null,
          search: snapshot.mission.search
            ? { ...snapshot.mission.search, active: false, paused: false }
            : null,
        },
      };
      applyFlyTo({ x: 0, y: DEFAULT_SEARCH_ALTITUDE, z: 0 });
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
        phase: "OPTICAL_SCAN",
      },
    };
    if (current) {
      applyFlyTo(current);
    }
  }

  function stepMissionFsm(drone: DroneState): void {
    const tick = snapshot.clock.tick;

    switch (missionFsm.state) {
      case "IDLE": {
        break;
      }

      case "TAKEOFF": {
        // Ascending to 15–20 m AGL (more lenient threshold to ensure transition)
        if (drone.position.y >= DEFAULT_SEARCH_ALTITUDE - 1.0) {
          missionFsm = transitionMissionFsm(
            missionFsm,
            { type: "TAKEOFF_ALTITUDE_REACHED", currentAltitude: drone.position.y },
            tick,
          );
          snapshot = {
            ...snapshot,
            drone: {
              ...snapshot.drone,
              flightMode: "NAVIGATING",
            },
            mission: { ...snapshot.mission, phase: missionFsm.state },
          };
          applyFlyTo(TRANSIT_100M_WAYPOINT);
        }
        break;
      }

      case "TRANSIT_100M": {
        // High-speed transit to earthquake zone center
        const distToIngress = Math.hypot(
          drone.position.x - TRANSIT_100M_WAYPOINT.x,
          drone.position.z - TRANSIT_100M_WAYPOINT.z,
        );
        if (distToIngress < 3.0) {
          missionFsm = transitionMissionFsm(
            missionFsm,
            { type: "TRANSIT_INGRESS_REACHED" },
            tick,
          );
          // Use existing search plan if available, otherwise create new one
          let search = snapshot.mission.search;
          if (!search || !search.active) {
            const waypoints = planLawnmowerSearch(SECTOR7_SEARCH_BOX);
            search = {
              pattern: "LAWNMOWER",
              active: true,
              paused: false,
              waypointIndex: 0,
              waypoints,
            };
          }
          snapshot = {
            ...snapshot,
            drone: {
              ...snapshot.drone,
              flightMode: "NAVIGATING",
            },
            mission: {
              ...snapshot.mission,
              phase: missionFsm.state,
              search,
            },
          };
          if (search.waypoints[0]) {
            applyFlyTo(search.waypoints[0]);
          }
        }
        break;
      }

      case "OPTICAL_SCAN": {
        advanceGridSearchIfArrived();

        // Run Simulated YOLO Optical Detector on uninspected survivors inside sensor ground footprint
        if (drone.position.y >= 5.0 && drone.sensorGroundRadius > 1.0) {
          for (const s of snapshot.world.survivors) {
            if (s.inspected || missionFsm.alertedSurvivorIds.includes(s.id)) {
              continue;
            }
            const distH = Math.hypot(
              drone.position.x - s.position.x,
              drone.position.z - s.position.z,
            );
            if (distH <= drone.sensorGroundRadius) {
              const yolo = simulateYoloOpticalDetection(
                distH,
                drone.sensorGroundRadius,
                s.vitalSigns.conscious,
              );
              if (yolo.detected && yolo.confidence >= 0.65) {
                // Optical candidate found!
                missionFsm = transitionMissionFsm(
                  missionFsm,
                  { type: "OPTICAL_CANDIDATE_FOUND", survivorId: s.id },
                  tick,
                );
                pauseSearch();
                applyFlyTo({
                  x: s.position.x,
                  y: INSPECT_ALTITUDE,
                  z: s.position.z,
                });
                const inspect: InspectState = {
                  survivorId: s.id,
                  holdTicksRemaining: INSPECT_HOLD_TICKS,
                  transiting: true,
                };
                snapshot = {
                  ...snapshot,
                  world: {
                    ...snapshot.world,
                    survivors: snapshot.world.survivors.map((surv) =>
                      surv.id === s.id
                        ? {
                            ...surv,
                            detected: true,
                            detectedAtTick: tick,
                            hazardProximityMeters: distanceToNearestHazard(
                              surv.position,
                              snapshot.world.hazards,
                            ),
                          }
                        : surv,
                    ),
                  },
                  drone: {
                    ...snapshot.drone,
                    anomalyDetectedCount: snapshot.drone.anomalyDetectedCount + 1,
                  },
                  mission: {
                    ...snapshot.mission,
                    phase: missionFsm.state,
                    inspect,
                  },
                };
                break;
              }
            }
          }
        }
        break;
      }

      case "DETECT": {
        const inspect = snapshot.mission.inspect;
        if (!inspect) break;
        const targetSurvivor = snapshot.world.survivors.find(
          (s) => s.id === inspect.survivorId,
        );
        if (!targetSurvivor) break;

        const distH = Math.hypot(
          drone.position.x - targetSurvivor.position.x,
          drone.position.z - targetSurvivor.position.z,
        );
        const altDiff = Math.abs(drone.position.y - INSPECT_ALTITUDE);

        // Arrival over target at confirmation altitude
        if (distH < 1.8 && altDiff < 1.5) {
          missionFsm = transitionMissionFsm(
            missionFsm,
            { type: "ARRIVED_AT_TARGET", survivorId: inspect.survivorId },
            tick,
          );
          snapshot = {
            ...snapshot,
            mission: {
              ...snapshot.mission,
              phase: missionFsm.state,
              inspect: { ...inspect, transiting: false },
            },
          };
        }
        break;
      }

      case "THERMAL_CONFIRM": {
        const inspect = snapshot.mission.inspect;
        if (!inspect) break;

        if (inspect.holdTicksRemaining > 0) {
          snapshot = {
            ...snapshot,
            mission: {
              ...snapshot.mission,
              inspect: {
                ...inspect,
                holdTicksRemaining: inspect.holdTicksRemaining - 1,
              },
            },
          };
          return;
        }

        // Hold complete: complete thermal inspection & emit alert
        completeInspection(inspect.survivorId);
        break;
      }

      case "ALERT": {
        break;
      }

      case "RTL": {
        const distToBase = Math.hypot(drone.position.x, drone.position.z);
        if (distToBase < 1.5 && drone.flightMode !== "LANDING" && drone.position.y > 0.5) {
          snapshot = {
            ...snapshot,
            drone: {
              ...drone,
              flightMode: "LANDING",
              targetPosition: { x: 0, y: 0, z: 0 },
            },
          };
        } else if (drone.position.y <= 0.1 && (drone.flightMode === "LANDED" || drone.flightMode === "LANDING")) {
          missionFsm = transitionMissionFsm(
            missionFsm,
            { type: "RTL_LANDED" },
            tick,
          );
          snapshot = {
            ...snapshot,
            drone: {
              ...drone,
              armed: false,
              flightMode: "LANDED",
              targetPosition: null,
            },
            mission: {
              ...snapshot.mission,
              phase: "IDLE",
            },
          };
        }
        break;
      }
    }
  }

  function completeInspection(survivorId: string): void {
    const survivor = snapshot.world.survivors.find((s) => s.id === survivorId);
    if (!survivor) {
      resumeSearchAfterInspect();
      return;
    }

    const distToHazard = distanceToNearestHazard(
      survivor.position,
      snapshot.world.hazards,
    );

    // Multi-Modal Sensor Fusion: Simulated YOLO + FLIR Thermal
    const fusion = fuseYoloAndThermal({
      survivorId: survivor.id,
      groundDistanceToCameraCenter: 0,
      cameraSensorRadius: snapshot.drone.sensorGroundRadius,
      trueVitals: survivor.vitalSigns,
      hazardProximityMeters: distToHazard,
    });

    missionFsm = transitionMissionFsm(
      missionFsm,
      {
        type: "THERMAL_CONFIRMED",
        survivorId: survivor.id,
        isConfirmed: fusion.isHumanConfirmed,
      },
      snapshot.clock.tick,
    );

    // Mathematical Triage Priority Score: conf × thermal × (1 / dist)
    const triageEval = evaluateSurvivorTriage({
      survivorId: survivor.id,
      confidence: fusion.fusedConfidence,
      thermalScore: fusion.thermal.thermalScore,
      distanceMeters: distToHazard,
      vitals: survivor.vitalSigns,
    });

    const rover = snapshot.world.rescueRover;
    const staging = (rover.active || rover.phase === "DELIVERED")
      ? { x: rover.position.x, z: rover.position.z }
      : {
          x: snapshot.world.stagingBase.position.x,
          z: snapshot.world.stagingBase.position.z,
        };
    const evac = snapshot.world.evacuationZone;

    // A* Ground Routing around Circular Hazard Buffers
    const rescueRoute = planRescueRouteAStar(
      staging,
      survivor.position,
      snapshot.world.hazards,
    );
    const evacuationRoute = planEvacuationRouteAStar(
      survivor.position,
      evac,
      snapshot.world.hazards,
    );

    const report = analyzeInspection({
      survivorId: survivor.id,
      heartRateBpm: survivor.vitalSigns.heartRateBpm,
      temperatureC: survivor.vitalSigns.temperatureC,
      conscious: survivor.vitalSigns.conscious,
      hazardProximityMeters: distToHazard,
    });

    const hitlCase: HitlCase = {
      survivorId: survivor.id,
      report: {
        ...report,
        priority: triageEval.priority,
        rationale: `${triageEval.priority} · Score: ${triageEval.rawPriorityScore} · ${fusion.clinicalRationale}`,
      },
      fusion,
      triageEval,
      rescue: rescueRoute,
      evacuation: evacuationRoute,
      status: "PENDING",
    };

    const updatedSurvivors = snapshot.world.survivors.map((s) =>
      s.id === survivorId
        ? {
            ...s,
            inspected: true,
            priority: triageEval.priority,
            operatorStatus: "PENDING" as const,
          }
        : s,
    );

    const uninspectedRemaining = updatedSurvivors.filter((s) => !s.inspected).length;

    missionFsm = transitionMissionFsm(
      missionFsm,
      {
        type: "ALERT_DISPATCHED",
        survivorId,
        remainingTargets: uninspectedRemaining,
      },
      snapshot.clock.tick,
    );

    snapshot = {
      ...snapshot,
      world: {
        ...snapshot.world,
        survivors: updatedSurvivors,
      },
      mission: {
        ...snapshot.mission,
        inspect: null,
        cases: [
          ...snapshot.mission.cases.filter((c) => c.survivorId !== survivorId),
          hitlCase,
        ],
        phase: missionFsm.state,
      },
    };

    if (missionFsm.state === "OPTICAL_SCAN") {
      resumeSearchAfterInspect();
    } else if (missionFsm.state === "RTL") {
      applyFlyTo({ x: 0, y: DEFAULT_SEARCH_ALTITUDE, z: 0 });
    }
  }

  function applyHitlDecision(
    survivorId: string,
    status: Exclude<OperatorCaseStatus, "NONE">,
  ): void {
    const approvedCase = snapshot.mission.cases.find(
      (c) => c.survivorId === survivorId,
    );
    let nextRover = snapshot.world.rescueRover;
    let updatedCases = snapshot.mission.cases.map((c) =>
      c.survivorId === survivorId ? { ...c, status } : c,
    );

    // If the rover is currently idle (at staging or waiting at evac exit after delivering previous survivor)
    if (status === "APPROVED" && approvedCase && !nextRover.active) {
      const targetSurvivor = snapshot.world.survivors.find(
        (s) => s.id === survivorId,
      );
      const roverStart = {
        x: nextRover.position.x,
        z: nextRover.position.z,
      };
      const dispatchRoute = targetSurvivor
        ? planRescueRouteAStar(
            roverStart,
            targetSurvivor.position,
            snapshot.world.hazards,
          ).waypoints
        : approvedCase.rescue.waypoints;

      nextRover = {
        ...nextRover,
        active: true,
        // Keep the rover at its current position! DO NOT TELEPORT to stagingBase!
        position: {
          x: nextRover.position.x,
          y: 0,
          z: nextRover.position.z,
        },
        speed: 10.0,
        targetSurvivorId: survivorId,
        phase: "TRANSIT_TO_CASUALTY",
        routeIndex: 0,
        currentRoute: dispatchRoute,
      };

      updatedCases = updatedCases.map((c) =>
        c.survivorId === survivorId
          ? {
              ...c,
              rescue: {
                kind: "RESCUE",
                waypoints: dispatchRoute,
                distanceMeters: approvedCase.rescue.distanceMeters,
              },
            }
          : c,
      );
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
        cases: updatedCases,
        phase: missionFsm.state,
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

    // Check if we've reached the current waypoint
    if (dist < 1.0) {
      // Move to next waypoint if available
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
              ? planRescueRouteAStar(
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
                cases: updatedCases.map((c) =>
                  c.survivorId === nextApproved.survivorId
                    ? {
                        ...c,
                        rescue: {
                          kind: "RESCUE",
                          waypoints: transitRoute,
                          distanceMeters: c.rescue.distanceMeters,
                        },
                      }
                    : c,
                ),
                totalRescuedCount: nextRescuedCount,
                phase: missionFsm.state,
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
                phase: missionFsm.state,
              },
            };
          }
        }
      }
    } else {
      // Move towards current waypoint
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
          search: { ...search, active: false, paused: false },
        },
      };

      if (missionFsm.state === "OPTICAL_SCAN") {
        missionFsm = transitionMissionFsm(
          missionFsm,
          { type: "SCAN_COMPLETE" },
          snapshot.clock.tick,
        );
        snapshot = {
          ...snapshot,
          mission: {
            ...snapshot.mission,
            phase: missionFsm.state,
          },
        };
        applyFlyTo({ x: 0, y: DEFAULT_SEARCH_ALTITUDE, z: 0 });
      }
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
        phase: "OPTICAL_SCAN",
        search: { ...search, waypointIndex: nextIndex },
      },
    };
  }
}
