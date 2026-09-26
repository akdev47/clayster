// OrbitControls is a Three.js add-on for moving the camera with the mouse or touch.
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function setupOrbitControls(camera, renderer) {
  const controls = new OrbitControls(camera, renderer.domElement);

  // Ease camera movement after a drag and limit how far users can zoom.
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 10;
  controls.maxDistance = 2000;

  return controls;
}
