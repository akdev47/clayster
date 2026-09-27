// Converts simple high-contrast raster artwork into closed SVG path contours.
// SVG is an internal interchange only; the user still receives the finished STL.

const ALPHA_THRESHOLD = 128;
const LUMINANCE_THRESHOLD = 128;
const MAX_PIXELS = 4_000_000;
const MAX_EDGES = 500_000;

export async function tracePNGToSVG(file) {
  if (!(file instanceof File) || !isPNG(file)) {
    throw new Error("Please choose a PNG image.");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That PNG image could not be read.");
  }

  try {
    const { width, height } = bitmap;
    if (width === 0 || height === 0) throw new Error("The PNG image is empty.");
    if (width * height > MAX_PIXELS) {
      throw new Error("The PNG is too large to trace. Use an image under 4 megapixels.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("PNG tracing is not available in this browser.");
    }

    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    return traceMaskToSVG(binaryMask(pixels, width, height), width, height);
  } finally {
    bitmap.close();
  }
}

function isPNG(file) {
  return file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
}

function binaryMask(pixels, width, height) {
  let borderLight = 0;
  let borderSamples = 0;
  let transparentBorder = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < ALPHA_THRESHOLD) {
        transparentBorder++;
      } else {
        borderLight += luminance(pixels, (y * width + x) * 4);
        borderSamples++;
      }
    }
  }
  const transparentBackground =
    transparentBorder > borderSamples && transparentBorder > 0;
  const lightBackground =
    borderSamples === 0 || borderLight / borderSamples >= LUMINANCE_THRESHOLD;

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    mask[i] = transparentBackground
      ? Number(pixels[offset + 3] >= ALPHA_THRESHOLD)
      : Number(
          pixels[offset + 3] >= ALPHA_THRESHOLD &&
            (lightBackground
              ? luminance(pixels, offset) < LUMINANCE_THRESHOLD
              : luminance(pixels, offset) >= LUMINANCE_THRESHOLD),
        );
  }
  return mask;
}

function luminance(pixels, offset) {
  return (
    pixels[offset] * 0.2126 +
    pixels[offset + 1] * 0.7152 +
    pixels[offset + 2] * 0.0722
  );
}

export function traceMaskToSVG(mask, width, height) {
  if (mask.length !== width * height) throw new Error("Invalid PNG trace mask.");

  const edges = [];
  const starts = new Map();
  const filled = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;

  const add = (sx, sy, ex, ey, direction) => {
    const edge = { sx, sy, ex, ey, direction, used: false };
    edges.push(edge);
    const key = `${sx},${sy}`;
    const list = starts.get(key);
    if (list === undefined) starts.set(key, [edge]);
    else list.push(edge);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      // Edges run with the filled pixel on their right. Outer and hole
      // contours therefore receive opposite winding automatically.
      if (!filled(x, y - 1)) add(x, y, x + 1, y, 0);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
      if (!filled(x - 1, y)) add(x, y + 1, x, y, 3);
    }
  }

  if (edges.length === 0) {
    throw new Error("The PNG has no high-contrast artwork to turn into a stamp.");
  }
  if (edges.length > MAX_EDGES) {
    throw new Error("The PNG is too detailed to trace. Simplify or reduce the image first.");
  }

  const paths = [];
  for (const first of edges) {
    if (first.used) continue;
    const points = [[first.sx, first.sy]];
    let edge = first;

    while (true) {
      edge.used = true;
      points.push([edge.ex, edge.ey]);
      if (edge.ex === first.sx && edge.ey === first.sy) break;

      const candidates = (starts.get(`${edge.ex},${edge.ey}`) ?? []).filter(
        (candidate) => !candidate.used,
      );
      if (candidates.length === 0) {
        throw new Error("Could not trace a closed PNG outline.");
      }
      edge = chooseTurn(edge.direction, candidates);
    }

    const ring = removeCollinear(points.slice(0, -1));
    if (ring.length >= 3) {
      paths.push(`M${ring.map(([x, y]) => `${x} ${y}`).join("L")}Z`);
    }
  }

  if (paths.length === 0) {
    throw new Error("The PNG has no usable closed outlines.");
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="#000" fill-rule="evenodd" d="${paths.join("")}"/></svg>`;
}

function chooseTurn(direction, candidates) {
  const priority = new Map([
    [1, 0], // right
    [0, 1], // straight
    [3, 2], // left
    [2, 3], // back
  ]);
  return candidates.reduce((best, candidate) =>
    priority.get((candidate.direction - direction + 4) % 4) <
    priority.get((best.direction - direction + 4) % 4)
      ? candidate
      : best,
  );
}

function removeCollinear(ring) {
  if (ring.length < 3) return ring;
  return ring.filter((point, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length];
    const next = ring[(index + 1) % ring.length];
    return (
      (point[0] - previous[0]) * (next[1] - point[1]) !==
      (point[1] - previous[1]) * (next[0] - point[0])
    );
  });
}
