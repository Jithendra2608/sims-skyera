/**
 * Simulated YOLO Object Detection + FLIR Thermal Sensor Fusion.
 * Implements multi-modal computer vision and sensor fusion for PS compliance.
 *
 * Domain layer: Pure TypeScript, deterministic, NO Three.js imports.
 */

export interface BoundingBox {
  readonly xmin: number;
  readonly ymin: number;
  readonly xmax: number;
  readonly ymax: number;
}

export interface YoloDetection {
  readonly detected: boolean;
  readonly classLabel: "person" | "debris" | "none";
  readonly confidence: number; // 0.0 – 1.0
  readonly bbox: BoundingBox;
}

export interface ThermalMeasurement {
  readonly bodyTemperatureC: number;
  readonly ambientTemperatureC: number;
  readonly deltaTemperatureC: number;
  readonly thermalScore: number; // 0.0 – 1.0
  readonly isHeatAnomaly: boolean;
}

export type FusionVerificationStatus =
  | "CONFIRMED_HUMAN"
  | "THERMAL_HOTSPOT_OBSCURED"
  | "OPTICAL_ONLY_SUSPECT"
  | "REJECTED_FALSE_POSITIVE";

export interface FusedDetectionReport {
  readonly survivorId: string;
  readonly yolo: YoloDetection;
  readonly thermal: ThermalMeasurement;
  readonly fusedConfidence: number; // 0.0 – 1.0
  readonly status: FusionVerificationStatus;
  readonly isHumanConfirmed: boolean;
  readonly clinicalRationale: string;
}

export interface SensorFusionInput {
  readonly survivorId: string;
  readonly groundDistanceToCameraCenter: number;
  readonly cameraSensorRadius: number;
  readonly trueVitals: {
    readonly heartRateBpm: number;
    readonly temperatureC: number;
    readonly conscious: boolean;
  };
  readonly hazardProximityMeters: number;
  readonly ambientTempC?: number;
}

const AMBIENT_TEMP_C = 20.0;

/**
 * Simulates YOLOv8/v11 real-time optical detector output.
 */
export function simulateYoloOpticalDetection(
  groundDist: number,
  sensorRadius: number,
  conscious: boolean,
): YoloDetection {
  if (groundDist > sensorRadius) {
    return {
      detected: false,
      classLabel: "none",
      confidence: 0,
      bbox: { xmin: 0, ymin: 0, xmax: 0, ymax: 0 },
    };
  }

  // Optical confidence decreases gracefully towards edge of field-of-view
  const distanceRatio = Math.min(1.0, groundDist / Math.max(1, sensorRadius));
  const baseConfidence = conscious ? 0.94 : 0.88;
  const confidence = Math.max(0.4, Number((baseConfidence - distanceRatio * 0.22).toFixed(3)));

  // Bounding box jitter centered inside the optical frame
  const cx = 0.5 + (Math.sin(groundDist * 3.7) * 0.12);
  const cy = 0.5 + (Math.cos(groundDist * 2.3) * 0.12);
  const halfW = 0.1 + (1 - distanceRatio) * 0.08;
  const halfH = 0.16 + (1 - distanceRatio) * 0.12;

  return {
    detected: true,
    classLabel: "person",
    confidence,
    bbox: {
      xmin: Number(Math.max(0, cx - halfW).toFixed(3)),
      ymin: Number(Math.max(0, cy - halfH).toFixed(3)),
      xmax: Number(Math.min(1, cx + halfW).toFixed(3)),
      ymax: Number(Math.min(1, cy + halfH).toFixed(3)),
    },
  };
}

/**
 * Simulates radiometric FLIR thermal camera output.
 */
export function simulateThermalMeasurement(
  bodyTempC: number,
  ambientTempC: number = AMBIENT_TEMP_C,
): ThermalMeasurement {
  const deltaTemp = Math.abs(bodyTempC - ambientTempC);
  // Healthy/living human body creates a ~15–19°C heat signature contrast over 20°C ambient
  // Hypothermic (34°C) gives ~14°C delta; febrile (39°C) gives ~19°C delta
  const thermalScore = Number(Math.min(1.0, Math.max(0.1, deltaTemp / 18.0)).toFixed(3));
  const isHeatAnomaly = bodyTempC <= 35.0 || bodyTempC >= 38.5;

  return {
    bodyTemperatureC: Number(bodyTempC.toFixed(1)),
    ambientTemperatureC: Number(ambientTempC.toFixed(1)),
    deltaTemperatureC: Number(deltaTemp.toFixed(1)),
    thermalScore,
    isHeatAnomaly,
  };
}

/**
 * Performs Bayesian-style Multi-Modal Sensor Fusion between YOLO and Thermal IR.
 */
export function fuseYoloAndThermal(input: SensorFusionInput): FusedDetectionReport {
  const ambient = input.ambientTempC ?? AMBIENT_TEMP_C;
  const yolo = simulateYoloOpticalDetection(
    input.groundDistanceToCameraCenter,
    input.cameraSensorRadius,
    input.trueVitals.conscious,
  );
  const thermal = simulateThermalMeasurement(input.trueVitals.temperatureC, ambient);

  // Weighted Sensor Fusion: Optical 50%, Thermal 50%
  const fusedConfidence = Number(
    (0.5 * (yolo.detected ? yolo.confidence : 0) + 0.5 * thermal.thermalScore).toFixed(3),
  );

  let status: FusionVerificationStatus = "REJECTED_FALSE_POSITIVE";
  let isHumanConfirmed = false;

  if (yolo.detected && yolo.confidence >= 0.65 && thermal.thermalScore >= 0.60) {
    status = "CONFIRMED_HUMAN";
    isHumanConfirmed = true;
  } else if (!yolo.detected && thermal.thermalScore >= 0.75) {
    status = "THERMAL_HOTSPOT_OBSCURED";
    isHumanConfirmed = true; // Confirmed obscured human under rubble
  } else if (yolo.detected && yolo.confidence >= 0.70 && thermal.thermalScore < 0.40) {
    status = "OPTICAL_ONLY_SUSPECT";
    isHumanConfirmed = false; // Cold object or mannequin
  }

  const reasons: string[] = [
    `YOLO Optical: ${yolo.detected ? `${(yolo.confidence * 100).toFixed(0)}% [${yolo.classLabel}]` : "No Visual"}`,
    `FLIR IR: ${thermal.bodyTemperatureC}°C (ΔT +${thermal.deltaTemperatureC}°C, score ${(thermal.thermalScore * 100).toFixed(0)}%)`,
    `Fused Conf: ${(fusedConfidence * 100).toFixed(0)}%`,
  ];
  if (thermal.isHeatAnomaly) {
    reasons.push(thermal.bodyTemperatureC <= 35 ? "HYPOTHERMIA" : "HYPERTHERMIA");
  }
  if (!input.trueVitals.conscious) {
    reasons.push("UNRESPONSIVE");
  }
  if (input.hazardProximityMeters < 6) {
    reasons.push(`HAZARD DANGER (${input.hazardProximityMeters.toFixed(1)}m)`);
  }

  return {
    survivorId: input.survivorId,
    yolo,
    thermal,
    fusedConfidence,
    status,
    isHumanConfirmed,
    clinicalRationale: reasons.join(" · "),
  };
}
