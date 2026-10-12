import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// Draws a measurement box with HTML labels. The viewer supplies the stamp's bounds.
export class DimensionBox {
  constructor() {
    this.box = new THREE.Box3();
    this.object = new THREE.Group();

    this.helper = new THREE.Box3Helper(this.box, 0xffc857);
    this.helper.material.depthTest = false;
    this.helper.material.transparent = true;
    this.helper.material.opacity = 0.9;
    this.object.add(this.helper);

    this.labels = {
      x: this.createLabel(),
      y: this.createLabel(),
      z: this.createLabel(),
    };
  }

  createLabel() {
    const element = document.createElement("div");
    element.className = "dimension-label";

    const label = new CSS2DObject(element);
    this.object.add(label);

    return label;
  }

  update(box) {
    // Hide the measurements when there is no stamp to display.
    const empty = box.isEmpty();
    this.object.visible = !empty;
    if (empty) return;

    this.box.copy(box);

    const size = box.getSize(new THREE.Vector3());
    const min = box.min;
    const max = box.max;

    // Each label sits on the middle of an edge that runs along its axis.
    this.place(this.labels.x, (min.x + max.x) / 2, min.y, min.z, size.x);
    this.place(this.labels.y, max.x, (min.y + max.y) / 2, min.z, size.y);
    this.place(this.labels.z, min.x, min.y, (min.z + max.z) / 2, size.z);
  }

  place(label, x, y, z, millimetres) {
    label.position.set(x, y, z);
    label.element.textContent = `${format(millimetres)} mm`;
  }

  dispose() {
    for (const label of Object.values(this.labels)) {
      label.element.remove();
    }
  }
}

export function format(millimetres) {
  return millimetres >= 100 ? millimetres.toFixed(0) : millimetres.toFixed(1);
}
