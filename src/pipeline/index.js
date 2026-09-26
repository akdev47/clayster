// Coordinates input → 2D artwork → validation → 3D stamp and mug preview.
// The UI listens for running/result/failed events rather than building geometry itself.
import { loadFont, layoutText, wrapText } from './text.js';
import { loadSVGArtwork } from './svg.js';
import { validate } from './validate.js';
import { buildStamp, DEFAULT_STAMP } from './stamp.js';
import { BUILT_IN_FONTS, DEFAULT_FONT_ID } from './fonts.js';
import { loadSTLGeometry } from '../loaders.js';
import { initializeSolids } from '../solidGeometry.js';
import { prepareClosedStamp } from '../exportValidation.js';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

const SAMPLE_HANDLE = './models/StampHandle.stl';
const DEBOUNCE_MS = 300;

export const DEFAULT_SOURCE = {
    kind: 'text', // 'text' | 'svg'
    text: 'CLAY',
    fontId: DEFAULT_FONT_ID,
    fontFile: null,
    size: 16,
    letterSpacing: 0,
    lineSpacing: 1.25,
    align: 'center',
    svgFile: null,
    svgSize: 30
};

/**
 * Runs the workflow:
 *
 *     text + font + layout ─┐
 *                           ├─→ canonical 2D → validate/repair → stamp → mesh
 *     SVG upload ───────────┘
 *
 * Edits are debounced, and the canonical artwork is reused when only stamp
 * parameters changed, so dragging a slider does not re-parse a font.
 */
export class Pipeline extends EventTarget {
    constructor() {
        super();

        this.source = { ...DEFAULT_SOURCE };
        this.stamp = { ...DEFAULT_STAMP };

        this.result = null;
        this.cache = { key: null, artwork: null, issues: [] };
        this.handles = new Map();

        this.timer = null;
        this.token = 0;
    }

    setSource(patch) {
        Object.assign(this.source, patch);
        this.schedule();
    }

    setStamp(patch) {
        Object.assign(this.stamp, patch);
        this.schedule();
    }

    /**
     * The one number a resize gesture should drive — whatever currently decides
     * how big the stamp comes out.
     *
     * With the face sized to the artwork, that is the artwork's own size and
     * the face follows it. With a fixed face, it is the face itself.
     */
    get sizeDriver() {
        if (!this.stamp.autoFaceSize) {
            return { field: 'faceSize', value: this.stamp.faceSize };
        }

        return this.source.kind === 'svg'
            ? { field: 'svgSize', value: this.source.svgSize }
            : { field: 'size', value: this.source.size };
    }

    applySize(millimetres) {
        const { field } = this.sizeDriver;
        const value = Math.min(Math.max(millimetres, 1), 400);

        if (field === 'faceSize') this.setStamp({ faceSize: value });
        else this.setSource({ [field]: value });

        return value;
    }

    schedule() {
        // Wait for a pause in typing, and invalidate any older work immediately.
        clearTimeout(this.timer);
        ++this.token;
        this.busy = true;
        this.dispatchEvent(new Event('running'));
        this.timer = setTimeout(() => this.run(), DEBOUNCE_MS);
    }

    async run() {
        clearTimeout(this.timer);

        // Only the newest run is allowed to publish; an earlier one that was
        // still awaiting a font would otherwise overwrite it.
        const token = ++this.token;
        this.busy = true;
        this.dispatchEvent(new Event('running'));

        try {
            const { artwork, issues } = await this.artwork();
            if (token !== this.token) return;

            if (artwork.length === 0) {
                this.publish({ artwork, issues, stamp: null, clay: null, info: null, notes: [] }, token);
                return;
            }

            const handle = await this.handleGeometry();
            if (token !== this.token) return;

            await initializeSolids(wasmUrl);
            if (token !== this.token) return;
            const built = buildStamp(artwork, this.stamp, handle);
            try {
                // Check the stamp before publishing it; STL export checks the file again.
                prepareClosedStamp(built.stamp).dispose();
                built.notes.push('Stamp surface checks passed: closed, consistently oriented edges. Review in your slicer before printing.');
            } catch (error) {
                built.stamp.dispose();
                built.clay.dispose();
                throw error;
            }
            this.publish({ artwork, issues, ...built }, token);
        } catch (error) {
            if (token !== this.token) return;

            console.error(error);
            this.result = null;
            this.busy = false;
            this.error = error;
            this.dispatchEvent(new Event('failed'));
        }
    }

    publish(result, token) {
        if (token !== this.token) return;

        this.result = result;
        this.busy = false;
        this.error = null;
        this.dispatchEvent(new Event('result'));
    }

    // Source → canonical → validated, skipping the work when the inputs that
    // feed it have not changed.
    async artwork() {
        const key = this.sourceKey();

        if (this.cache.key === key) {
            return { artwork: this.cache.artwork, issues: this.cache.issues };
        }

        const { canonical, issues } = await this.buildArtwork();
        const checked = validate(canonical);

        // What the wrap did to the text comes first: it explains the artwork
        // the check is reporting on.
        const combined = [...issues, ...checked.issues];

        this.cache = { key, artwork: checked.artwork, issues: combined };

        return { artwork: checked.artwork, issues: combined };
    }

    async buildArtwork() {
        const source = this.source;

        if (source.kind === 'svg') {
            if (source.svgFile === null) return { canonical: [], issues: [] };

            const canonical = await loadSVGArtwork(source.svgFile, { size: source.svgSize });
            return { canonical, issues: [] };
        }

        if (source.text.trim() === '') return { canonical: [], issues: [] };

        const font = await loadFont(source.fontFile ?? fontURL(source.fontId));

        // Rows are settled before anything is drawn: the wrap decides the
        // breaks and the size, the layout sets what it is handed.
        const wrapped = wrapText(font, {
            text: source.text,
            size: source.size,
            letterSpacing: source.letterSpacing
        });

        const canonical = layoutText(font, {
            text: wrapped.text,
            size: wrapped.size,
            letterSpacing: source.letterSpacing,
            lineSpacing: source.lineSpacing,
            align: source.align
        });

        return { canonical, issues: wrapped.issues };
    }

    async handleGeometry() {
        const choice = this.stamp.handle;
        if (choice === 'none') return null;

        const source = choice === 'sample' ? SAMPLE_HANDLE : choice;
        const key = source instanceof File ? `${source.name}:${source.size}` : source;

        if (!this.handles.has(key)) {
            this.handles.set(key, loadSTLGeometry(source));
        }

        return this.handles.get(key);
    }

    sourceKey() {
        // Only artwork inputs belong here; backing/handle edits can reuse the same outlines.
        const source = this.source;

        if (source.kind === 'svg') {
            const file = source.svgFile;
            if (file === null) return 'svg:none';

            // The sample is a URL string; an upload is a File.
            const id = typeof file === 'string'
                ? file
                : `${file.name}:${file.size}:${file.lastModified}`;

            return `svg:${id}:${source.svgSize}`;
        }

        return [
            'text', source.text, source.fontId,
            source.fontFile === null ? '' : `${source.fontFile.name}:${source.fontFile.size}`,
            source.size, source.letterSpacing, source.lineSpacing, source.align
        ].join('|');
    }
}

function fontURL(id) {
    const font = BUILT_IN_FONTS.find((candidate) => candidate.id === id) ?? BUILT_IN_FONTS[0];
    return font.url;
}
