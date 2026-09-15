import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  GridHelper,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SimulationSnapshot } from "../simulation/types";
import { createDroneMesh } from "./droneMesh";

export interface PresentationHandle {
  readonly dispose: () => void;
  readonly resetCamera: () => void;
}

export type BootPresentationHandle = PresentationHandle;

/**
 * Mounts the 3D presentation layer.
 * Renders the Three.js viewport with OrbitControls, atmospheric lighting,
 * high-fidelity procedural quadcopter model, and dynamic flight breadcrumb trail.
 */
export function mountPresentation(
  host: HTMLElement,
  getSnapshot?: () => SimulationSnapshot,
): PresentationHandle {
  const scene = new Scene();
  scene.background = new Color(0x0a101d);
  scene.fog = new FogExp2(0x0a101d, 0.009);

  const camera = new PerspectiveCamera(
    52,
    host.clientWidth / Math.max(host.clientHeight, 1),
    0.1,
    1000,
  );
  camera.position.set(14, 10, 16);

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.toneMappingExposure = 1.2;
  host.appendChild(renderer.domElement);

  // OrbitControls for intuitive scene navigation
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent camera from going under ground
  controls.minDistance = 2;
  controls.maxDistance = 140;
  controls.target.set(0, 1, 0);

  // Ambient & Directional Lighting
  const ambient = new AmbientLight(0x7e94b8, 0.7);
  scene.add(ambient);

  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(25, 40, 20);
  scene.add(sun);

  const fillLight = new DirectionalLight(0x38bdf8, 0.4);
  fillLight.position.set(-20, 15, -20);
  scene.add(fillLight);

  // Ground Grids (dual cyber grid)
  const majorGrid = new GridHelper(120, 30, 0x38bdf8, 0x16243d);
  majorGrid.position.y = 0;
  scene.add(majorGrid);

  const fineGrid = new GridHelper(120, 120, 0x1e3a5f, 0x0f1a2e);
  fineGrid.position.y = -0.01;
  scene.add(fineGrid);

  // 3D Quadcopter Mesh
  const droneVisual = createDroneMesh();
  scene.add(droneVisual.root);

  // Flight path trail line
  const MAX_TRAIL_POINTS = 600;
  const trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3);
  let trailCount = 0;
  const trailGeometry = new BufferGeometry();
  const trailMaterial = new LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.7,
  });
  const trailLine = new Line(trailGeometry, trailMaterial);
  trailLine.frustumCulled = false;
  scene.add(trailLine);

  let lastTrailRecordTime = 0;

  const rendererStatus = document.querySelector("#status-renderer");
  if (rendererStatus) {
    rendererStatus.textContent = "ONLINE (3D DRONE)";
    rendererStatus.classList.remove("status-idle");
    rendererStatus.classList.add("status-ok");
  }

  let frameId = 0;
  let disposed = false;
  let lastTime = performance.now();

  const onResize = (): void => {
    const w = host.clientWidth;
    const h = Math.max(host.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener("resize", onResize);

  const frame = (time: number): void => {
    if (disposed) {
      return;
    }
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    // Fetch live simulation snapshot if provided
    if (getSnapshot) {
      const snap = getSnapshot();
      droneVisual.update(snap.drone, delta);

      // Smooth camera follow target
      const targetPos = new Vector3(
        snap.drone.position.x,
        Math.max(1, snap.drone.position.y * 0.7),
        snap.drone.position.z,
      );
      controls.target.lerp(targetPos, 0.04);

      // Record flight breadcrumb points
      if (snap.drone.position.y > 0.1 && time - lastTrailRecordTime > 80) {
        lastTrailRecordTime = time;
        if (trailCount < MAX_TRAIL_POINTS) {
          trailPositions[trailCount * 3] = snap.drone.position.x;
          trailPositions[trailCount * 3 + 1] = snap.drone.position.y;
          trailPositions[trailCount * 3 + 2] = snap.drone.position.z;
          trailCount++;
          trailGeometry.setAttribute(
            "position",
            new BufferGeometry().setAttribute(
              "position",
              new (window as any).Float32Array(
                trailPositions.buffer,
                0,
                trailCount * 3,
              ),
            ).attributes.position,
          );
        }
      }
    }

    controls.update();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);

  return {
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      droneVisual.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    },
    resetCamera: () => {
      camera.position.set(14, 10, 16);
      controls.target.set(0, 1, 0);
      controls.update();
    },
  };
}

/** Backward-compatible export for scaffold boot */
export function mountBootPresentation(
  host: HTMLElement,
  getSnapshot?: () => SimulationSnapshot,
): PresentationHandle {
  return mountPresentation(host, getSnapshot);
}
