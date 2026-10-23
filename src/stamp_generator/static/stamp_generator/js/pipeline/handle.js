// The grip on the back of the stamp: a long rectangular bar you can hold.
import * as THREE from "three";
import { SETTINGS } from "../settings.js";

// The shape and size come from settings.js (handle), where each value is
// explained.
export const HANDLE = Object.freeze({
  widthMm: SETTINGS.handle.widthMm, // Along X, the stamp's width.
  depthMm: SETTINGS.handle.depthMm, // Along Y.
  heightMm: SETTINGS.handle.heightMm, // How far it hangs below the plate.
});

// A small face gets a proportionally smaller handle: its longer side may use at
// most this share of the face's shorter side.
export const HANDLE_MAX_FACE_SHARE = SETTINGS.handle.maxShareOfFace;

/**
 * A closed rectangular bar, Z up, standing on z = 0 and centred on the Z axis.
 * The flat top meets the plate. The stamp build shrinks a copy for small faces.
 */
export function createSmallHandle({
  widthMm = HANDLE.widthMm,
  depthMm = HANDLE.depthMm,
  heightMm = HANDLE.heightMm,
} = {}) {
  const box = new THREE.BoxGeometry(widthMm, depthMm, heightMm);
  box.translate(0, 0, heightMm / 2);
  const geometry = box.toNonIndexed();
  box.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

/** Shrinks the handle, keeping its proportions, until it fits the face. */
export function fitHandleToFace(handle, faceWidthMm, faceHeightMm) {
  handle.computeBoundingBox();
  const size = handle.boundingBox.getSize(new THREE.Vector3());
  const room = HANDLE_MAX_FACE_SHARE * Math.min(faceWidthMm, faceHeightMm);
  const scale = Math.min(1, room / Math.max(size.x, size.y));
  if (scale < 1) handle.scale(scale, scale, scale);
  handle.computeBoundingBox();
  return handle;
}
