import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  SphereGeometry,
} from "three";
import type { HazardZone, WorldState } from "../simulation/types";

export interface DisasterEnvironmentHandle {
  readonly root: Group;
  readonly update: (world: WorldState, delta: number) => void;
  readonly dispose: () => void;
}

/** Deterministic pseudo-random number generator for reproducible procedural layout. */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Procedurally generates a photorealistic 2048x2048 disaster ground canvas texture:
 * - Weathered asphalt with subtle aggregate noise and bitumen gradation
 * - Main 2-lane disaster transit corridor with road striping, crosswalks, skid marks, oil stains
 * - Earthquake fault ruptures and cracked pavement fissures radiating through rubble zones
 * - High-contrast SAR Helipad with diagonal hazard chevrons, white H-pad and compass indices
 * - Tactical Evacuation landing pad with NATO triage cross marking
 */
function createRealisticGroundTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new CanvasTexture(canvas);
    return fallback;
  }

  // 1. Base Ground Surface (Dark crushed concrete, weathered asphalt & gravel dirt)
  ctx.fillStyle = "#1e2634";
  ctx.fillRect(0, 0, 2048, 2048);

  // High-density aggregate grain noise
  const imgData = ctx.getImageData(0, 0, 2048, 2048);
  const data = imgData.data;
  let rng = createSeededRng(0x7f4a92);
  for (let i = 0; i < data.length; i += 4) {
    const n = (rng() - 0.5) * 28;
    data[i] = Math.min(255, Math.max(0, data[i] + n));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n * 0.95));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n * 0.9));
  }
  ctx.putImageData(imgData, 0, 0);

  // Coordinate mapping: 2048 px represents 160m × 160m terrain (-80m to +80m)
  // Scale factor: 2048 / 160 = 12.8 pixels per meter
  // Center (0,0) is at (1024, 1024)
  const toPx = (m: number) => 1024 + m * 12.8;

  // 2. Ruined Road Network: Main Boulevard running North-South (Z axis)
  // Road width: 14 meters (179 px)
  const roadWidth = 14 * 12.8;
  const roadX = toPx(0) - roadWidth / 2;

  ctx.fillStyle = "#18202d";
  ctx.fillRect(roadX, 0, roadWidth, 2048);

  // Concrete Road Curbs / Shoulder borders
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 14;
  ctx.strokeRect(roadX + 7, 0, roadWidth - 14, 2048);

  // Solid White Outer Shoulder Lines
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 6;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(roadX + 24, 0);
  ctx.lineTo(roadX + 24, 2048);
  ctx.moveTo(roadX + roadWidth - 24, 0);
  ctx.lineTo(roadX + roadWidth - 24, 2048);
  ctx.stroke();

  // Double Yellow Center Lines (Dashed due to weathered state)
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 4;
  ctx.setLineDash([30, 20]);
  ctx.beginPath();
  ctx.moveTo(toPx(0) - 5, 0);
  ctx.lineTo(toPx(0) - 5, 2048);
  ctx.moveTo(toPx(0) + 5, 0);
  ctx.lineTo(toPx(0) + 5, 2048);
  ctx.stroke();
  ctx.setLineDash([]);

  // Pedestrian Crosswalk near Base Staging
  ctx.fillStyle = "#e2e8f0";
  for (let z = -12; z <= -6; z += 1.5) {
    const py = toPx(z);
    ctx.fillRect(roadX + 28, py, roadWidth - 56, 12);
  }

  // 3. Secondary Cross-Street (East-West at Z = 25m)
  const crossWidth = 10 * 12.8;
  const crossY = toPx(25) - crossWidth / 2;
  ctx.fillStyle = "#18202d";
  ctx.fillRect(0, crossY, 2048, crossWidth);

  // 4. Earthquake Fissures & Asphalt Fractures (radiating from collapse epicenter)
  ctx.strokeStyle = "#090d15";
  ctx.lineWidth = 5;
  const fractureLines = [
    [toPx(15), toPx(15), toPx(25), toPx(10), toPx(35), toPx(20)],
    [toPx(-10), toPx(12), toPx(-20), toPx(18), toPx(-30), toPx(14)],
    [toPx(5), toPx(-15), toPx(18), toPx(-22), toPx(28), toPx(-18)],
    [toPx(-12), toPx(-8), toPx(-22), toPx(-16), toPx(-32), toPx(-12)],
  ];
  fractureLines.forEach((pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) {
      ctx.lineTo(pts[i], pts[i + 1]);
    }
    ctx.stroke();
  });

  // 5. Staging Base Helipad (Origin: X = 0, Z = 0)
  const padCenterX = toPx(0);
  const padCenterY = toPx(0);
  const padRadiusPx = 5.8 * 12.8;

  // Helipad Foundation Circle
  ctx.beginPath();
  ctx.arc(padCenterX, padCenterY, padRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = "#1e293b";
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#38bdf8";
  ctx.stroke();

  // Outer Hazard Chevron Ring (Yellow & Black diagonal warning hash)
  ctx.save();
  ctx.beginPath();
  ctx.arc(padCenterX, padCenterY, padRadiusPx, 0, Math.PI * 2);
  ctx.arc(padCenterX, padCenterY, padRadiusPx - 18, 0, Math.PI * 2, true);
  ctx.clip();
  ctx.fillStyle = "#eab308";
  ctx.fillRect(padCenterX - padRadiusPx, padCenterY - padRadiusPx, padRadiusPx * 2, padRadiusPx * 2);
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 14;
  for (let d = -padRadiusPx * 2; d < padRadiusPx * 2; d += 28) {
    ctx.beginPath();
    ctx.moveTo(padCenterX + d, padCenterY - padRadiusPx);
    ctx.lineTo(padCenterX + d + padRadiusPx * 2, padCenterY + padRadiusPx);
    ctx.stroke();
  }
  ctx.restore();

  // White Helipad "H" Marking
  ctx.fillStyle = "#ffffff";
  const hW = 10;
  const hH = 50;
  ctx.fillRect(padCenterX - 22, padCenterY - hH / 2, hW, hH);
  ctx.fillRect(padCenterX + 12, padCenterY - hH / 2, hW, hH);
  ctx.fillRect(padCenterX - 22, padCenterY - 5, 44, 10);

  // 6. Evacuation Base Zone (X = -6m, Z = 38m)
  const evacCenterX = toPx(-6);
  const evacCenterY = toPx(38);
  const evacRadiusPx = 3.6 * 12.8;

  ctx.beginPath();
  ctx.arc(evacCenterX, evacCenterY, evacRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = "#064e3b";
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#10b981";
  ctx.stroke();

  // Medical Triage Green Cross
  ctx.fillStyle = "#ecfdf5";
  ctx.fillRect(evacCenterX - 7, evacCenterY - 26, 14, 52);
  ctx.fillRect(evacCenterX - 26, evacCenterY - 7, 52, 14);

  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 8;
  return texture;
}

/**
 * Creates the high-fidelity 3D procedural disaster environment.
 */
export function createDisasterEnvironment(): DisasterEnvironmentHandle {
  const root = new Group();
  const rng = createSeededRng(0x42f9e1);

  // 1. Textures & Materials
  const groundTexture = createRealisticGroundTexture();
  const groundMaterial = new MeshStandardMaterial({
    map: groundTexture,
    roughness: 0.88,
    metalness: 0.12,
  });

  const concreteMaterial = new MeshStandardMaterial({
    color: 0x334155, // Weathered architectural concrete
    roughness: 0.85,
    metalness: 0.15,
  });

  const damagedFacadeMaterial = new MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.92,
    metalness: 0.2,
  });

  const brokenSlabMaterial = new MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.95,
    metalness: 0.1,
  });

  const rubbleMaterial = new MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.95,
    metalness: 0.15,
  });

  const steelBeamMaterial = new MeshStandardMaterial({
    color: 0x991b1b, // Industrial primer red / oxidized structural steel
    roughness: 0.65,
    metalness: 0.75,
  });

  const rebarMaterial = new MeshStandardMaterial({
    color: 0x78350f, // Rusted iron rebar
    roughness: 0.7,
    metalness: 0.8,
  });

  const glassWindowMaterial = new MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0.5,
  });

  // 2. High-Fidelity Ground Plane
  const groundMesh = new Mesh(new PlaneGeometry(160, 160), groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = 0;
  groundMesh.receiveShadow = true;
  root.add(groundMesh);

  // Staging Base Helipad 3D Platform (Raised concrete plinth)
  const stagingGroup = new Group();
  root.add(stagingGroup);

  const helipadPlinth = new Mesh(
    new CylinderGeometry(6.2, 6.5, 0.18, 48),
    new MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 }),
  );
  helipadPlinth.position.set(0, 0.09, 0);
  helipadPlinth.receiveShadow = true;
  stagingGroup.add(helipadPlinth);

  // Helipad Perimeter LED Inset Lights
  const helipadLedMat = new MeshBasicMaterial({ color: 0x10b981 });
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const lx = Math.cos(angle) * 5.9;
    const lz = Math.sin(angle) * 5.9;
    const led = new Mesh(new CylinderGeometry(0.12, 0.12, 0.08, 12), helipadLedMat);
    led.position.set(lx, 0.2, lz);
    stagingGroup.add(led);
  }

  // 3. Incident Command Field Operations Base Camp (near staging pad)
  const baseCampGroup = new Group();
  root.add(baseCampGroup);

  // Operational Field Command Tent 1 (Khaki/Orange Heavy Vinyl)
  const tentMat = new MeshStandardMaterial({ color: 0xd97706, roughness: 0.85 });
  const tentFrameMat = new MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.7 });
  const tent1 = new Mesh(new CylinderGeometry(2.4, 2.4, 6.0, 16, 1, false, 0, Math.PI), tentMat);
  tent1.rotation.z = Math.PI / 2;
  tent1.rotation.y = Math.PI / 4;
  tent1.position.set(-8.5, 1.2, -6.5);
  tent1.castShadow = true;
  tent1.receiveShadow = true;
  baseCampGroup.add(tent1);

  // Field Medical Triage Tent 2 (Olive Drab)
  const tent2Mat = new MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.85 });
  const tent2 = new Mesh(new CylinderGeometry(2.2, 2.2, 5.5, 16, 1, false, 0, Math.PI), tent2Mat);
  tent2.rotation.z = Math.PI / 2;
  tent2.rotation.y = -Math.PI / 6;
  tent2.position.set(-8.5, 1.1, 7.5);
  tent2.castShadow = true;
  tent2.receiveShadow = true;
  baseCampGroup.add(tent2);

  // Mobile Incident Command Satellite Uplink Vehicle (Van)
  const vanMat = new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.4 });
  const van = new Mesh(new BoxGeometry(2.2, 1.8, 4.8), vanMat);
  van.position.set(-10, 1.0, 0);
  van.castShadow = true;
  van.receiveShadow = true;
  baseCampGroup.add(van);

  // Satellite Comms Dish on Van Roof
  const dish = new Mesh(
    new CylinderGeometry(0.7, 0.1, 0.4, 16, 1, true),
    new MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.6 }),
  );
  dish.rotation.x = Math.PI / 3;
  dish.position.set(-10, 2.2, 0.5);
  baseCampGroup.add(dish);

  // Windsock Mast
  const mast = new Mesh(new CylinderGeometry(0.04, 0.05, 4.5, 8), tentFrameMat);
  mast.position.set(7.5, 2.25, -6.5);
  mast.castShadow = true;
  baseCampGroup.add(mast);
  const windsock = new Mesh(
    new CylinderGeometry(0.25, 0.1, 1.2, 12),
    new MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 }),
  );
  windsock.rotation.z = Math.PI / 2;
  windsock.position.set(8.0, 4.2, -6.5);
  baseCampGroup.add(windsock);

  // HAZMAT / Fuel Spill Drums
  const drumMatYellow = new MeshStandardMaterial({ color: 0xeab308, roughness: 0.5, metalness: 0.5 });
  const drumMatBlue = new MeshStandardMaterial({ color: 0x2563eb, roughness: 0.5, metalness: 0.5 });
  [
    { x: 7.2, z: 5.5, mat: drumMatYellow },
    { x: 7.9, z: 5.7, mat: drumMatYellow },
    { x: 7.5, z: 6.3, mat: drumMatBlue },
  ].forEach((pos) => {
    const drum = new Mesh(new CylinderGeometry(0.35, 0.35, 1.0, 16), pos.mat);
    drum.position.set(pos.x, 0.5, pos.z);
    drum.castShadow = true;
    baseCampGroup.add(drum);
  });

  // 4. Urban Street Infrastructure: Road Barriers & Street Lights
  const infrastructureGroup = new Group();
  root.add(infrastructureGroup);

  // Concrete Jersey Barriers along damaged road sectors
  const barrierMat = new MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 });
  const barrierSpecs = [
    { x: -7.5, z: -18, rotY: 0 },
    { x: -7.5, z: -15, rotY: 0 },
    { x: 7.5, z: -18, rotY: 0 },
    { x: 7.5, z: -15, rotY: 0 },
    { x: -7.5, z: 12, rotY: 0.15 },
    { x: -7.2, z: 15, rotY: 0.15 },
  ];
  barrierSpecs.forEach((spec) => {
    const barrier = new Mesh(new BoxGeometry(0.45, 0.85, 2.8), barrierMat);
    barrier.position.set(spec.x, 0.42, spec.z);
    barrier.rotation.y = spec.rotY;
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    infrastructureGroup.add(barrier);
  });

  // Street Light Poles with Cantilevered Luminaires
  const poleMat = new MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.7 });
  const lightHeadMat = new MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
  const lightPolePositions = [
    { x: 8.5, z: -35, tilt: 0 },
    { x: 8.5, z: -10, tilt: 0.08 },
    { x: 8.5, z: 15, tilt: -0.15 },
    { x: -8.5, z: -35, tilt: -0.05 },
    { x: -8.5, z: 15, tilt: 0.2 },
  ];
  lightPolePositions.forEach((pos) => {
    const poleGroup = new Group();
    poleGroup.position.set(pos.x, 0, pos.z);
    poleGroup.rotation.z = pos.tilt;

    const verticalPole = new Mesh(new CylinderGeometry(0.12, 0.16, 7.5, 12), poleMat);
    verticalPole.position.y = 3.75;
    verticalPole.castShadow = true;
    poleGroup.add(verticalPole);

    const arm = new Mesh(new BoxGeometry(1.6, 0.1, 0.1), poleMat);
    arm.position.set(pos.x > 0 ? -0.8 : 0.8, 7.4, 0);
    poleGroup.add(arm);

    const luminaire = new Mesh(new BoxGeometry(0.7, 0.15, 0.3), lightHeadMat);
    luminaire.position.set(pos.x > 0 ? -1.5 : 1.5, 7.3, 0);
    poleGroup.add(luminaire);

    infrastructureGroup.add(poleGroup);
  });

  // 5. Earthquake Disaster Scene: Heavily Damaged Multi-Story Architecture
  const earthquakeGroup = new Group();
  root.add(earthquakeGroup);

  const buildingsGroup = new Group();
  earthquakeGroup.add(buildingsGroup);

  const buildingSpecs = [
    // Sector East Block: Collapsed Commercial Complex
    { x: 38, z: 26, w: 16, h: 24, d: 14, rotY: 0.15, shear: 0.12, stories: 6 },
    { x: 42, z: 8, w: 12, h: 16, d: 12, rotY: -0.2, shear: 0.18, stories: 4 },
    { x: 40, z: -28, w: 18, h: 12, d: 16, rotY: 0.05, shear: 0.06, stories: 3 },
    // Sector West Block: Pancaked Residential High-Rise
    { x: -38, z: 26, w: 18, h: 14, d: 16, rotY: -0.1, shear: 0.22, stories: 4 },
    { x: -42, z: 6, w: 14, h: 20, d: 12, rotY: 0.28, shear: 0.08, stories: 5 },
    { x: -38, z: -28, w: 16, h: 10, d: 18, rotY: -0.25, shear: 0.14, stories: 2 },
  ];

  buildingSpecs.forEach((spec) => {
    const bGroup = new Group();
    bGroup.position.set(spec.x, spec.h / 2, spec.z);
    bGroup.rotation.y = spec.rotY;
    if (spec.shear > 0) {
      bGroup.rotation.z = spec.shear * 0.35;
    }

    // Main Structural Core
    const coreMesh = new Mesh(
      new BoxGeometry(spec.w, spec.h, spec.d),
      concreteMaterial,
    );
    coreMesh.castShadow = true;
    coreMesh.receiveShadow = true;
    bGroup.add(coreMesh);

    // Architectural Facade Window Bands & Balconies
    const storyHeight = spec.h / spec.stories;
    for (let s = 0; s < spec.stories; s++) {
      const sy = -spec.h / 2 + s * storyHeight + storyHeight * 0.5;
      const windowBand = new Mesh(
        new BoxGeometry(spec.w * 0.88, storyHeight * 0.45, spec.d + 0.1),
        glassWindowMaterial,
      );
      windowBand.position.y = sy;
      bGroup.add(windowBand);
    }

    // Fractured Rooftop Slab with exposed cavity
    const roofFracture = new Mesh(
      new BoxGeometry(spec.w * 0.85, 1.4, spec.d * 0.85),
      brokenSlabMaterial,
    );
    roofFracture.position.set(spec.w * 0.08, spec.h / 2 + 0.6, 0);
    roofFracture.rotation.z = 0.22;
    roofFracture.castShadow = true;
    bGroup.add(roofFracture);

    // Rooftop HVAC & Elevator Housing
    const hvac = new Mesh(
      new BoxGeometry(spec.w * 0.25, 1.8, spec.d * 0.25),
      new MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.6 }),
    );
    hvac.position.set(-spec.w * 0.2, spec.h / 2 + 0.9, spec.d * 0.2);
    bGroup.add(hvac);

    // Protruding Steel I-Beams from shattered concrete corners
    for (let b = 0; b < 4; b++) {
      const beam = new Mesh(new BoxGeometry(0.3, 0.3, 3.5), steelBeamMaterial);
      beam.position.set(
        (rng() - 0.5) * spec.w * 0.8,
        (rng() - 0.5) * spec.h * 0.6,
        spec.d / 2 + 1.2,
      );
      beam.rotation.set(rng() * 0.8, rng() * 0.8, rng() * 0.8);
      beam.castShadow = true;
      bGroup.add(beam);
    }

    // Exposed Twisted Rebar Rods
    for (let r = 0; r < 6; r++) {
      const rebar = new Mesh(new CylinderGeometry(0.025, 0.025, 2.4, 6), rebarMaterial);
      rebar.position.set(
        (rng() - 0.5) * spec.w * 0.9,
        (rng() - 0.5) * spec.h * 0.8,
        spec.d / 2 + 0.8,
      );
      rebar.rotation.set(rng() * 1.5, rng() * 1.5, rng() * 1.5);
      bGroup.add(rebar);
    }

    buildingsGroup.add(bGroup);

    // Collapsed Slabs leaning against the base
    for (let sl = 0; sl < 3; sl++) {
      const slabW = 3.5 + rng() * 2.5;
      const slabL = 4.0 + rng() * 3.0;
      const slab = new Mesh(new BoxGeometry(slabW, 0.45, slabL), brokenSlabMaterial);
      const angle = (sl / 3) * Math.PI * 2 + rng() * 0.5;
      const dist = spec.w / 2 + 3.0 + rng() * 2.0;
      slab.position.set(
        spec.x + Math.cos(angle) * dist,
        0.8 + rng() * 0.6,
        spec.z + Math.sin(angle) * dist,
      );
      slab.rotation.set(0.4 + rng() * 0.4, rng() * Math.PI, 0.3 + rng() * 0.3);
      slab.castShadow = true;
      slab.receiveShadow = true;
      buildingsGroup.add(slab);
    }

    // Concrete rubble debris scree field
    for (let r = 0; r < 8; r++) {
      const angle = (r / 8) * Math.PI * 2;
      const dist = spec.w / 2 + 2.5 + rng() * 4.5;
      const rx = spec.x + Math.cos(angle) * dist;
      const rz = spec.z + Math.sin(angle) * dist;
      const size = 0.8 + rng() * 2.2;

      const rubble = new Mesh(
        new BoxGeometry(size, size * 0.55, size * 0.75),
        rubbleMaterial,
      );
      rubble.position.set(rx, size * 0.28, rz);
      rubble.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      rubble.castShadow = true;
      rubble.receiveShadow = true;
      buildingsGroup.add(rubble);
    }
  });

  // 6. Dedicated Earthquake Disaster Zone (Behind main buildings, far from takeoff)
  const earthquakeZoneGroup = new Group();
  earthquakeGroup.add(earthquakeZoneGroup);

  // Position the earthquake zone in the background (positive Z, behind main structures)
  const earthquakeZoneCenter = { x: 0, z: 45 };
  const earthquakeZoneRadius = 25;

  // Large rock debris and fractured concrete blocks
  const rockMaterial = new MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.95,
    metalness: 0.1,
  });

  const fracturedConcreteMaterial = new MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.92,
    metalness: 0.15,
  });

  // Generate large rock debris scattered across the earthquake zone
  for (let i = 0; i < 35; i++) {
    const angle = (i / 35) * Math.PI * 2 + rng() * 0.5;
    const dist = 5 + rng() * earthquakeZoneRadius;
    const rockX = earthquakeZoneCenter.x + Math.cos(angle) * dist;
    const rockZ = earthquakeZoneCenter.z + Math.sin(angle) * dist;
    const rockSize = 1.5 + rng() * 3.5;

    const rock = new Mesh(
      new BoxGeometry(rockSize, rockSize * 0.7, rockSize * 0.8),
      rockMaterial,
    );
    rock.position.set(rockX, rockSize * 0.35, rockZ);
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rock.castShadow = true;
    rock.receiveShadow = true;
    earthquakeZoneGroup.add(rock);
  }

  // Fractured concrete slabs and building debris
  for (let i = 0; i < 25; i++) {
    const angle = (i / 25) * Math.PI * 2 + rng() * 0.3;
    const dist = 8 + rng() * (earthquakeZoneRadius - 5);
    const slabX = earthquakeZoneCenter.x + Math.cos(angle) * dist;
    const slabZ = earthquakeZoneCenter.z + Math.sin(angle) * dist;
    const slabW = 2.0 + rng() * 4.0;
    const slabL = 2.5 + rng() * 5.0;

    const slab = new Mesh(
      new BoxGeometry(slabW, 0.6, slabL),
      fracturedConcreteMaterial,
    );
    slab.position.set(slabX, 0.3, slabZ);
    slab.rotation.set(0.2 + rng() * 0.4, rng() * Math.PI, 0.15 + rng() * 0.3);
    slab.castShadow = true;
    slab.receiveShadow = true;
    earthquakeZoneGroup.add(slab);
  }

  // Cracked ground geometry (using irregular polygons to simulate earthquake fissures)
  const crackMaterial = new MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 1.0,
    metalness: 0.0,
  });

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const startDist = 3;
    const endDist = earthquakeZoneRadius - 2;
    const startX = earthquakeZoneCenter.x + Math.cos(angle) * startDist;
    const startZ = earthquakeZoneCenter.z + Math.sin(angle) * startDist;
    const endX = earthquakeZoneCenter.x + Math.cos(angle + rng() * 0.3) * endDist;
    const endZ = earthquakeZoneCenter.z + Math.sin(angle + rng() * 0.3) * endDist;

    const crackLength = Math.hypot(endX - startX, endZ - startZ);
    const crack = new Mesh(
      new BoxGeometry(0.3 + rng() * 0.5, 0.15, crackLength),
      crackMaterial,
    );
    crack.position.set((startX + endX) / 2, 0.075, (startZ + endZ) / 2);
    crack.rotation.y = Math.atan2(endX - startX, endZ - startZ);
    earthquakeZoneGroup.add(crack);
  }

  // Trapped survivors positioned under/partially covered by debris
  const trappedSurvivorPositions = [
    { x: 8, z: 42 },
    { x: -6, z: 48 },
    { x: 12, z: 38 },
    { x: -10, z: 44 },
    { x: 5, z: 52 },
  ];

  trappedSurvivorPositions.forEach((pos) => {
    // Create trapped survivor visual (partially covered by debris)
    const trappedGroup = new Group();
    trappedGroup.position.set(pos.x, 0, pos.z);

    // Survivor body (visible part)
    const trappedBodyMat = new MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.8,
    });
    const body = new Mesh(new BoxGeometry(0.7, 0.25, 0.4), trappedBodyMat);
    body.position.y = 0.125;
    body.castShadow = true;
    trappedGroup.add(body);

    // Head
    const head = new Mesh(
      new SphereGeometry(0.15, 12, 10),
      new MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.6 }),
    );
    head.position.set(0.35, 0.2, 0);
    trappedGroup.add(head);

    // Covering debris rock (partially covering the survivor)
    const coveringRock = new Mesh(
      new BoxGeometry(1.8 + rng() * 1.2, 1.2 + rng() * 0.8, 1.5 + rng() * 1.0),
      rockMaterial,
    );
    coveringRock.position.set(0.3 + rng() * 0.5, 0.8 + rng() * 0.4, 0.2 + rng() * 0.3);
    coveringRock.rotation.set(0.3 + rng() * 0.2, rng() * 0.5, 0.2 + rng() * 0.3);
    coveringRock.castShadow = true;
    trappedGroup.add(coveringRock);

    // Add small debris around trapped survivor
    for (let d = 0; d < 3; d++) {
      const debris = new Mesh(
        new BoxGeometry(0.4 + rng() * 0.4, 0.3 + rng() * 0.3, 0.4 + rng() * 0.4),
        fracturedConcreteMaterial,
      );
      debris.position.set(
        (rng() - 0.5) * 2.5,
        0.15 + rng() * 0.2,
        (rng() - 0.5) * 2.0,
      );
      debris.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      trappedGroup.add(debris);
    }

    earthquakeZoneGroup.add(trappedGroup);
  });

  // 7. Atmospheric Dust & Smoke Particle Systems (Enhanced for earthquake zone)
  const PARTICLE_COUNT = 280;
  const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
  const particleVelocities: { x: number; y: number; z: number; resetY: number }[] = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Distribute particles across multiple hazard zones including earthquake zone
    let cluster;
    if (i < 80) {
      // Earthquake zone particles (background)
      cluster = { x: earthquakeZoneCenter.x, z: earthquakeZoneCenter.z };
    } else if (i < 180) {
      // Eastern fire hazard and western collapse
      cluster = i % 2 === 0 ? { x: 18, z: -16 } : { x: -14, z: 15 };
    } else {
      // Random spread across disaster area
      cluster = { x: (rng() - 0.5) * 40, z: (rng() - 0.5) * 40 };
    }

    const px = cluster.x + (rng() - 0.5) * 15;
    const py = 0.5 + rng() * 10;
    const pz = cluster.z + (rng() - 0.5) * 15;

    particlePositions[i * 3] = px;
    particlePositions[i * 3 + 1] = py;
    particlePositions[i * 3 + 2] = pz;

    particleVelocities.push({
      x: (rng() - 0.5) * 0.25,
      y: 0.3 + rng() * 0.6,
      z: (rng() - 0.5) * 0.25,
      resetY: 0.5 + rng() * 2.0,
    });
  }

  const particleGeom = new BufferGeometry();
  particleGeom.setAttribute("position", new BufferAttribute(particlePositions, 3));
  const particleMat = new PointsMaterial({
    color: 0x94a3b8,
    size: 1.4,
    transparent: true,
    opacity: 0.4,
  });
  const smokeParticles = new Points(particleGeom, particleMat);
  root.add(smokeParticles);

  // 7. Tsunami / Coastal Surge Scenario 3D Assets
  const tsunamiGroup = new Group();
  root.add(tsunamiGroup);
  tsunamiGroup.visible = false;

  const waterMaterial = new MeshStandardMaterial({
    color: 0x0369a1,
    roughness: 0.12,
    metalness: 0.8,
    transparent: true,
    opacity: 0.68,
    side: DoubleSide,
  });
  const waterMesh = new Mesh(new PlaneGeometry(150, 150), waterMaterial);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = 0.35;
  tsunamiGroup.add(waterMesh);

  // Floating Shipping Containers
  interface FloatingContainer {
    mesh: Mesh;
    baseY: number;
    baseRotZ: number;
  }
  const floatingContainers: FloatingContainer[] = [];
  const containerColors = [0xd97706, 0x2563eb, 0xdc2626, 0x059669, 0xca8a04];
  const containerSpecs = [
    { x: -22, y: 0.9, z: 12, rotY: 0.35, rotZ: 0.08, col: 0 },
    { x: -18, y: 0.75, z: -18, rotY: -0.4, rotZ: -0.06, col: 1 },
    { x: 24, y: 0.95, z: -12, rotY: 0.25, rotZ: 0.1, col: 2 },
    { x: 26, y: 0.8, z: 14, rotY: -0.2, rotZ: -0.05, col: 3 },
    { x: 6, y: 0.65, z: -22, rotY: 0.8, rotZ: 0.07, col: 4 },
  ];

  containerSpecs.forEach((spec) => {
    const cMat = new MeshStandardMaterial({
      color: containerColors[spec.col],
      roughness: 0.45,
      metalness: 0.55,
    });
    const cMesh = new Mesh(new BoxGeometry(2.5, 2.6, 6.2), cMat);
    cMesh.position.set(spec.x, spec.y, spec.z);
    cMesh.rotation.y = spec.rotY;
    cMesh.rotation.z = spec.rotZ;
    cMesh.castShadow = true;
    tsunamiGroup.add(cMesh);
    floatingContainers.push({ mesh: cMesh, baseY: spec.y, baseRotZ: spec.rotZ });
  });

  // 8. Hazard Visual Overlays (Fires, Floods, Chemical zones)
  const hazardsGroup = new Group();
  root.add(hazardsGroup);
  const hazardVisuals = new Map<
    string,
    { group: Group; fill: MeshBasicMaterial | MeshStandardMaterial; pulse: boolean; kind: string }
  >();

  const createHazardVisual = (hazard: HazardZone): void => {
    const group = new Group();
    group.position.set(hazard.center.x, 0, hazard.center.z);

    if (hazard.kind === "FIRE") {
      const fill = new MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.24,
        side: DoubleSide,
      });
      const cylinder = new Mesh(
        new CylinderGeometry(hazard.radius, hazard.radius, 5, 32, 1, true),
        fill,
      );
      cylinder.position.y = 2.5;
      group.add(cylinder);

      const ring = new Mesh(
        new RingGeometry(hazard.radius - 0.4, hazard.radius + 0.3, 48),
        new MeshBasicMaterial({
          color: 0xf97316,
          transparent: true,
          opacity: 0.85,
          side: DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);

      hazardsGroup.add(group);
      hazardVisuals.set(hazard.id, { group, fill, pulse: true, kind: hazard.kind });
      return;
    }

    if (hazard.kind === "FLOOD") {
      const fill = new MeshStandardMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.65,
        roughness: 0.1,
        metalness: 0.7,
      });
      const disc = new Mesh(new CircleGeometry(hazard.radius, 36), fill);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.05;
      group.add(disc);

      const ring = new Mesh(
        new RingGeometry(hazard.radius - 0.4, hazard.radius + 0.3, 48),
        new MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.75,
          side: DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);

      hazardsGroup.add(group);
      hazardVisuals.set(hazard.id, { group, fill, pulse: false, kind: hazard.kind });
      return;
    }

    if (hazard.kind === "COLLAPSE") {
      // Earthquake/Structural Collapse hazard - distinctive brown/dark visualization
      const fill = new MeshBasicMaterial({
        color: 0x57534e, // Stone/brown color for earthquake zone
        transparent: true,
        opacity: 0.15,
        side: DoubleSide,
      });
      const cylinder = new Mesh(
        new CylinderGeometry(hazard.radius, hazard.radius, 4.0, 32, 1, true),
        fill,
      );
      cylinder.position.y = 2.0;
      group.add(cylinder);

      // Prominent earthquake zone indicator ring (dark brown)
      const ring = new Mesh(
        new RingGeometry(hazard.radius - 0.5, hazard.radius + 0.4, 64),
        new MeshBasicMaterial({
          color: 0x78716c, // Dark brown/stone ring
          transparent: true,
          opacity: 0.9,
          side: DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      group.add(ring);

      // Inner dashed ring for earthquake zone emphasis
      const innerRing = new Mesh(
        new RingGeometry(hazard.radius - 2.0, hazard.radius - 1.5, 48),
        new MeshBasicMaterial({
          color: 0xa8a29e,
          transparent: true,
          opacity: 0.7,
          side: DoubleSide,
        }),
      );
      innerRing.rotation.x = -Math.PI / 2;
      innerRing.position.y = 0.06;
      group.add(innerRing);

      hazardsGroup.add(group);
      hazardVisuals.set(hazard.id, { group, fill, pulse: true, kind: hazard.kind });
      return;
    }

    // Default fallback (should not be reached with current hazard types)
    const fill = new MeshBasicMaterial({
      color: 0xa16207,
      transparent: true,
      opacity: 0.22,
      side: DoubleSide,
    });
    const cylinder = new Mesh(
      new CylinderGeometry(hazard.radius, hazard.radius, 3.5, 28, 1, true),
      fill,
    );
    cylinder.position.y = 1.75;
    group.add(cylinder);

    const ring = new Mesh(
      new RingGeometry(hazard.radius - 0.4, hazard.radius + 0.3, 48),
      new MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.85,
        side: DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);

    hazardsGroup.add(group);
    hazardVisuals.set(hazard.id, { group, fill, pulse: true, kind: "UNKNOWN" });
  };

  // 9. Realistic Survivors with Space Blankets & Beacon Markers
  const survivorsGroup = new Group();
  root.add(survivorsGroup);
  const survivorVisuals = new Map<
    string,
    { marker: Group; update: (detected: boolean, time: number) => void }
  >();

  const createSurvivorVisual = (
    id: string,
    initialPos: { x: number; y: number; z: number },
  ) => {
    const marker = new Group();
    marker.position.set(initialPos.x, 0, initialPos.z);

    // High-visibility Emergency Thermal Space Blanket (reflective metallic gold)
    const blanketMat = new MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.25,
      metalness: 0.85,
    });
    const torso = new Mesh(new BoxGeometry(0.85, 0.28, 0.48), blanketMat);
    torso.position.y = 0.14;
    torso.castShadow = true;
    marker.add(torso);

    const head = new Mesh(
      new SphereGeometry(0.18, 12, 10),
      new MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.6 }),
    );
    head.position.set(0.52, 0.18, 0);
    marker.add(head);

    // Stretcher / Backboard Spine Frame
    const stretcher = new Mesh(
      new BoxGeometry(1.2, 0.08, 0.55),
      new MeshStandardMaterial({ color: 0xd97706, roughness: 0.6 }),
    );
    stretcher.position.y = 0.04;
    marker.add(stretcher);

    // Target detection beacon pillar & rotating diamond badge
    const beaconMat = new MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.75,
    });
    const beacon = new Mesh(new CylinderGeometry(0.06, 0.06, 5.0, 8), beaconMat);
    beacon.position.y = 2.5;
    beacon.visible = false;
    marker.add(beacon);

    const badge = new Mesh(
      new SphereGeometry(0.4, 8, 8),
      new MeshBasicMaterial({ color: 0x34d399, wireframe: true }),
    );
    badge.position.y = 5.2;
    badge.visible = false;
    marker.add(badge);

    const auraMat = new MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.25,
      side: DoubleSide,
    });
    const aura = new Mesh(new CircleGeometry(1.6, 24), auraMat);
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.04;
    marker.add(aura);

    survivorsGroup.add(marker);

    survivorVisuals.set(id, {
      marker,
      update: (detected: boolean, time: number) => {
        if (detected) {
          beacon.visible = true;
          badge.visible = true;
          badge.rotation.y += 0.03;
          badge.rotation.x += 0.02;
          const pulse = (Math.sin(time * 6) + 1) * 0.5;
          beaconMat.opacity = 0.45 + pulse * 0.5;
          auraMat.color.setHex(0x34d399);
          auraMat.opacity = 0.6 + pulse * 0.35;
        } else {
          beacon.visible = false;
          badge.visible = false;
          const breathe = (Math.sin(time * 2) + 1) * 0.5;
          auraMat.opacity = 0.15 + breathe * 0.15;
        }
      },
    });
  };

  // 10. First Responder Ground Rescue Rover (with functional tactical lights)
  const roverGroup = new Group();
  root.add(roverGroup);

  const roverChassisMat = new MeshStandardMaterial({
    color: 0xea580c, // Tactical SAR Orange
    roughness: 0.4,
    metalness: 0.35,
  });
  const chassis = new Mesh(new BoxGeometry(1.6, 0.44, 2.6), roverChassisMat);
  chassis.position.y = 0.46;
  chassis.castShadow = true;
  roverGroup.add(chassis);

  const cabin = new Mesh(
    new BoxGeometry(1.3, 0.48, 1.6),
    new MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.5 }),
  );
  cabin.position.set(0, 0.84, -0.2);
  cabin.castShadow = true;
  roverGroup.add(cabin);

  // Rover Windshield
  const windshield = new Mesh(
    new BoxGeometry(1.2, 0.32, 0.08),
    new MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.75 }),
  );
  windshield.position.set(0, 0.84, 0.6);
  windshield.rotation.x = -0.2;
  roverGroup.add(windshield);

  // 6 All-Terrain Rubber Wheels
  const wheelGeom = new CylinderGeometry(0.38, 0.38, 0.3, 16);
  const wheelMat = new MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95 });
  const wheels: Mesh[] = [];
  const wheelOffsets = [
    { x: -0.94, z: -0.85 },
    { x: -0.94, z: 0.0 },
    { x: -0.94, z: 0.85 },
    { x: 0.94, z: -0.85 },
    { x: 0.94, z: 0.0 },
    { x: 0.94, z: 0.85 },
  ];
  wheelOffsets.forEach((pos) => {
    const w = new Mesh(wheelGeom, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(pos.x, 0.38, pos.z);
    w.castShadow = true;
    roverGroup.add(w);
    wheels.push(w);
  });

  // Emergency Strobe Lightbar
  const redStrobeMat = new MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9 });
  const redStrobe = new Mesh(new BoxGeometry(0.3, 0.1, 0.14), redStrobeMat);
  redStrobe.position.set(-0.25, 1.15, -0.2);
  roverGroup.add(redStrobe);

  const blueStrobeMat = new MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9 });
  const blueStrobe = new Mesh(new BoxGeometry(0.3, 0.1, 0.14), blueStrobeMat);
  blueStrobe.position.set(0.25, 1.15, -0.2);
  roverGroup.add(blueStrobe);

  let pulseTimer = 0;

  return {
    root,
    update: (world: WorldState, delta: number) => {
      pulseTimer += delta;

      // Animate smoke & dust particles
      const posAttr = smokeParticles.geometry.getAttribute("position") as BufferAttribute;
      const positions = posAttr.array as Float32Array;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const vel = particleVelocities[i];
        positions[i * 3] += vel.x * delta;
        positions[i * 3 + 1] += vel.y * delta;
        positions[i * 3 + 2] += vel.z * delta;

        if (positions[i * 3 + 1] > 16.0) {
          let cluster;
          if (i < 80) {
            // Reset to earthquake zone
            cluster = { x: earthquakeZoneCenter.x, z: earthquakeZoneCenter.z };
          } else if (i < 180) {
            // Reset to fire/collapse zones
            cluster = i % 2 === 0 ? { x: 18, z: -16 } : { x: -14, z: 15 };
          } else {
            // Random spread
            cluster = { x: (rng() - 0.5) * 40, z: (rng() - 0.5) * 40 };
          }
          positions[i * 3] = cluster.x + (rng() - 0.5) * 12;
          positions[i * 3 + 1] = vel.resetY;
          positions[i * 3 + 2] = cluster.z + (rng() - 0.5) * 12;
        }
      }
      posAttr.needsUpdate = true;

      // Scenario dynamic visibility
      const isTsunami = world.scenarioId === "TSUNAMI";
      earthquakeGroup.visible = !isTsunami;
      tsunamiGroup.visible = isTsunami;

      if (isTsunami) {
        waterMesh.position.y = 0.35 + Math.sin(pulseTimer * 1.5) * 0.05;
        waterMaterial.opacity = 0.65 + Math.sin(pulseTimer * 1.8) * 0.05;
        floatingContainers.forEach((fc, idx) => {
          fc.mesh.position.y = fc.baseY + Math.sin(pulseTimer * 2.0 + idx * 1.1) * 0.1;
          fc.mesh.rotation.z = fc.baseRotZ + Math.cos(pulseTimer * 1.6 + idx) * 0.03;
        });
      }

      // Ground Rescue Rover Animation
      if (world.rescueRover) {
        const rover = world.rescueRover;
        roverGroup.position.set(rover.position.x, 0, rover.position.z);
        roverGroup.rotation.y = rover.headingRadians;

        if (rover.active) {
          wheels.forEach((w) => {
            w.rotation.x += rover.speed * delta * 2.5;
          });
          const flash = Math.sin(pulseTimer * 16);
          redStrobeMat.opacity = flash > 0 ? 0.95 : 0.15;
          blueStrobeMat.opacity = flash < 0 ? 0.95 : 0.15;
        } else {
          redStrobeMat.opacity = 0.25;
          blueStrobeMat.opacity = 0.25;
        }
      }

      // Hazards synchronization
      const activeHazardIds = new Set(world.hazards.map((h) => h.id));
      hazardVisuals.forEach((vis, id) => {
        vis.group.visible = activeHazardIds.has(id);
      });
      world.hazards.forEach((hazard) => {
        if (!hazardVisuals.has(hazard.id)) {
          createHazardVisual(hazard);
        }
        const visual = hazardVisuals.get(hazard.id);
        if (visual) {
          visual.group.visible = true;
          if (visual.pulse) {
            // Different pulse rates for different hazard types
            const pulseRate = visual.kind === "FIRE" ? 4 : visual.kind === "COLLAPSE" ? 2 : 3;
            const pulseBase = visual.kind === "FIRE" ? 0.18 : visual.kind === "COLLAPSE" ? 0.10 : 0.15;
            const pulseAmplitude = visual.kind === "FIRE" ? 0.15 : visual.kind === "COLLAPSE" ? 0.08 : 0.12;
            const hazardPulse = (Math.sin(pulseTimer * pulseRate) + 1) * 0.5;
            visual.fill.opacity = pulseBase + hazardPulse * pulseAmplitude;
          }
        }
      });

      // Survivors synchronization
      const activeSurvivorIds = new Set(world.survivors.map((s) => s.id));
      survivorVisuals.forEach((vis, id) => {
        vis.marker.visible = activeSurvivorIds.has(id);
      });
      world.survivors.forEach((s) => {
        if (!survivorVisuals.has(s.id)) {
          createSurvivorVisual(s.id, s.position);
        }
        const vis = survivorVisuals.get(s.id);
        if (vis) {
          vis.marker.visible = true;
          vis.update(s.detected, pulseTimer);
        }
      });
    },
    dispose: () => {
      groundTexture.dispose();
      groundMaterial.dispose();
      concreteMaterial.dispose();
      damagedFacadeMaterial.dispose();
      brokenSlabMaterial.dispose();
      rubbleMaterial.dispose();
      steelBeamMaterial.dispose();
      rebarMaterial.dispose();
      glassWindowMaterial.dispose();
      waterMaterial.dispose();
      particleGeom.dispose();
      particleMat.dispose();
    },
  };
}
