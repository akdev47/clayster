// A small self-contained 3D view that slowly turns a stamp, for the order
// page. It clones whatever geometry it is given, so the main viewer keeps
// ownership of its own meshes.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createStampSpinner(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(60, -80, 120);
  scene.add(key);

  const mesh = new THREE.Mesh(
    undefined,
    new THREE.MeshStandardMaterial({ color: 0xc9d3e0, roughness: 0.45, metalness: 0.05 }),
  );
  mesh.visible = false;
  scene.add(mesh);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2.5;

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
  };
  new ResizeObserver(resize).observe(container);
  resize();

  const frame = () => {
    mesh.geometry.computeBoundingSphere();
    const { radius } = mesh.geometry.boundingSphere;
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.position.set(0, -distance * 0.75, distance * 0.7);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  return {
    /** Shows a copy of `geometry` (or nothing for null), centred on the origin. */
    setGeometry(geometry) {
      mesh.geometry?.dispose();
      if (!geometry) {
        mesh.geometry = undefined;
        mesh.visible = false;
        return;
      }
      const copy = geometry.clone();
      copy.computeBoundingBox();
      const centre = copy.boundingBox.getCenter(new THREE.Vector3());
      copy.translate(-centre.x, -centre.y, -centre.z);
      mesh.geometry = copy;
      mesh.visible = true;
      frame();
    },
    /** Only render while the order page is on screen. */
    start() {
      resize();
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
  };
}
