import {
  AmbientLight,
  BufferAttribute,
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
import { createDisasterEnvironment } from "./disasterEnvironment";
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

  // Dedicated downward gimbal camera & PiP renderer
  const pipCanvas = document.querySelector<HTMLCanvasElement>("#pip-canvas");
  let pipRenderer: WebGLRenderer | null = null;
  let gimbalCamera: PerspectiveCamera | null = null;
  if (pipCanvas) {
    pipRenderer = new WebGLRenderer({
      canvas: pipCanvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    pipRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    pipRenderer.setSize(290, 175, false);
    pipRenderer.toneMappingExposure = 1.2;

    gimbalCamera = new PerspectiveCamera(65, 290 / 175, 0.1, 400);
  }

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

  const disasterEnvironment = createDisasterEnvironment();
  scene.add(disasterEnvironment.root);

  const droneVisual = createDroneMesh();
  scene.add(droneVisual.root);

  const MAX_TRAIL_POINTS = 600;
  const trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3);
  let trailCount = 0;
  const trailGeometry = new BufferGeometry();
  trailGeometry.setAttribute("position", new BufferAttribute(trailPositions, 3));
  trailGeometry.setDrawRange(0, 0);
  const trailMaterial = new LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.7,
  });
  const trailLine = new Line(trailGeometry, trailMaterial);
  trailLine.frustumCulled = false;
  scene.add(trailLine);

  const MAX_SEARCH_POINTS = 64;
  const searchPositions = new Float32Array(MAX_SEARCH_POINTS * 3);
  const searchGeometry = new BufferGeometry();
  searchGeometry.setAttribute("position", new BufferAttribute(searchPositions, 3));
  searchGeometry.setDrawRange(0, 0);
  const searchMaterial = new LineBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.55,
  });
  const searchLine = new Line(searchGeometry, searchMaterial);
  searchLine.frustumCulled = false;
  scene.add(searchLine);
  let lastSearchSignature = "";
  let lastRouteSignature = "";
  const MAX_ROUTE_POINTS = 24;
  const rescuePositions = new Float32Array(MAX_ROUTE_POINTS * 3);
  const rescueGeometry = new BufferGeometry();
  rescueGeometry.setAttribute("position", new BufferAttribute(rescuePositions, 3));
  rescueGeometry.setDrawRange(0, 0);
  const rescueMaterial = new LineBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.9,
  });
  const rescueLine = new Line(rescueGeometry, rescueMaterial);
  rescueLine.frustumCulled = false;
  scene.add(rescueLine);

  const evacPositions = new Float32Array(MAX_ROUTE_POINTS * 3);
  const evacGeometry = new BufferGeometry();
  evacGeometry.setAttribute("position", new BufferAttribute(evacPositions, 3));
  evacGeometry.setDrawRange(0, 0);
  const evacMaterial = new LineBasicMaterial({
    color: 0x34d399,
    transparent: true,
    opacity: 0.9,
  });
  const evacLine = new Line(evacGeometry, evacMaterial);
  evacLine.frustumCulled = false;
  scene.add(evacLine);

  let lastTrailRecordTime = 0;

  const rendererStatus = document.querySelector("#status-renderer");
    if (rendererStatus) {
    rendererStatus.textContent = "ONLINE (DISASTER SECTOR)";
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
      disasterEnvironment.update(snap.world, delta);

      const search = snap.mission.search;
      const searchSignature = search
        ? `${search.waypoints.length}:${search.active}`
        : "";
      if (searchSignature !== lastSearchSignature) {
        lastSearchSignature = searchSignature;
        if (search && search.waypoints.length > 0) {
          const count = Math.min(search.waypoints.length, MAX_SEARCH_POINTS);
          for (let i = 0; i < count; i++) {
            const wp = search.waypoints[i];
            if (!wp) {
              continue;
            }
            searchPositions[i * 3] = wp.x;
            searchPositions[i * 3 + 1] = wp.y;
            searchPositions[i * 3 + 2] = wp.z;
          }
          const attr = searchGeometry.getAttribute("position");
          attr.needsUpdate = true;
          searchGeometry.setDrawRange(0, count);
          searchGeometry.computeBoundingSphere();
          searchLine.visible = true;
        } else {
          searchGeometry.setDrawRange(0, 0);
          searchLine.visible = false;
        }
      }

      const focusCase =
        snap.mission.cases.find((c) => c.status === "PENDING") ??
        snap.mission.cases.find((c) => c.status === "APPROVED") ??
        null;
      const routeSignature = focusCase
        ? `${focusCase.survivorId}:${focusCase.status}:${focusCase.rescue.waypoints.length}`
        : "";
      if (routeSignature !== lastRouteSignature) {
        lastRouteSignature = routeSignature;
        const writeRoute = (
          points: ReadonlyArray<{ readonly x: number; readonly z: number }>,
          buffer: Float32Array,
          geometry: BufferGeometry,
          line: Line,
        ): void => {
          const count = Math.min(points.length, MAX_ROUTE_POINTS);
          for (let i = 0; i < count; i++) {
            const p = points[i];
            if (!p) {
              continue;
            }
            buffer[i * 3] = p.x;
            buffer[i * 3 + 1] = 0.4;
            buffer[i * 3 + 2] = p.z;
          }
          const attr = geometry.getAttribute("position");
          attr.needsUpdate = true;
          geometry.setDrawRange(0, count);
          geometry.computeBoundingSphere();
          line.visible = count > 1;
        };
        if (focusCase) {
          writeRoute(
            focusCase.rescue.waypoints,
            rescuePositions,
            rescueGeometry,
            rescueLine,
          );
          writeRoute(
            focusCase.evacuation.waypoints,
            evacPositions,
            evacGeometry,
            evacLine,
          );
        } else {
          rescueLine.visible = false;
          evacLine.visible = false;
        }
      }

      const targetPos = new Vector3(
        snap.drone.position.x,
        Math.max(1, snap.drone.position.y * 0.7),
        snap.drone.position.z,
      );
      controls.target.lerp(targetPos, 0.04);

      if (snap.drone.position.y > 0.1 && time - lastTrailRecordTime > 80) {
        lastTrailRecordTime = time;
        if (trailCount < MAX_TRAIL_POINTS) {
          trailPositions[trailCount * 3] = snap.drone.position.x;
          trailPositions[trailCount * 3 + 1] = snap.drone.position.y;
          trailPositions[trailCount * 3 + 2] = snap.drone.position.z;
          trailCount++;
          const positionAttr = trailGeometry.getAttribute("position");
          positionAttr.needsUpdate = true;
          trailGeometry.setDrawRange(0, trailCount);
          trailGeometry.computeBoundingSphere();
        }
      }

      // Render downward gimbal camera to PiP viewport
      if (pipRenderer && gimbalCamera) {
        const camY = Math.max(0.4, snap.drone.position.y - 0.15);
        gimbalCamera.position.set(
          snap.drone.position.x,
          camY,
          snap.drone.position.z,
        );
        gimbalCamera.lookAt(
          snap.drone.position.x,
          0,
          snap.drone.position.z,
        );
        gimbalCamera.up.set(
          Math.sin(snap.drone.headingRadians),
          0,
          Math.cos(snap.drone.headingRadians),
        );
        pipRenderer.render(scene, gimbalCamera);
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
      disasterEnvironment.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      searchGeometry.dispose();
      searchMaterial.dispose();
      rescueGeometry.dispose();
      rescueMaterial.dispose();
      evacGeometry.dispose();
      evacMaterial.dispose();
      pipRenderer?.dispose();
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
