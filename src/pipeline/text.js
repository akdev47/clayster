// Loads fonts, fits text into rows, and converts the letter outlines into 2D polygons.
import * as THREE from "three";
import opentype from "opentype.js";
import { fromShapes } from "./canonical.js";
import { TEXT_LIMITS } from "./limits.js";

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
 * Breaks text into rows narrow enough to stamp, setting it smaller if that is
 * what it takes.
 *
 * Words move to the next row whole. One that will not fit a row even on its own
 * makes the text smaller rather than being chopped in half — a stamp reading
 * "CLAYST / ER" is nobody's intent — and so does text running past the rows it
 * is allowed. Breaking a word is the last resort, once the size cannot move.
 *
 * Returns the text with the breaks in, the size to set it at, and what the
 * Check panel should say about both.
 */
export function wrapText(
  font,
  { text, size = 12, letterSpacing = 0 } = {},
  limits = TEXT_LIMITS,
) {
  const paragraphs = String(text)
    .split("\n")
    .map((paragraph) =>
      paragraph
        .split(/ +/)
        .filter((word) => word !== "")
        .map((word) => measure(font, word)),
    );

  const space = total(measure(font, " ").units);
  const layout = (millimetres) =>
    flow(
      paragraphs,
      space,
      millimetres,
      letterSpacing,
      font.unitsPerEm,
      limits.rowWidth,
    );

  let chosen = size;
  let laid = layout(chosen);

  while (
    (laid.broken || laid.rows.length > limits.rows) &&
    chosen > limits.minSize
  ) {
    const smaller = Math.max(limits.minSize, round(chosen * SHRINK));
    if (smaller >= chosen) break; // Rounding has run out of room to move.

    chosen = smaller;
    laid = layout(chosen);
  }

  return {
    text: laid.rows.join("\n"),
    size: chosen,
    issues: report(laid, paragraphs.length, size, chosen, limits),
  };
}

function report({ rows, broken }, paragraphs, asked, chosen, limits) {
  const issues = [];

  if (rows.length > paragraphs) {
    issues.push({
      level: "fixed",
      message: `Wrapped onto ${rows.length} rows to keep each one inside ${limits.rowWidth} mm.`,
    });
  }

  if (chosen < asked) {
    issues.push({
      level: "fixed",
      message:
        `Set at ${chosen} mm rather than ${asked} mm, which is the largest that fits ` +
        `${limits.rowWidth} mm rows.`,
    });
  }

  if (rows.length > limits.rows) {
    issues.push({
      level: "warning",
      message:
        `This runs to ${rows.length} rows and only ${limits.rows} are allowed, even at the ` +
        `smallest size of ${limits.minSize} mm. It is shown in full — shorten it, or raise the ` +
        "limit in limits.js.",
    });
  }

  if (broken) {
    issues.push({
      level: "warning",
      message:
        `A word is too long for a ${limits.rowWidth} mm row even at ${limits.minSize} mm, so ` +
        "it has been broken across rows.",
    });
  }

  return issues;
}

// Fills rows greedily at one size. Widths come from advances measured once per
// word, so trying another size is arithmetic rather than another pass over the
// font.
function flow(paragraphs, space, size, letterSpacing, unitsPerEm, rowWidth) {
  const width = (units, glyphs) =>
    (units * size) / unitsPerEm + glyphs * letterSpacing;
  const fits = (units, glyphs) => width(units, glyphs) <= rowWidth;

  const rows = [];
  let broken = false;

  for (const words of paragraphs) {
    let row = { text: "", units: 0, glyphs: 0 };

    for (const word of words) {
      const pieces = divide(word, fits);
      if (pieces.length > 1) broken = true;

      pieces.forEach((piece, index) => {
        const carried = total(piece.units);

        // The space between two words costs a glyph's worth of letter
        // spacing as well as its own advance.
        const joined = row.units + space + carried;
        const joinedGlyphs = row.glyphs + 1 + piece.units.length;

        // What is left of a broken word resumes on a row of its own; a
        // whole word only moves down when it will not fit where it is.
        if (row.text !== "" && (index > 0 || !fits(joined, joinedGlyphs))) {
          rows.push(row.text);
          row = { text: "", units: 0, glyphs: 0 };
        }

        const empty = row.text === "";

        row = {
          text: empty ? piece.text : `${row.text} ${piece.text}`,
          units: empty ? carried : joined,
          glyphs: empty ? piece.units.length : joinedGlyphs,
        };
      });
    }

    rows.push(row.text);
  }

  return { rows, broken };
}

// A word that will not fit a row on its own, cut into pieces that will. Almost
// every word comes back whole.
function divide(word, fits) {
  if (fits(total(word.units), word.units.length)) return [word];

  const pieces = [];
  let start = 0;

  for (let end = 1; end <= word.units.length; end++) {
    const units = word.units.slice(start, end);

    if (!fits(total(units), units.length) && end - start > 1) {
      pieces.push({
        text: word.text.slice(start, end - 1),
        units: word.units.slice(start, end - 1),
      });
      start = end - 1;
    }
  }

  pieces.push({ text: word.text.slice(start), units: word.units.slice(start) });

  return pieces;
}

// What each glyph of a word advances in font units, kerning included, which
// scales to millimetres at any size.
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

  lines.forEach((line, index) => {
    const glyphs = font.stringToGlyphs(line);
    const widths = advanceWidths(font, glyphs, scale, letterSpacing);
    const lineWidth = widths.reduce((total, width) => total + width, 0);

    // opentype counts Y downwards, so later lines get a larger Y and end up
    // below the first once canonical.js flips the axis.
    let x = alignOffset(align, lineWidth);
    const y = index * lineHeight;

    glyphs.forEach((glyph, position) => {
      const path = glyph.getPath(x, y, size);
      if (path.commands.length > 0) drawn++;
      appendCommands(shapePath, path.commands);
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

function alignOffset(align, lineWidth) {
  if (align === "left") return 0;
  if (align === "right") return -lineWidth;
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
