// Loads fonts, fits text into rows, and converts the letter outlines into 2D polygons.
import * as THREE from "three";
import * as opentypeModule from "opentype.js";
import { fromShapes } from "./canonical.js";
import { TEXT_LIMITS } from "./limits.js";

// The browser loads opentype.js' ES build, which only has named exports; Node
// loads the CommonJS build, whose default export is the whole library.
const opentype = opentypeModule.default ?? opentypeModule;

// Cache fonts loaded by URL; uploaded File objects are parsed directly below.
const cache = new Map();

export async function loadFont(source) {
  if (source instanceof File) {
    return opentype.parse(await source.arrayBuffer());
  }

  if (cache.has(source)) return cache.get(source);

  const pending = fetch(source)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Could not fetch the font (${response.status}).`);
      return response.arrayBuffer();
    })
    .then((buffer) => opentype.parse(buffer));

  cache.set(source, pending);

  return pending;
}

export function fontName(font) {
  const names = font.names.windows ?? font.names.macintosh ?? {};
  return names.fontFamily?.en ?? "Uploaded font";
}

const SHRINK = 0.94; // How much smaller each attempt is.

/**
 * Keeps the user's line breaks exactly as entered, reducing the font size only
 * when one of those lines is wider than the configured row width.
 */
export function fitText(
  font,
  { text, size = 12, letterSpacing = 0 } = {},
  limits = TEXT_LIMITS,
) {
  const value = String(text);
  const lines = value.split("\n");
  const measured = lines.map((line) => measure(font, line));
  const widthAt = (line, millimetres) =>
    (total(line.units) * millimetres) / font.unitsPerEm +
    line.units.length * letterSpacing;
  const fits = (millimetres) =>
    measured.every((line) => widthAt(line, millimetres) <= limits.rowWidth);

  let chosen = size;
  while (!fits(chosen) && chosen > limits.minSize) {
    const smaller = Math.max(limits.minSize, round(chosen * SHRINK));
    if (smaller >= chosen) break;
    chosen = smaller;
  }

  const issues = [];
  if (chosen < size) {
    issues.push({
      level: "fixed",
      message:
        `Set at ${chosen} mm rather than ${size} mm, which is the largest that fits ` +
        `${limits.rowWidth} mm rows.`,
    });
  }
  if (lines.length > limits.rows) {
    issues.push({
      level: "warning",
      message:
        `This has ${lines.length} user-entered rows and only ${limits.rows} are allowed. ` +
        "Remove a line break or shorten the text.",
    });
  }

  return { text: value, size: chosen, issues };
}

// What each glyph advances in font units, kerning included, which scales to
// millimetres at any size.
function measure(font, word) {
  const glyphs = font.stringToGlyphs(word);

  return {
    text: word,
    units: glyphs.map(
      (glyph, index) =>
        glyph.advanceWidth +
        (index > 0 ? font.getKerningValue(glyphs[index - 1], glyph) : 0),
    ),
  };
}

function total(units) {
  return units.reduce((sum, value) => sum + value, 0);
}

function round(millimetres) {
  return Math.round(millimetres * 10) / 10;
}

/**
 * Lays text out and returns it in canonical form, in millimetres.
 *
 * `size` is the em size, so it is roughly the height of a capital plus its
 * ascender room rather than the exact cap height; the dimension readout in the
 * preview reports what the artwork actually measures.
 */
export function layoutText(
  font,
  {
    text,
    size = 12,
    letterSpacing = 0,
    lineSpacing = 1.25,
    align = "center",
    glyphOutlines = null,
  } = {},
) {
  const lines = String(text).split("\n");
  const scale = size / font.unitsPerEm;
  const lineHeight = size * lineSpacing;

  // Every glyph of every line goes into one ShapePath. Resolving which
  // contours are holes is then three's job, and it is the same code path the
  // SVG source goes through.
  const shapePath = new THREE.ShapePath();
  let drawn = 0;
  const laidOutLines = lines.map((line) => {
    const glyphs = font.stringToGlyphs(line);
    const widths = advanceWidths(font, glyphs, scale, letterSpacing);
    return {
      glyphs,
      widths,
      width: widths.reduce((total, width) => total + width, 0),
    };
  });
  const blockWidth = Math.max(0, ...laidOutLines.map(({ width }) => width));

  laidOutLines.forEach(({ glyphs, widths, width }, index) => {
    // Only label characters when shaping preserves a one-to-one mapping.
    // Ligatures/substitutions retain the ordinary shape diagnostic instead.
    const characters = Array.from(lines[index]);
    const characterGlyphs = glyphOutlines === null ? [] :
      characters.map((character) => font.stringToGlyphs(character));
    const attributable = glyphOutlines !== null && characters.length === glyphs.length &&
      characterGlyphs.every((mapped, position) =>
        mapped.length === 1 && mapped[0].index === glyphs[position].index);
    // opentype counts Y downwards, so later lines get a larger Y and end up
    // below the first once canonical.js flips the axis.
    let x = alignOffset(align, width, blockWidth);
    const y = index * lineHeight;

    glyphs.forEach((glyph, position) => {
      const path = glyph.getPath(x, y, size);
      if (path.commands.length > 0) drawn++;
      appendCommands(shapePath, path.commands);
      if (glyphOutlines !== null && path.commands.length > 0) {
        const glyphPath = new THREE.ShapePath();
        appendCommands(glyphPath, path.commands);
        glyphOutlines.push({
          character: attributable ? characters[position] : null,
          line: index + 1,
          column: position + 1,
          canonical: fromShapes(glyphPath.toShapes(), { flipY: true }),
        });
      }
      x += widths[position];
    });
  });

  if (drawn === 0) return [];

  return fromShapes(shapePath.toShapes(), { flipY: true });
}

// Advance per glyph, including the font's own kerning for the pair.
function advanceWidths(font, glyphs, scale, letterSpacing) {
  return glyphs.map((glyph, index) => {
    const kerning =
      index > 0 ? font.getKerningValue(glyphs[index - 1], glyph) : 0;
    return (glyph.advanceWidth + kerning) * scale + letterSpacing;
  });
}

function alignOffset(align, lineWidth, blockWidth) {
  const blockLeft = -blockWidth / 2;
  if (align === "left") return blockLeft;
  if (align === "right") return blockLeft + blockWidth - lineWidth;
  return -lineWidth / 2;
}

// Translate font drawing commands (move, line, curves) into Three.js paths.
function appendCommands(shapePath, commands) {
  for (const command of commands) {
    switch (command.type) {
      case "M":
        shapePath.moveTo(command.x, command.y);
        break;
      case "L":
        shapePath.lineTo(command.x, command.y);
        break;
      case "Q":
        shapePath.quadraticCurveTo(
          command.x1,
          command.y1,
          command.x,
          command.y,
        );
        break;
      case "C":
        shapePath.bezierCurveTo(
          command.x1,
          command.y1,
          command.x2,
          command.y2,
          command.x,
          command.y,
        );
        break;
      default: // 'Z' — contours are closed implicitly when extracted.
        break;
    }
  }
}
