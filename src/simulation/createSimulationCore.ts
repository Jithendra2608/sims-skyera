import type { SimulationAdapter } from "../adapters/ports";
import type {
  DroneState,
  FlightMode,
  SimulationCore,
  SimulationSnapshot,
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

function initialSnapshot(): SimulationSnapshot {
  return {
    clock: {
      elapsedSeconds: 0,
      fixedDeltaSeconds: FIXED_DELTA_SECONDS,
      tick: 0,
    },
    world: {
      scenarioId: null,
      bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
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
    },
    mission: {
      phase: "IDLE",
    },
  };
}

/**
 * Deterministic simulation core with 60 Hz kinematics.
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
        };
      }
      return {
        ...current,
        velocity: { x: 0, y: 0, z: 0 },
        speed: 0,
        pitchRadians: 0,
        rollRadians: 0,
        flightMode: current.position.y <= 0.05 ? "LANDED" : current.flightMode,
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
        // Project horizontal velocity onto drone's local coordinate axes
        const forwardSpeed =
          Math.sin(heading) * vel.x + Math.cos(heading) * vel.z;
        const rightSpeed =
          Math.cos(heading) * vel.x - Math.sin(heading) * vel.z;

        // Nose-down pitch when moving forward; banking roll when turning/sliding
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
    };
  };

  return {
    getSnapshot: () => snapshot,
    step: () => {
      const nextDrone = updateKinematics(FIXED_DELTA_SECONDS);
      snapshot = {
        ...snapshot,
        clock: {
          ...snapshot.clock,
          elapsedSeconds:
            snapshot.clock.elapsedSeconds + snapshot.clock.fixedDeltaSeconds,
          tick: snapshot.clock.tick + 1,
        },
        drone: nextDrone,
      };
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
      };
    },
    takeoff: (targetAltitude = 8) => {
      const pos = snapshot.drone.position;
      snapshot = {
        ...snapshot,
        drone: {
          ...snapshot.drone,
          armed: true,
          flightMode: "TAKEOFF",
          targetPosition: { x: pos.x, y: Math.max(2, targetAltitude), z: pos.z },
        },
      };
    },
    flyTo: (target: Vec3) => {
      snapshot = {
        ...snapshot,
        drone: {
          ...snapshot.drone,
          armed: true,
          flightMode: "NAVIGATING",
          targetPosition: { ...target },
        },
      };
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
      };
    },
  };
}
