// Packages validated stamp geometry as STL or 3MF and starts the browser download.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { prepareClosedStamp, verifiedSTL } from './exportValidation.js';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const MODEL_REL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const MODEL_PATH = '3D/3dmodel.model';

// Serialize the completed stamp, then check the actual STL bytes before download.
export function exportSTL(parts, filename) {
    if (parts.length === 0) {
        throw new Error('Nothing to export — add a part first.');
    }
    const geometries = [];
    let merged;
    try {
        for (const part of parts) geometries.push(bakedGeometry(part));
        // This collects triangles; it does not join overlapping solids like a boolean union.
        merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
        if (!merged) throw new Error('Could not merge the parts into one mesh.');
        download(verifiedSTL(merged), filename);
    } finally {
        if (geometries.length > 1) merged?.dispose();
        geometries.forEach(geometry => geometry.dispose());
    }
}

// 3MF keeps the parts apart, records that the numbers are millimetres, and
// carries each part's colour, so a slicer opens the assembly as you built it.
export function export3MF(parts, filename) {
    download(create3MF(parts), filename);
}

// Kept separate from the download so tests can inspect the actual archive.
export function create3MF(parts) {
    if (parts.length === 0) {
        throw new Error('Nothing to export — add a part first.');
    }

    const model = buildModelXML(parts);

    // A 3MF is a ZIP containing model XML and files describing where to find it.
    const archive = zipSync({
        '[Content_Types].xml': strToU8(CONTENT_TYPES),
        '_rels/.rels': strToU8(RELATIONSHIPS),
        [MODEL_PATH]: strToU8(model)
    }, { level: 6 });

    return new Blob([archive], { type: 'model/3mf' });
}

function buildModelXML(parts) {
    // Ids have to be unique across all resources; 1 is taken by the materials.
    const materialsId = 1;
    const objectIdOf = (index) => index + 2;

    const materials = parts
        .map((part) => `  <base name="${escapeXML(part.name)}" displaycolor="${displayColor(part.color)}" />`)
        .join('\n');

    const objects = parts.map((part, index) => {
        const geometry = bakedGeometry(part);
        const mesh = meshXML(geometry);
        geometry.dispose();

        return `  <object id="${objectIdOf(index)}" type="model" pid="${materialsId}" pindex="${index}" name="${escapeXML(part.name)}">
   <mesh>
${mesh}
   </mesh>
  </object>`;
    }).join('\n');

    const items = parts
        .map((_, index) => `  <item objectid="${objectIdOf(index)}" />`)
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}">
 <resources>
  <basematerials id="${materialsId}">
${materials}
  </basematerials>
${objects}
 </resources>
 <build>
${items}
 </build>
</model>
`;
}

// Store each corner once, then describe each triangle with three corner indices.
function meshXML(geometry) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();

    const vertices = [];
    for (let i = 0; i < position.count; i++) {
        vertices.push(`     <vertex x="${num(position.getX(i))}" y="${num(position.getY(i))}" z="${num(position.getZ(i))}" />`);
    }

    const triangles = [];
    for (let i = 0; i < index.count; i += 3) {
        triangles.push(`     <triangle v1="${index.getX(i)}" v2="${index.getX(i + 1)}" v3="${index.getX(i + 2)}" />`);
    }

    return `    <vertices>
${vertices.join('\n')}
    </vertices>
    <triangles>
${triangles.join('\n')}
    </triangles>`;
}

// Both export formats use the same closed-surface checks.
function bakedGeometry(part) {
    return prepareClosedStamp(part.geometry);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rel0" Target="/${MODEL_PATH}" Type="${MODEL_REL}" />
</Relationships>
`;

// Preserve coordinates exactly; rounding can collapse small triangles in 3MF.
function num(value) {
    return String(value);
}

function displayColor(color) {
    return `#${color.getHexString().toUpperCase()}FF`;
}

function escapeXML(text) {
    return text.replace(/[<>&"']/g, (character) => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;'
    })[character]);
}

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
}
