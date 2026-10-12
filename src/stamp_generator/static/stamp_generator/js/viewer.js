// Displays the pipeline's stamp and mug meshes, with lighting, measurements, and camera controls.
import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";
import { setupOrbitControls } from "./controls.js";
import { DimensionBox } from "./dimensions.js";

// A stamp with a handle runs to tens of thousands of triangles, and hit-testing
// the pointer against every one of them on each mouse move would stutter.
// three-mesh-bvh turns that into a tree descent.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Slicers put Z up and measure in millimetres. Matching that here means an
// exported file lands on the build plate the same way round as it looks on
// screen, with no conversion step anywhere.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const PLATE_MM = 220;
const FINE_GRID_MM = 10;
const COARSE_GRID_MM = 50;

export function createViewer(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15181d);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(90, -120, 90);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Draws the millimetre labels as HTML on top of the canvas, so they stay
  // crisp and never get hidden behind the model.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "label-layer";
  container.appendChild(labelRenderer.domElement);

  addLights(scene);

  const plate = buildPlate();
  scene.add(plate);

  const stampMesh = new THREE.Mesh(
    undefined,
    new THREE.MeshStandardMaterial({
      color: 0xc9d3e0,
      roughness: 0.45,
      metalness: 0.05,
    }),
  );

  // Two materials, matched to mug.js's foot-ring / glaze geometry groups
  // (group 0, group 1): the unglazed foot stays matte bisque, the rest gets
  // a glossy glaze via clearcoat, so the mug reads as fired ceramic rather
  // than a flat plastic tint.
  const clayMesh = new THREE.Mesh(undefined, [
    new THREE.MeshStandardMaterial({
      color: 0xa9714f,
      roughness: 0.95,
      metalness: 0,
    }),
    new THREE.MeshPhysicalMaterial({
      color: 0xb4694a,
      roughness: 0.4,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    }),
  ]);

  stampMesh.castShadow = true;
  stampMesh.receiveShadow = true;
  clayMesh.castShadow = true;
  clayMesh.receiveShadow = true;

  stampMesh.visible = false;
  clayMesh.visible = false;
  scene.add(stampMesh, clayMesh);

  const dimensions = new DimensionBox();
  scene.add(dimensions.object);

  const orbit = setupOrbitControls(camera, renderer);
  orbit.target.set(0, 0, 15);

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;

    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
    labelRenderer.setSize(clientWidth, clientHeight);
  };

  new ResizeObserver(resize).observe(container);
  resize();

  // Redraw the view continuously; stamp geometry is rebuilt only when inputs change.
  renderer.setAnimationLoop(() => {
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    orbit.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  // Replaces a preview mesh, disposing whatever it was showing before so a
  // live preview does not leak a geometry on every keystroke.
  const setGeometry = (mesh, geometry) => {
    mesh.geometry?.disposeBoundsTree?.();
    mesh.geometry?.dispose();
    mesh.geometry = geometry ?? undefined;
    mesh.visible = geometry !== null && geometry !== undefined;
  };

  const show = ({ stamp, clay }) => {
    setGeometry(stampMesh, stamp);
    setGeometry(clayMesh, clay);

    // A fresh build ends any drag preview, so the mesh goes back to 1:1.
    stampMesh.scale.set(1, 1, 1);
    stampMesh.geometry?.computeBoundsTree?.();

    refreshDimensions();
  };

  const refreshDimensions = () => {
    dimensions.update(stampMesh.visible ? boxOf(stampMesh) : new THREE.Box3());
  };

  // --- hit testing and the drag-to-resize preview ------------------------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const overStamp = (event) => {
    if (!stampMesh.visible) return false;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    raycaster.firstHitOnly = true;

    return raycaster.intersectObject(stampMesh, false).length > 0;
  };

  // Where the stamp sits on screen and how big it looks there, in pixels.
  // A resize drag needs both: the centre to measure distance from, and the
  // radius to turn that distance into a sensible scale factor.
  const stampScreenMetrics = () => {
    const rect = renderer.domElement.getBoundingClientRect();
    const box = boxOf(stampMesh);
    const centre = box.getCenter(new THREE.Vector3());
    const worldRadius = Math.max(
      box.getBoundingSphere(new THREE.Sphere()).radius,
      0.001,
    );

    // A point one radius to the camera's right, so the projected distance
    // between the two is the stamp's apparent radius whatever the angle.
    const right = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const edge = centre.clone().addScaledVector(right, worldRadius);

    const toScreen = (point) => {
      const ndc = point.clone().project(camera);
      return {
        x: rect.left + ((ndc.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - ndc.y) / 2) * rect.height,
      };
    };

    const screenCentre = toScreen(centre);
    const screenEdge = toScreen(edge);

    return {
      ...screenCentre,
      radius: Math.max(
        Math.hypot(
          screenEdge.x - screenCentre.x,
          screenEdge.y - screenCentre.y,
        ),
        8,
      ),
    };
  };

  // Rebuilding the mesh takes hundreds of milliseconds, far too slow for a
  // drag. Scaling X and Y instead is instant and is also what actually
  // changes: the face and artwork grow while plate thickness and relief depth
  // stay put. The real geometry is rebuilt once, on release.
  const previewScale = (factor) => {
    stampMesh.scale.set(factor, factor, 1);
    refreshDimensions();
  };

  // Moves the camera back far enough for `box` to fill the view, keeping
  // whatever direction you are currently looking from.
  const frameBox = (box) => {
    if (box.isEmpty()) return;

    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(
      box.getBoundingSphere(new THREE.Sphere()).radius,
      10,
    );
    const distance =
      radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);

    const direction = camera.position.clone().sub(orbit.target).normalize();
    orbit.target.copy(centre);
    camera.position.copy(centre).add(direction.multiplyScalar(distance * 1.2));
    orbit.update();
  };

  const frame = (target = "both") => {
    const box = new THREE.Box3();

    if (target !== "clay" && stampMesh.visible) box.union(boxOf(stampMesh));
    if (target !== "stamp" && clayMesh.visible) box.union(boxOf(clayMesh));

    frameBox(box);
  };

  return {
    scene,
    camera,
    renderer,
    orbit,
    plate,
    dimensions,
    show,
    frame,
    refreshDimensions,
    overStamp,
    stampScreenMetrics,
    previewScale,
    stampMesh,
    clayMesh,
  };
}

function boxOf(mesh) {
  return new THREE.Box3().setFromObject(mesh);
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30343c, 2.2));

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(120, -160, 220);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.4;

  // Tight orthographic frustum around the plate, not the whole 5000-unit
  // scene, so the shadow map's resolution isn't wasted on empty space.
  const reach = PLATE_MM / 2 + 20;
  key.shadow.camera.left = -reach;
  key.shadow.camera.right = reach;
  key.shadow.camera.top = reach;
  key.shadow.camera.bottom = -reach;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 500;
  key.shadow.camera.updateProjectionMatrix();

  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-160, 120, 80);
  scene.add(fill);
}

// The build plate doubles as the scale reference: one small square is 10 mm,
// one bold square is 50 mm.
function buildPlate() {
  const plate = new THREE.Group();

  // A plain plane to catch the mug's shadow — the grid is drawn in lines,
  // which a shadow map has nothing to project onto.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATE_MM, PLATE_MM),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  ground.position.z = -0.01;
  ground.receiveShadow = true;
  plate.add(ground);

  const fine = new THREE.GridHelper(
    PLATE_MM,
    PLATE_MM / FINE_GRID_MM,
    0x2c323b,
    0x2c323b,
  );
  const coarse = new THREE.GridHelper(
    PLATE_MM,
    PLATE_MM / COARSE_GRID_MM,
    0x49515e,
    0x49515e,
  );

  for (const grid of [fine, coarse]) {
    grid.rotation.x = Math.PI / 2; // GridHelper lies in XZ; we want XY.
    grid.material.transparent = true;
    grid.material.opacity = 0.8;
    plate.add(grid);
  }

  coarse.position.z = 0.02; // Keeps the bold lines from fighting the fine ones.

  return plate;
}
