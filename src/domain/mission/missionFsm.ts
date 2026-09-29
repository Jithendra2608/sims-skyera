/**
 * CDR §8 Flowchart Mission State Machine.
 * Direct implementation of PS compliance sequence:
 * IDLE → TAKEOFF → TRANSIT_100M → OPTICAL_SCAN → DETECT → THERMAL_CONFIRM → ALERT → RTL
 *
 * Domain layer: Pure TypeScript, deterministic, NO Three.js imports.
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

export interface MissionFsmContext {
  readonly state: MissionStateId;
  readonly previousState: MissionStateId | null;
  readonly enteredAtTick: number;
  readonly ticksInState: number;
  /** Active target survivor ID being inspected / confirmed */
  readonly activeTargetId: string | null;
  /** Remaining queue of detected survivor IDs awaiting thermal confirmation */
  readonly pendingConfirmQueue: ReadonlyArray<string>;
  /** IDs of survivors that have been confirmed and alerted */
  readonly alertedSurvivorIds: ReadonlyArray<string>;
  /** Reason / transition log for audit */
  readonly lastTransitionReason: string;
}

export type MissionFsmEvent =
  | { readonly type: "START_MISSION" }
  | { readonly type: "TAKEOFF_ALTITUDE_REACHED"; readonly currentAltitude: number }
  | { readonly type: "TRANSIT_INGRESS_REACHED" }
  | { readonly type: "OPTICAL_CANDIDATE_FOUND"; readonly survivorId: string }
  | { readonly type: "ARRIVED_AT_TARGET"; readonly survivorId: string }
  | { readonly type: "THERMAL_CONFIRMED"; readonly survivorId: string; readonly isConfirmed: boolean }
  | { readonly type: "ALERT_DISPATCHED"; readonly survivorId: string; readonly remainingTargets: number }
  | { readonly type: "SCAN_COMPLETE" }
  | { readonly type: "RTL_LANDED" }
  | { readonly type: "EMERGENCY_RTL"; readonly reason: string };

export function createInitialMissionFsmContext(): MissionFsmContext {
  return {
    state: "IDLE",
    previousState: null,
    enteredAtTick: 0,
    ticksInState: 0,
    activeTargetId: null,
    pendingConfirmQueue: [],
    alertedSurvivorIds: [],
    lastTransitionReason: "System initialized at base",
  };
}

/**
 * Deterministic transition function for CDR §8 State Machine.
 */
export function transitionMissionFsm(
  ctx: MissionFsmContext,
  event: MissionFsmEvent,
  currentTick: number,
): MissionFsmContext {
  if (event.type === "EMERGENCY_RTL") {
    if (ctx.state === "IDLE" || ctx.state === "RTL") {
      return ctx;
    }
    return {
      ...ctx,
      previousState: ctx.state,
      state: "RTL",
      enteredAtTick: currentTick,
      ticksInState: 0,
      lastTransitionReason: `Emergency RTL triggered: ${event.reason}`,
    };
  }

  switch (ctx.state) {
    case "IDLE": {
      if (event.type === "START_MISSION") {
        return {
          ...ctx,
          previousState: "IDLE",
          state: "TAKEOFF",
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: "Mission start commanded: Ascending to 15–20m AGL",
        };
      }
      return ctx;
    }

    case "TAKEOFF": {
      if (event.type === "TAKEOFF_ALTITUDE_REACHED") {
        return {
          ...ctx,
          previousState: "TAKEOFF",
          state: "TRANSIT_100M",
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: `Target altitude reached (${event.currentAltitude.toFixed(1)}m): Beginning high-speed transit`,
        };
      }
      return ctx;
    }

    case "TRANSIT_100M": {
      if (event.type === "TRANSIT_INGRESS_REACHED") {
        return {
          ...ctx,
          previousState: "TRANSIT_100M",
          state: "OPTICAL_SCAN",
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: "Ingress waypoint reached: Commencing 15–20m lawnmower optical scan",
        };
      }
      return ctx;
    }

    case "OPTICAL_SCAN": {
      if (event.type === "OPTICAL_CANDIDATE_FOUND") {
        const nextQueue = ctx.alertedSurvivorIds.includes(event.survivorId)
          ? ctx.pendingConfirmQueue
          : Array.from(new Set([...ctx.pendingConfirmQueue, event.survivorId]));

        return {
          ...ctx,
          previousState: "OPTICAL_SCAN",
          state: "DETECT",
          activeTargetId: event.survivorId,
          pendingConfirmQueue: nextQueue.filter((id) => id !== event.survivorId),
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: `YOLO optical contact detected: ${event.survivorId}`,
        };
      }
      if (event.type === "SCAN_COMPLETE") {
        return {
          ...ctx,
          previousState: "OPTICAL_SCAN",
          state: "RTL",
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: "Lawnmower search completed all lanes: Returning to launch base",
        };
      }
      return ctx;
    }

    case "DETECT": {
      if (event.type === "ARRIVED_AT_TARGET") {
        return {
          ...ctx,
          previousState: "DETECT",
          state: "THERMAL_CONFIRM",
          activeTargetId: event.survivorId,
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: `Target ${event.survivorId} locked: Engaging FLIR thermal fusion`,
        };
      }
      return ctx;
    }

    case "THERMAL_CONFIRM": {
      if (event.type === "THERMAL_CONFIRMED") {
        return {
          ...ctx,
          previousState: "THERMAL_CONFIRM",
          state: "ALERT",
          activeTargetId: event.survivorId,
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: event.isConfirmed
            ? `Thermal signature confirmed for ${event.survivorId}: Emitting priority alert`
            : `False positive identified for ${event.survivorId}: Emitting alert report`,
        };
      }
      return ctx;
    }

    case "ALERT": {
      if (event.type === "ALERT_DISPATCHED") {
        const newAlerted = Array.from(new Set([...ctx.alertedSurvivorIds, event.survivorId]));
        // If there are pending unconfirmed contacts, service them next
        const nextTarget = ctx.pendingConfirmQueue[0];
        if (nextTarget) {
          return {
            ...ctx,
            previousState: "ALERT",
            state: "DETECT",
            activeTargetId: nextTarget,
            pendingConfirmQueue: ctx.pendingConfirmQueue.slice(1),
            alertedSurvivorIds: newAlerted,
            enteredAtTick: currentTick,
            ticksInState: 0,
            lastTransitionReason: `Alert dispatched for ${event.survivorId}: Proceeding to queued contact ${nextTarget}`,
          };
        }

        // Sector search is not aborted when a victim is found. Continue lawnmower scan
        // to complete all lines in the operational area. Drone only RTLs upon SCAN_COMPLETE or failsafe.
        return {
          ...ctx,
          previousState: "ALERT",
          state: "OPTICAL_SCAN",
          activeTargetId: null,
          alertedSurvivorIds: newAlerted,
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: `Alert dispatched for ${event.survivorId}: Resuming lawnmower optical scan to complete sector sweep`,
        };
      }
      return ctx;
    }

    case "RTL": {
      if (event.type === "RTL_LANDED") {
        return {
          ...ctx,
          previousState: "RTL",
          state: "IDLE",
          activeTargetId: null,
          enteredAtTick: currentTick,
          ticksInState: 0,
          lastTransitionReason: "Quadcopter returned to launch base and landed safely",
        };
      }
      return ctx;
    }

    default:
      return ctx;
  }
}

/** Advance one simulation tick inside the current state. */
export function tickMissionFsm(ctx: MissionFsmContext): MissionFsmContext {
  return {
    ...ctx,
    ticksInState: ctx.ticksInState + 1,
  };
}
