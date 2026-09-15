/**
 * SKYERA Main Application Entry.
 * Composes deterministic simulation core, local adapter,
 * Three.js 3D presentation layer, and GCS telemetry controls.
 */
import { createLocalSimulationAdapter } from "./adapters/local/localSimulationAdapter";
import { mountPresentation } from "./presentation/mountPresentation";
import { createSimulationCore } from "./simulation/createSimulationCore";
import type { Vec3 } from "./simulation/types";

// 1. Initialize decoupled architecture layers
const adapter = createLocalSimulationAdapter();
const core = createSimulationCore(adapter);

const host = document.querySelector<HTMLElement>("#app");
if (!host) {
  throw new Error("Missing #app host element");
}

// 2. Mount 3D Presentation with snapshot provider
const presentation = mountPresentation(host, () => core.getSnapshot());

// 3. Deterministic 60 Hz simulation clock ticker (fixed timestep accumulator)
const FIXED_STEP_SEC = 1 / 60;
let lastSimTime = performance.now();
let accumulator = 0;

function runSimulationLoop(currentTime: number): void {
  const elapsed = Math.min((currentTime - lastSimTime) / 1000, 0.1);
  lastSimTime = currentTime;
  accumulator += elapsed;

  while (accumulator >= FIXED_STEP_SEC) {
    core.step();
    accumulator -= FIXED_STEP_SEC;
  }

  updatePatrolSequence();
  updateTelemetryUI();

  requestAnimationFrame(runSimulationLoop);
}
requestAnimationFrame(runSimulationLoop);

// 4. Autonomous Patrol Waypoints Queue
const PATROL_ROUTE: ReadonlyArray<Vec3> = [
  { x: 18, y: 8, z: 18 },
  { x: -18, y: 10, z: 18 },
  { x: -18, y: 8, z: -18 },
  { x: 18, y: 10, z: -18 },
  { x: 0, y: 8, z: 0 },
];
let isPatrolling = false;
let currentWaypointIdx = 0;

function updatePatrolSequence(): void {
  if (!isPatrolling) return;

  const snapshot = core.getSnapshot();
  const drone = snapshot.drone;

  if (drone.flightMode === "HOVER" || !drone.targetPosition) {
    currentWaypointIdx = (currentWaypointIdx + 1) % PATROL_ROUTE.length;
    const nextWp = PATROL_ROUTE[currentWaypointIdx];
    core.flyTo(nextWp);
  }
}

// 5. GCS Telemetry UI Update
const teleMode = document.querySelector<HTMLElement>("#tele-mode");
const teleAlt = document.querySelector<HTMLElement>("#tele-alt");
const teleSpeed = document.querySelector<HTMLElement>("#tele-speed");
const teleBattery = document.querySelector<HTMLElement>("#tele-battery");
const teleBatteryBar = document.querySelector<HTMLElement>("#tele-battery-bar");
const telePos = document.querySelector<HTMLElement>("#tele-pos");

let lastUIUpdate = 0;

function updateTelemetryUI(): void {
  const now = performance.now();
  if (now - lastUIUpdate < 50) return; // 20 FPS UI refresh rate
  lastUIUpdate = now;

  const snapshot = core.getSnapshot();
  const drone = snapshot.drone;

  if (teleMode) {
    teleMode.textContent = drone.flightMode;
    teleMode.className = "mode-badge";
    if (drone.flightMode === "DISARMED") {
      teleMode.classList.add("mode-disarmed");
    } else if (drone.flightMode === "NAVIGATING" || drone.flightMode === "TAKEOFF") {
      teleMode.classList.add("mode-nav");
    } else {
      teleMode.classList.add("mode-active");
    }
  }

  if (teleAlt) {
    teleAlt.textContent = `${drone.position.y.toFixed(1)} m`;
  }

  if (teleSpeed) {
    teleSpeed.textContent = `${drone.speed.toFixed(1)} m/s`;
  }

  if (teleBattery) {
    const batt = Math.max(0, drone.batteryPercent);
    teleBattery.textContent = `${batt.toFixed(0)}%`;
    if (teleBatteryBar) {
      teleBatteryBar.style.width = `${batt}%`;
      teleBatteryBar.style.background =
        batt > 50 ? "var(--ok)" : batt > 20 ? "var(--warn)" : "var(--danger)";
    }
  }

  if (telePos) {
    const headingDeg = Math.round(
      ((-drone.headingRadians * 180) / Math.PI + 360) % 360,
    );
    telePos.textContent = `X:${drone.position.x.toFixed(1)} Y:${drone.position.y.toFixed(1)} Z:${drone.position.z.toFixed(1)} · ${headingDeg}°`;
  }
}

// 6. Bind Operator Flight Control Buttons
const btnTakeoff = document.querySelector<HTMLButtonElement>("#btn-takeoff");
btnTakeoff?.addEventListener("click", () => {
  isPatrolling = false;
  core.takeoff(8);
});

const btnPatrol = document.querySelector<HTMLButtonElement>("#btn-patrol");
btnPatrol?.addEventListener("click", () => {
  const drone = core.getSnapshot().drone;
  if (drone.position.y < 2) {
    core.takeoff(8);
  }
  isPatrolling = true;
  currentWaypointIdx = 0;
  core.flyTo(PATROL_ROUTE[0]);
});

const btnLand = document.querySelector<HTMLButtonElement>("#btn-land");
btnLand?.addEventListener("click", () => {
  isPatrolling = false;
  core.land();
});

const btnArm = document.querySelector<HTMLButtonElement>("#btn-arm");
btnArm?.addEventListener("click", () => {
  const drone = core.getSnapshot().drone;
  if (drone.armed) {
    isPatrolling = false;
    core.disarm();
  } else {
    core.arm();
  }
});

const btnResetCam = document.querySelector<HTMLButtonElement>("#btn-reset-cam");
btnResetCam?.addEventListener("click", () => {
  presentation.resetCamera();
});
