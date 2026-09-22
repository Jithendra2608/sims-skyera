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
import type { HazardZone, WorldState } from "../simulation/types";

export interface DisasterEnvironmentHandle {
  readonly root: Group;
  readonly update: (world: WorldState, delta: number) => void;
  readonly dispose: () => void;
}

/** Deterministic 0–1 sequence so rubble layout does not change between runs. */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Procedural 3D disaster terrain. Static structures are presentation-only.
 * Hazards and survivors are driven from WorldState so they stay aligned with the core.
 */
export function createDisasterEnvironment(): DisasterEnvironmentHandle {
  const root = new Group();
  const rng = createSeededRng(0x5a13e7a);

  const concreteMaterial = new MeshStandardMaterial({
    color: 0x222a38,
    roughness: 0.85,
    metalness: 0.15,
  });

  const damagedConcreteMaterial = new MeshStandardMaterial({
    color: 0x1b2230,
    roughness: 0.95,
    metalness: 0.1,
  });

  const rubbleMaterial = new MeshStandardMaterial({
    color: 0x2a3445,
    roughness: 0.9,
    metalness: 0.2,
  });

  const helipadRingMaterial = new MeshBasicMaterial({
    color: 0xfbbf24,
    side: DoubleSide,
  });

  const stagingGroup = new Group();
  root.add(stagingGroup);

  const helipadRing = new Mesh(new RingGeometry(5.4, 5.8, 48), helipadRingMaterial);
  helipadRing.rotation.x = -Math.PI / 2;
  helipadRing.position.y = 0.02;
  stagingGroup.add(helipadRing);

  const padDisc = new Mesh(
    new CircleGeometry(5.4, 32),
    new MeshStandardMaterial({ color: 0x141c2b, roughness: 0.7 }),
  );
  padDisc.rotation.x = -Math.PI / 2;
  padDisc.position.y = 0.01;
  stagingGroup.add(padDisc);

  const hBar1 = new Mesh(
    new BoxGeometry(0.5, 0.03, 3.2),
    new MeshBasicMaterial({ color: 0xffffff }),
  );
  hBar1.position.set(-1.1, 0.03, 0);
  stagingGroup.add(hBar1);

  const hBar2 = new Mesh(
    new BoxGeometry(0.5, 0.03, 3.2),
    new MeshBasicMaterial({ color: 0xffffff }),
  );
  hBar2.position.set(1.1, 0.03, 0);
  stagingGroup.add(hBar2);

  const hCross = new Mesh(
    new BoxGeometry(2.2, 0.03, 0.5),
    new MeshBasicMaterial({ color: 0xffffff }),
  );
  hCross.position.set(0, 0.03, 0);
  stagingGroup.add(hCross);

  const evacGroup = new Group();
  root.add(evacGroup);
  const evacRing = new Mesh(
    new RingGeometry(3.2, 3.6, 40),
    new MeshBasicMaterial({ color: 0x34d399, side: DoubleSide }),
  );
  evacRing.rotation.x = -Math.PI / 2;
  evacRing.position.y = 0.03;
  evacGroup.add(evacRing);
  const evacDisc = new Mesh(
    new CircleGeometry(3.2, 28),
    new MeshStandardMaterial({ color: 0x052e1a, roughness: 0.7 }),
  );
  evacDisc.rotation.x = -Math.PI / 2;
  evacDisc.position.y = 0.02;
  evacGroup.add(evacDisc);
  let evacPlaced = false;

  const buildingsGroup = new Group();
  root.add(buildingsGroup);

  const buildingSpecs = [
    { x: 26, z: 22, w: 14, h: 22, d: 12, rotY: 0.15, shear: 0.1 },
    { x: 34, z: 8, w: 10, h: 14, d: 10, rotY: -0.2, shear: 0.15 },
    { x: 36, z: -24, w: 16, h: 10, d: 14, rotY: 0.05, shear: 0.0 },
    { x: -26, z: 24, w: 16, h: 12, d: 14, rotY: -0.1, shear: 0.25 },
    { x: -32, z: 6, w: 12, h: 18, d: 10, rotY: 0.3, shear: 0.05 },
    { x: -30, z: -24, w: 14, h: 8, d: 16, rotY: -0.25, shear: 0.1 },
  ];

  buildingSpecs.forEach((spec) => {
    const bGroup = new Group();
    bGroup.position.set(spec.x, spec.h / 2, spec.z);
    bGroup.rotation.y = spec.rotY;
    if (spec.shear > 0) {
      bGroup.rotation.z = spec.shear * 0.4;
    }

    const mainMesh = new Mesh(
      new BoxGeometry(spec.w, spec.h, spec.d),
      concreteMaterial,
    );
    bGroup.add(mainMesh);

    const roofFracture = new Mesh(
      new BoxGeometry(spec.w * 0.8, 1.2, spec.d * 0.8),
      damagedConcreteMaterial,
    );
    roofFracture.position.set(0, spec.h / 2 + 0.4, 0);
    roofFracture.rotation.z = 0.2;
    bGroup.add(roofFracture);

    buildingsGroup.add(bGroup);

    for (let r = 0; r < 5; r++) {
      const angle = (r / 5) * Math.PI * 2;
      const dist = spec.w / 2 + 2.5 + rng() * 3;
      const rx = spec.x + Math.cos(angle) * dist;
      const rz = spec.z + Math.sin(angle) * dist;
      const size = 1.0 + rng() * 2.2;

      const rubble = new Mesh(
        new BoxGeometry(size, size * 0.6, size * 0.8),
        rubbleMaterial,
      );
      rubble.position.set(rx, size * 0.3, rz);
      rubble.rotation.set(rng(), rng(), rng());
      buildingsGroup.add(rubble);
    }
  });

  const hazardsGroup = new Group();
  root.add(hazardsGroup);
  const hazardVisuals = new Map<
    string,
    { fill: MeshBasicMaterial | MeshStandardMaterial; pulse: boolean }
  >();

  const createHazardVisual = (hazard: HazardZone): void => {
    const group = new Group();
    group.position.set(hazard.center.x, 0, hazard.center.z);

    if (hazard.kind === "FIRE") {
      const fill = new MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.22,
        side: DoubleSide,
      });
      const cylinder = new Mesh(
        new CylinderGeometry(hazard.radius, hazard.radius, 5, 32, 1, true),
        fill,
      );
      cylinder.position.y = 2.5;
      group.add(cylinder);
      const ring = new Mesh(
        new RingGeometry(hazard.radius - 0.3, hazard.radius + 0.2, 48),
        new MeshBasicMaterial({
          color: 0xf97316,
          transparent: true,
          opacity: 0.85,
          side: DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      group.add(ring);
      hazardsGroup.add(group);
      hazardVisuals.set(hazard.id, { fill, pulse: true });
      return;
    }

    if (hazard.kind === "FLOOD") {
      const fill = new MeshStandardMaterial({
        color: 0x0369a1,
        transparent: true,
        opacity: 0.65,
        roughness: 0.1,
        metalness: 0.6,
      });
      const disc = new Mesh(new CircleGeometry(hazard.radius, 36), fill);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.04;
      group.add(disc);
      const ring = new Mesh(
        new RingGeometry(hazard.radius - 0.3, hazard.radius + 0.2, 48),
        new MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.7,
          side: DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      group.add(ring);
      hazardsGroup.add(group);
      hazardVisuals.set(hazard.id, { fill, pulse: false });
      return;
    }

    const fill = new MeshBasicMaterial({
      color: 0xa16207,
      transparent: true,
      opacity: 0.2,
      side: DoubleSide,
    });
    const cylinder = new Mesh(
      new CylinderGeometry(hazard.radius, hazard.radius, 3.2, 24, 1, true),
      fill,
    );
    cylinder.position.y = 1.6;
    group.add(cylinder);
    const ring = new Mesh(
      new RingGeometry(hazard.radius - 0.3, hazard.radius + 0.2, 48),
      new MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.8,
        side: DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    hazardsGroup.add(group);
    hazardVisuals.set(hazard.id, { fill, pulse: true });
  };

  const survivorsGroup = new Group();
  root.add(survivorsGroup);

  const survivorVisuals = new Map<
    string,
    {
      update: (detected: boolean, time: number) => void;
    }
  >();

  const createSurvivorVisual = (
    id: string,
    initialPos: { x: number; y: number; z: number },
  ) => {
    const marker = new Group();
    marker.position.set(initialPos.x, 0, initialPos.z);

    const torso = new Mesh(
      new BoxGeometry(0.8, 0.25, 0.45),
      new MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7 }),
    );
    torso.position.y = 0.12;
    marker.add(torso);

    const head = new Mesh(
      new SphereGeometry(0.18, 12, 10),
      new MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.6 }),
    );
    head.position.set(0.52, 0.15, 0);
    marker.add(head);

    const aura = new Mesh(
      new CircleGeometry(1.4, 24),
      new MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.3,
        side: DoubleSide,
      }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.03;
    marker.add(aura);

    const beacon = new Mesh(
      new CylinderGeometry(0.06, 0.06, 4.5, 8),
      new MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.7,
      }),
    );
    beacon.position.y = 2.25;
    beacon.visible = false;
    marker.add(beacon);

    const badge = new Mesh(
      new SphereGeometry(0.35, 8, 8),
      new MeshBasicMaterial({ color: 0x34d399, wireframe: true }),
    );
    badge.position.y = 4.6;
    badge.visible = false;
    marker.add(badge);

    survivorsGroup.add(marker);

    survivorVisuals.set(id, {
      update: (detected: boolean, time: number) => {
        if (detected) {
          beacon.visible = true;
          badge.visible = true;
          badge.rotation.y += 0.03;
          badge.rotation.x += 0.02;
          const pulse = (Math.sin(time * 6) + 1) * 0.5;
          (beacon.material as MeshBasicMaterial).opacity = 0.4 + pulse * 0.5;
          (aura.material as MeshBasicMaterial).color.setHex(0x34d399);
          (aura.material as MeshBasicMaterial).opacity = 0.6 + pulse * 0.3;
        } else {
          beacon.visible = false;
          badge.visible = false;
          const breathe = (Math.sin(time * 2) + 1) * 0.5;
          (aura.material as MeshBasicMaterial).opacity = 0.15 + breathe * 0.15;
        }
      },
    });
  };

  // 3D First Responder Ground Rescue Rover Model
  const roverGroup = new Group();
  root.add(roverGroup);

  const roverChassisMat = new MeshStandardMaterial({
    color: 0xea580c, // High-visibility SAR Emergency Orange
    roughness: 0.4,
    metalness: 0.3,
  });

  const roverCabinMat = new MeshStandardMaterial({
    color: 0x1e293b, // Tactical carbon graphite
    roughness: 0.5,
    metalness: 0.5,
  });

  const roverGlassMat = new MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0.75,
  });

  const wheelMat = new MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.9,
    metalness: 0.1,
  });

  // Rover Chassis Base
  const chassis = new Mesh(new BoxGeometry(1.6, 0.42, 2.5), roverChassisMat);
  chassis.position.y = 0.46;
  roverGroup.add(chassis);

  // Armored Cabin
  const cabin = new Mesh(new BoxGeometry(1.3, 0.45, 1.5), roverCabinMat);
  cabin.position.set(0, 0.82, -0.2);
  roverGroup.add(cabin);

  // Front Windshield
  const windshield = new Mesh(new BoxGeometry(1.2, 0.3, 0.08), roverGlassMat);
  windshield.position.set(0, 0.82, 0.58);
  windshield.rotation.x = -0.2;
  roverGroup.add(windshield);

  // 6 All-Terrain Rubber Wheels
  const wheelGeom = new CylinderGeometry(0.36, 0.36, 0.28, 16);
  const wheels: Mesh[] = [];
  const wheelOffsets = [
    { x: -0.92, z: -0.8 },
    { x: -0.92, z: 0.0 },
    { x: -0.92, z: 0.8 },
    { x: 0.92, z: -0.8 },
    { x: 0.92, z: 0.0 },
    { x: 0.92, z: 0.8 },
  ];

  wheelOffsets.forEach((pos) => {
    const w = new Mesh(wheelGeom, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(pos.x, 0.36, pos.z);
    roverGroup.add(w);
    wheels.push(w);
  });

  // Emergency Strobe Lightbar on Roof
  const lightBarMount = new Mesh(
    new BoxGeometry(0.8, 0.06, 0.16),
    new MeshBasicMaterial({ color: 0x334155 }),
  );
  lightBarMount.position.set(0, 1.07, -0.2);
  roverGroup.add(lightBarMount);

  const redStrobeMat = new MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.9,
  });
  const redStrobe = new Mesh(new BoxGeometry(0.3, 0.1, 0.14), redStrobeMat);
  redStrobe.position.set(-0.25, 1.13, -0.2);
  roverGroup.add(redStrobe);

  const blueStrobeMat = new MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.9,
  });
  const blueStrobe = new Mesh(new BoxGeometry(0.3, 0.1, 0.14), blueStrobeMat);
  blueStrobe.position.set(0.25, 1.13, -0.2);
  roverGroup.add(blueStrobe);

  // Front Headlights
  const headlightMat = new MeshBasicMaterial({ color: 0xffedd5 });
  const headL = new Mesh(new BoxGeometry(0.2, 0.12, 0.05), headlightMat);
  headL.position.set(-0.55, 0.46, 1.27);
  roverGroup.add(headL);
  const headR = new Mesh(new BoxGeometry(0.2, 0.12, 0.05), headlightMat);
  headR.position.set(0.55, 0.46, 1.27);
  roverGroup.add(headR);

  // Rotating LiDAR / Sensor Dome
  const lidarDome = new Mesh(
    new CylinderGeometry(0.18, 0.18, 0.12, 16),
    new MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2 }),
  );
  lidarDome.position.set(0, 1.15, 0.35);
  roverGroup.add(lidarDome);

  let pulseTimer = 0;

  return {
    root,
    update: (world: WorldState, delta: number) => {
      pulseTimer += delta;

      if (!evacPlaced) {
        evacGroup.position.set(world.evacuationZone.x, 0, world.evacuationZone.z);
        evacPlaced = true;
      }

      // Synchronize Ground Rescue Rover position and heading
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

      world.hazards.forEach((hazard) => {
        if (!hazardVisuals.has(hazard.id)) {
          createHazardVisual(hazard);
        }
        const visual = hazardVisuals.get(hazard.id);
        if (visual?.pulse) {
          const firePulse = (Math.sin(pulseTimer * 4) + 1) * 0.5;
          visual.fill.opacity = 0.16 + firePulse * 0.14;
        }
      });

      world.survivors.forEach((s) => {
        if (!survivorVisuals.has(s.id)) {
          createSurvivorVisual(s.id, s.position);
        }
        survivorVisuals.get(s.id)?.update(s.detected, pulseTimer);
      });
    },
    dispose: () => {
      concreteMaterial.dispose();
      damagedConcreteMaterial.dispose();
      rubbleMaterial.dispose();
      helipadRingMaterial.dispose();
      roverChassisMat.dispose();
      roverCabinMat.dispose();
      roverGlassMat.dispose();
      wheelMat.dispose();
      wheelGeom.dispose();
      redStrobeMat.dispose();
      blueStrobeMat.dispose();
      headlightMat.dispose();
    },
  };
}
