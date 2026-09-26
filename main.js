import { createViewer } from './src/viewer.js';
import { Pipeline } from './src/pipeline/index.js';
import { createUI } from './src/ui.js';

const viewer = createViewer(document.getElementById('viewport'));
const pipeline = new Pipeline();
const ui = createUI(viewer, pipeline);

// Frame the camera once, on the first thing we manage to build. After that the
// view stays where the user put it, so a preview rebuild never yanks it around.
pipeline.addEventListener('result', () => viewer.frame(ui.view()), { once: true });

await pipeline.run();
