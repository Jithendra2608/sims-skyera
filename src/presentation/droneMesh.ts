import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
} from "three";
import type { DroneState } from "../simulation/types";

export interface DroneVisualHandle {
  readonly root: Group;
  readonly update: (state: DroneState, delta: number) => void;
  readonly dispose: () => void;
}

/**
 * Creates a high-fidelity procedural 3D Quadcopter model.
 * Includes spinning rotors, navigation LEDs, attitude response,
 * and a ground altitude projection ring.
 */
export function createDroneMesh(): DroneVisualHandle {
  const root = new Group();

  // Materials
  const carbonMaterial = new MeshStandardMaterial({
    color: 0x18202f,
    metalness: 0.85,
    roughness: 0.25,
  });

  const accentMaterial = new MeshStandardMaterial({
    color: 0x24324c,
    metalness: 0.5,
    roughness: 0.3,
  });

  const canopyMaterial = new MeshStandardMaterial({
    color: 0x122238,
    emissive: 0x0077b6,
    emissiveIntensity: 0.45,
    metalness: 0.9,
    roughness: 0.1,
  });

  const rotorMaterial = new MeshStandardMaterial({
    color: 0x0a101d,
    metalness: 0.3,
    roughness: 0.6,
  });

  const rotorBlurMaterial = new MeshBasicMaterial({
    color: 0x64b5f6,
    transparent: true,
    opacity: 0.25,
    side: DoubleSide,
  });

  // Central Fuselage
  const bodyGroup = new Group();
  root.add(bodyGroup);

  const hull = new Mesh(new BoxGeometry(0.7, 0.2, 0.9), carbonMaterial);
  hull.castShadow = true;
  bodyGroup.add(hull);

  // Upper Canopy / Shell
  const canopy = new Mesh(new SphereGeometry(0.32, 16, 12), canopyMaterial);
  canopy.scale.set(1.1, 0.45, 1.4);
  canopy.position.set(0, 0.14, 0.05);
  bodyGroup.add(canopy);

  // Front Nose Sensor Pod / Gimbal
  const gimbalPod = new Mesh(new SphereGeometry(0.12, 14, 12), accentMaterial);
  gimbalPod.position.set(0, -0.08, 0.48);
  bodyGroup.add(gimbalPod);

  const cameraLens = new Mesh(
    new CylinderGeometry(0.05, 0.05, 0.06, 12),
    new MeshBasicMaterial({ color: 0x00f0ff }),
  );
  cameraLens.rotation.x = Math.PI / 2;
  cameraLens.position.set(0, -0.08, 0.58);
  bodyGroup.add(cameraLens);

  // Landing Gear / Skids
  const skidMaterial = new MeshStandardMaterial({
    color: 0x1f293d,
    metalness: 0.7,
    roughness: 0.4,
  });

  [-0.32, 0.32].forEach((xSide) => {
    // Left and right horizontal tubes
    const skidTube = new Mesh(
      new CylinderGeometry(0.022, 0.022, 1.1, 8),
      skidMaterial,
    );
    skidTube.rotation.x = Math.PI / 2;
    skidTube.position.set(xSide, -0.3, 0);
    bodyGroup.add(skidTube);

    // Front/Rear vertical riser legs
    [-0.35, 0.35].forEach((zPos) => {
      const leg = new Mesh(
        new CylinderGeometry(0.02, 0.02, 0.25, 8),
        skidMaterial,
      );
      leg.position.set(xSide, -0.16, zPos);
      bodyGroup.add(leg);
    });
  });

  // 4 Diagonal Carbon Arms & Rotors
  const armRadius = 0.95;
  const rotorAssemblies: Array<{
    hub: Group;
    propeller: Mesh;
    blurDisc: Mesh;
    spinDirection: number;
  }> = [];

  const armConfigs = [
    { angle: Math.PI / 4, portSide: false, front: true }, // Front-Right
    { angle: (3 * Math.PI) / 4, portSide: true, front: true }, // Front-Left
    { angle: (5 * Math.PI) / 4, portSide: true, front: false }, // Rear-Left
    { angle: (7 * Math.PI) / 4, portSide: false, front: false }, // Rear-Right
  ];

  armConfigs.forEach((cfg, idx) => {
    const armX = Math.cos(cfg.angle) * armRadius;
    const armZ = Math.sin(cfg.angle) * armRadius;

    // Arm tube
    const armMesh = new Mesh(
      new CylinderGeometry(0.032, 0.032, armRadius, 8),
      carbonMaterial,
    );
    armMesh.position.set(armX * 0.5, 0.03, armZ * 0.5);
    armMesh.rotation.z = Math.PI / 2;
    armMesh.rotation.y = -cfg.angle;
    bodyGroup.add(armMesh);

    // Motor Pod at arm tip
    const motorPod = new Mesh(
      new CylinderGeometry(0.08, 0.09, 0.16, 12),
      accentMaterial,
    );
    motorPod.position.set(armX, 0.08, armZ);
    bodyGroup.add(motorPod);

    // Navigation LEDs on arm tips
    let ledColor = 0xffffff;
    if (cfg.front && cfg.portSide) ledColor = 0xff2a48; // Port Red
    else if (cfg.front && !cfg.portSide) ledColor = 0x00ff88; // Starboard Green
    else ledColor = 0xffffff; // Rear White

    const led = new Mesh(
      new SphereGeometry(0.035, 8, 8),
      new MeshBasicMaterial({ color: ledColor }),
    );
    led.position.set(armX, 0.03, armZ);
    bodyGroup.add(led);

    // Rotor Hub & Propeller
    const hub = new Group();
    hub.position.set(armX, 0.18, armZ);
    bodyGroup.add(hub);

    // 2-blade Propeller
    const propGeometry = new BoxGeometry(0.65, 0.015, 0.06);
    const propeller = new Mesh(propGeometry, rotorMaterial);
    hub.add(propeller);

    // Translucent blur disc for fast spin
    const blurDisc = new Mesh(new CircleGeometry(0.35, 24), rotorBlurMaterial);
    blurDisc.rotation.x = -Math.PI / 2;
    blurDisc.visible = false;
    hub.add(blurDisc);

    rotorAssemblies.push({
      hub,
      propeller,
      blurDisc,
      spinDirection: idx % 2 === 0 ? 1 : -1,
    });
  });

  const sensorFootprintMaterial = new MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
  });
  const sensorFootprint = new Mesh(
    new CircleGeometry(1, 48),
    sensorFootprintMaterial,
  );
  sensorFootprint.rotation.x = -Math.PI / 2;
  sensorFootprint.visible = false;
  root.add(sensorFootprint);

  const sensorRingMaterial = new MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.7,
    side: DoubleSide,
  });
  const sensorRing = new Mesh(new RingGeometry(0.95, 1.05, 48), sensorRingMaterial);
  sensorRing.rotation.x = -Math.PI / 2;
  sensorRing.visible = false;
  root.add(sensorRing);

  // Ground Projection Marker (shows hover point & altitude on ground)
  const groundProjection = new Group();
  root.add(groundProjection);

  const groundRing = new Mesh(
    new RingGeometry(0.4, 0.55, 32),
    new MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      side: DoubleSide,
    }),
  );
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.position.y = 0.02;
  groundProjection.add(groundRing);

  // Altitude line between drone body and ground
  const altLineGeo = new BoxGeometry(0.018, 1, 0.018);
  const altLineMat = new MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.45,
  });
  const altLine = new Mesh(altLineGeo, altLineMat);
  groundProjection.add(altLine);

  let rotorAngle = 0;

  return {
    root,
    update: (state: DroneState, delta: number) => {
      // Sync world position
      root.position.set(state.position.x, state.position.y, state.position.z);

      // Body attitude: yaw (heading), pitch (nose-down), roll (banking)
      // Three.js Euler order: YXZ for yaw -> pitch -> roll
      bodyGroup.rotation.set(0, 0, 0);
      bodyGroup.rotation.order = "YXZ";
      bodyGroup.rotation.y = -state.headingRadians;
      bodyGroup.rotation.x = state.pitchRadians;
      bodyGroup.rotation.z = state.rollRadians;

      // Rotor animation
      const isSpinning = state.armed && state.batteryPercent > 0;
      const spinSpeed = state.position.y > 0.1 ? 45 : 18;

      if (isSpinning) {
        rotorAngle += spinSpeed * delta;
        rotorAssemblies.forEach((r) => {
          r.hub.rotation.y = rotorAngle * r.spinDirection;
          r.blurDisc.visible = state.position.y > 0.1;
        });
      } else {
        rotorAssemblies.forEach((r) => {
          r.blurDisc.visible = false;
        });
      }

      const sensorRadius = state.sensorGroundRadius;
      if (sensorRadius > 0.4) {
        sensorFootprint.visible = true;
        sensorRing.visible = true;
        sensorFootprint.scale.set(sensorRadius, sensorRadius, 1);
        sensorRing.scale.set(sensorRadius, sensorRadius, 1);
        sensorFootprint.position.set(0, -state.position.y + 0.04, 0);
        sensorRing.position.set(0, -state.position.y + 0.05, 0);
      } else {
        sensorFootprint.visible = false;
        sensorRing.visible = false;
      }

      // Ground projection: place ring directly beneath drone on ground plane (y=0)
      groundProjection.position.set(0, -state.position.y, 0);
      const currentAltitude = Math.max(0, state.position.y);
      if (currentAltitude > 0.1) {
        altLine.visible = true;
        altLine.scale.set(1, currentAltitude, 1);
        altLine.position.set(0, currentAltitude * 0.5, 0);
        groundRing.visible = true;
        // Expand ring with altitude for radar feel
        const ringScale = Math.min(2.5, 1 + currentAltitude * 0.08);
        groundRing.scale.set(ringScale, ringScale, 1);
      } else {
        altLine.visible = false;
        groundRing.visible = false;
      }
    },
    dispose: () => {
      carbonMaterial.dispose();
      accentMaterial.dispose();
      canopyMaterial.dispose();
      rotorMaterial.dispose();
      rotorBlurMaterial.dispose();
      skidMaterial.dispose();
      altLineMat.dispose();
      sensorFootprintMaterial.dispose();
      sensorRingMaterial.dispose();
    },
  };
}
