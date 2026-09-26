// Shows an instant resize while dragging, then asks the pipeline to rebuild on release.
const MIN_FACTOR = 0.15;
const MAX_FACTOR = 8;
const DIRECTION_EPSILON = 4; // Pixels of travel needed to settle a direction.

/**
 * Drag the stamp in the viewport to resize it.
 *
 * The gesture changes whatever currently drives the size — the artwork when the
 * face is sized to fit it, the face itself otherwise — so dragging always does
 * the thing the panel would have done.
 *
 * @param {object} viewer
 * @param {object} pipeline
 * @param {(millimetres: number, done: boolean) => void} [onSize]
 *        Called continuously while dragging with the size being previewed, and
 *        once more on release with the value actually committed.
 */
export function enableDragResize(viewer, pipeline, { onSize } = {}) {
    const canvas = viewer.renderer.domElement;
    let drag = null;

    /**
     * How far the pointer has travelled along the drag's outward direction,
     * signed, so pulling away grows and pushing back shrinks.
     *
     * Measuring the plain distance from the stamp's centre instead would be
     * unsigned, and grabbing anywhere near the middle would then read every
     * direction as outward — leaving no way to make the stamp smaller.
     */
    const travel = (event) => {
        const dx = event.clientX - drag.origin.x;
        const dy = event.clientY - drag.origin.y;

        // Grabbing dead centre gives no outward direction to work from, so it
        // is taken from the first few pixels of the drag instead.
        if (drag.direction === null) {
            const length = Math.hypot(dx, dy);
            if (length < DIRECTION_EPSILON) return 0;
            drag.direction = { x: dx / length, y: dy / length };
        }

        return (dx * drag.direction.x) + (dy * drag.direction.y);
    };

    // Growth is measured against the stamp's apparent radius: dragging outwards
    // by a third of the silhouette makes it a third bigger, wherever you
    // grabbed it and however the camera happens to be angled.
    const factorFor = (event) => {
        const factor = (drag.metrics.radius + travel(event)) / drag.metrics.radius;
        return Math.min(Math.max(factor, MIN_FACTOR), MAX_FACTOR);
    };

    // Capture phase, so orbiting is switched off before OrbitControls sees the
    // same pointerdown and starts turning the camera.
    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || drag !== null) return;
        if (!viewer.overStamp(event)) return;

        const metrics = viewer.stampScreenMetrics();
        const offsetX = event.clientX - metrics.x;
        const offsetY = event.clientY - metrics.y;
        const offset = Math.hypot(offsetX, offsetY);

        drag = {
            metrics,
            origin: { x: event.clientX, y: event.clientY },
            direction: offset < DIRECTION_EPSILON
                ? null
                : { x: offsetX / offset, y: offsetY / offset },
            size: pipeline.sizeDriver.value,
            pointerId: event.pointerId
        };

        viewer.orbit.enabled = false;
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'nwse-resize';
    }, { capture: true });

    canvas.addEventListener('pointermove', (event) => {
        if (drag === null) {
            canvas.style.cursor = viewer.overStamp(event) ? 'nwse-resize' : '';
            return;
        }

        const factor = factorFor(event);
        viewer.previewScale(factor);
        onSize?.(drag.size * factor, false);
    });

    const finish = (event) => {
        if (drag === null) return;

        const committed = pipeline.applySize(round(drag.size * factorFor(event)));

        viewer.orbit.enabled = true;
        if (canvas.hasPointerCapture(drag.pointerId)) {
            canvas.releasePointerCapture(drag.pointerId);
        }

        drag = null;
        canvas.style.cursor = '';

        // The scaled preview stays on screen until the rebuilt mesh replaces it,
        // which show() resets, so there is no flash back to the old size.
        onSize?.(committed, true);
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
}

function round(millimetres) {
    return Math.round(millimetres * 10) / 10;
}
