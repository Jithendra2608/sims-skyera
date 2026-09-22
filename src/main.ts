/**
 * SKYERA Main Application Entry.
 * Composes deterministic simulation core, local adapter,
 * Three.js 3D presentation layer, and GCS telemetry controls.
 */
import { createLocalSimulationAdapter } from "./adapters/local/localSimulationAdapter";
import { mountPresentation } from "./presentation/mountPresentation";
import { createSimulationCore } from "./simulation/createSimulationCore";

const adapter = createLocalSimulationAdapter();
const core = createSimulationCore(adapter);

const host = document.querySelector<HTMLElement>("#app");
if (!host) {
  throw new Error("Missing #app host element");
}

const presentation = mountPresentation(host, () => core.getSnapshot());

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

  updateTelemetryUI();
  requestAnimationFrame(runSimulationLoop);
}
requestAnimationFrame(runSimulationLoop);

const teleMode = document.querySelector<HTMLElement>("#tele-mode");
const teleAlt = document.querySelector<HTMLElement>("#tele-alt");
const teleSpeed = document.querySelector<HTMLElement>("#tele-speed");
const teleBattery = document.querySelector<HTMLElement>("#tele-battery");
const teleBatteryBar = document.querySelector<HTMLElement>("#tele-battery-bar");
const telePos = document.querySelector<HTMLElement>("#tele-pos");
const teleSensor = document.querySelector<HTMLElement>("#tele-sensor");
const teleContacts = document.querySelector<HTMLElement>("#tele-contacts");
const teleContactsList = document.querySelector<HTMLElement>("#tele-contacts-list");
const teleMission = document.querySelector<HTMLElement>("#tele-mission");
const teleSearch = document.querySelector<HTMLElement>("#tele-search");
const teleHitl = document.querySelector<HTMLElement>("#tele-hitl");

let lastUIUpdate = 0;

function updateTelemetryUI(): void {
  const now = performance.now();
  if (now - lastUIUpdate < 50) {
    return;
  }
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

  if (teleSensor) {
    teleSensor.textContent = `${drone.sensorGroundRadius.toFixed(1)} m`;
  }

  const detected = snapshot.world.survivors.filter((s) => s.detected);
  if (teleContacts) {
    teleContacts.textContent = `${detected.length} / ${snapshot.world.survivors.length}`;
  }
  if (teleContactsList) {
    if (detected.length === 0) {
      teleContactsList.textContent =
        "NO CONTACTS — START GRID SEARCH TO SCAN";
    } else {
      teleContactsList.textContent = detected
        .map(
          (s) =>
            `${s.id} ${s.priority} · ${s.operatorStatus} · ${s.vitalSigns.conscious ? "AWAKE" : "UNRESPONSIVE"}`,
        )
        .join("  |  ");
    }
  }

  if (teleMission) {
    teleMission.textContent = snapshot.mission.phase;
  }

  if (teleSearch) {
    const search = snapshot.mission.search;
    if (!search) {
      teleSearch.textContent = "NOT ARMED";
    } else {
      const shown = Math.max(0, search.waypointIndex + 1);
      teleSearch.textContent = `${search.pattern} ${shown}/${search.waypoints.length}${search.active ? "" : " · DONE"}`;
    }
  }

  const pending = snapshot.mission.cases.find((c) => c.status === "PENDING");
  const btnApprove = document.querySelector<HTMLButtonElement>("#btn-approve");
  if (teleHitl) {
    if (snapshot.mission.inspect) {
      teleHitl.textContent = `INSPECTING ${snapshot.mission.inspect.survivorId} · RGB+THERMAL HOLD`;
      teleHitl.classList.remove("hitl-active-alert");
      btnApprove?.classList.remove("btn-pulse");
    } else if (!pending) {
      teleHitl.textContent =
        "NO PENDING CASE — AI RECOMMENDS ONLY; HUMAN APPROVES";
      teleHitl.classList.remove("hitl-active-alert");
      btnApprove?.classList.remove("btn-pulse");
    } else {
      teleHitl.textContent = `⚠️ ACTION REQUIRED: ${pending.survivorId} (${pending.report.priority}) PENDING APPROVAL · ${pending.report.rationale}`;
      teleHitl.classList.add("hitl-active-alert");
      btnApprove?.classList.add("btn-pulse");
    }
  }

  // Update PiP camera HUD overlay
  if (pipAltVal) {
    pipAltVal.textContent = `ALT: ${drone.position.y.toFixed(1)}m`;
  }

  if (pipTargetBox && pipTargetLabel) {
    if (snapshot.mission.inspect) {
      pipTargetBox.classList.add("active");
      pipTargetLabel.textContent = `LOCK: ${snapshot.mission.inspect.survivorId}`;
    } else if (pending) {
      pipTargetBox.classList.add("active");
      pipTargetLabel.textContent = `LOCK: ${pending.survivorId}`;
    } else {
      pipTargetBox.classList.remove("active");
    }
  }

  // Trigger Mission Complete Debrief Modal
  if (
    snapshot.mission.phase === "MISSION_COMPLETE" &&
    debriefBackdrop?.classList.contains("modal-hidden") &&
    !debriefDismissed
  ) {
    showDebriefModal(snapshot);
  }
}

// Downward Gimbal Camera (PiP) Controls
const pipContainer = document.querySelector<HTMLElement>("#pip-container");
const btnPipMode = document.querySelector<HTMLButtonElement>("#btn-pip-mode");
const pipAltVal = document.querySelector<HTMLElement>("#pip-alt-val");
const pipTargetBox = document.querySelector<HTMLElement>("#pip-target-box");
const pipTargetLabel = document.querySelector<HTMLElement>("#pip-target-label");

let isThermal = false;
btnPipMode?.addEventListener("click", () => {
  isThermal = !isThermal;
  if (isThermal) {
    pipContainer?.classList.add("pip-thermal");
    btnPipMode.textContent = "OPTICAL RGB";
  } else {
    pipContainer?.classList.remove("pip-thermal");
    btnPipMode.textContent = "THERMAL IR";
  }
});

// Mission Complete Debrief Modal Controls
const debriefBackdrop = document.querySelector<HTMLElement>("#debrief-backdrop");
const debriefTime = document.querySelector<HTMLElement>("#debrief-time");
const debriefBattery = document.querySelector<HTMLElement>("#debrief-battery");
const debriefCasualties = document.querySelector<HTMLElement>("#debrief-casualties");
const debriefRecordsList = document.querySelector<HTMLElement>("#debrief-records-list");
const btnExportDebrief = document.querySelector<HTMLButtonElement>("#btn-export-debrief");
const btnResetSim = document.querySelector<HTMLButtonElement>("#btn-reset-sim");
const btnCloseDebrief = document.querySelector<HTMLButtonElement>("#btn-close-debrief");

let debriefDismissed = false;

function showDebriefModal(snapshot: ReturnType<typeof core.getSnapshot>): void {
  if (!debriefBackdrop) return;

  const totalSec = Math.round(snapshot.clock.elapsedSeconds);
  const mins = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const secs = (totalSec % 60).toString().padStart(2, "0");

  if (debriefTime) {
    debriefTime.textContent = `${mins}:${secs}`;
  }
  if (debriefBattery) {
    debriefBattery.textContent = `${(100 - snapshot.drone.batteryPercent).toFixed(1)}%`;
  }
  if (debriefCasualties) {
    debriefCasualties.textContent = `${snapshot.mission.totalRescuedCount} / ${snapshot.world.survivors.length}`;
  }

  if (debriefRecordsList) {
    debriefRecordsList.innerHTML = snapshot.world.survivors
      .map((s) => {
        const pColor =
          s.priority === "P1"
            ? "var(--danger)"
            : s.priority === "P2"
            ? "var(--warn)"
            : "var(--ok)";
        return `
          <div class="debrief-row">
            <span><strong>${s.id}</strong> (${s.name})</span>
            <span style="color: ${pColor}; font-weight: 700;">${s.priority} · ${s.vitalSigns.heartRateBpm} BPM / ${s.vitalSigns.temperatureC.toFixed(1)}°C</span>
            <span style="color: var(--ok); font-weight: 600;">EVACUATED</span>
          </div>
        `;
      })
      .join("");
  }

  debriefBackdrop.classList.remove("modal-hidden");
}

btnCloseDebrief?.addEventListener("click", () => {
  debriefBackdrop?.classList.add("modal-hidden");
  debriefDismissed = true;
});

btnResetSim?.addEventListener("click", () => {
  core.reset();
  presentation.resetCamera();
  debriefBackdrop?.classList.add("modal-hidden");
  debriefDismissed = false;
});

btnExportDebrief?.addEventListener("click", () => {
  const snapshot = core.getSnapshot();
  const report = {
    missionTitle: "SKYERA Autonomous Drone Disaster Response Debrief",
    sector: "Sector 7 Urban Industrial Complex",
    timestamp: new Date().toISOString(),
    telemetry: {
      totalMissionDurationSeconds: snapshot.clock.elapsedSeconds,
      droneFinalPosition: snapshot.drone.position,
      batteryConsumedPercent: 100 - snapshot.drone.batteryPercent,
    },
    survivorTriageRecords: snapshot.world.survivors.map((s) => ({
      id: s.id,
      name: s.name,
      location: s.position,
      priority: s.priority,
      vitals: s.vitalSigns,
      operatorCaseStatus: s.operatorStatus,
    })),
    approvedRouteCases: snapshot.mission.cases.map((c) => ({
      survivorId: c.survivorId,
      priority: c.report.priority,
      clinicalRationale: c.report.rationale,
      rescueWaypointsCount: c.rescue.waypoints.length,
      evacuationWaypointsCount: c.evacuation.waypoints.length,
      operatorStatus: c.status,
    })),
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `skyera_mission_debrief_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const btnTakeoff = document.querySelector<HTMLButtonElement>("#btn-takeoff");
btnTakeoff?.addEventListener("click", () => {
  core.abortSearch();
  core.takeoff();
});

const btnPatrol = document.querySelector<HTMLButtonElement>("#btn-patrol");
btnPatrol?.addEventListener("click", () => {
  core.startGridSearch();
});

const btnLand = document.querySelector<HTMLButtonElement>("#btn-land");
btnLand?.addEventListener("click", () => {
  core.abortSearch();
  core.land();
});

const btnArm = document.querySelector<HTMLButtonElement>("#btn-arm");
btnArm?.addEventListener("click", () => {
  const drone = core.getSnapshot().drone;
  if (drone.armed) {
    core.abortSearch();
    core.disarm();
  } else {
    core.arm();
  }
});

const btnResetCam = document.querySelector<HTMLButtonElement>("#btn-reset-cam");
btnResetCam?.addEventListener("click", () => {
  presentation.resetCamera();
});

function pendingSurvivorId(): string | null {
  return (
    core.getSnapshot().mission.cases.find((c) => c.status === "PENDING")
      ?.survivorId ?? null
  );
}

document.querySelector<HTMLButtonElement>("#btn-approve")?.addEventListener("click", () => {
  const id = pendingSurvivorId();
  if (id) {
    core.approveCase(id);
  }
});

document.querySelector<HTMLButtonElement>("#btn-reject")?.addEventListener("click", () => {
  const id = pendingSurvivorId();
  if (id) {
    core.rejectCase(id);
  }
});

document.querySelector<HTMLButtonElement>("#btn-false-pos")?.addEventListener("click", () => {
  const id = pendingSurvivorId();
  if (id) {
    core.markFalsePositive(id);
  }
});
