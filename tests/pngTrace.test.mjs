import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPNGTraceMask,
  traceMaskToSVG,
} from "../src/pngTrace.js";
import { postProcessPNGArtwork } from "../src/pipeline/png.js";
import { ringArea } from "../src/pipeline/canonical.js";

const maskFrom = (width, height, filled) =>
  Uint8Array.from({ length: width * height }, (_, index) =>
    filled(index % width, Math.floor(index / width)) ? 1 : 0,
  );

const rgba = (width, height, color) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    pixels.set(color, index * 4);
  }
  return pixels;
};

const spatialRGBA = (width, height, colorAt) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set([...colorAt(x, y), 255], (y * width + x) * 4);
    }
  }
  return pixels;
};

const interpolate = (start, end, amount) =>
  start.map((value, index) =>
    Math.round(value + (end[index] - value) * amount),
  );

const mix = (first, second, amount) =>
  first.map((value, index) =>
    Math.round(value + (second[index] - value) * amount),
  );

const countMask = (mask) => mask.reduce((total, value) => total + value, 0);

const setPixel = (pixels, width, x, y, color) =>
  pixels.set(color, (y * width + x) * 4);

const at = (mask, width, x, y) => mask[y * width + x];

const ringsFrom = (svg) =>
  [...svg.matchAll(/M([^Z]+)Z/g)].map((path) =>
    [...path[1].matchAll(/(?:^|L)(-?[\d.]+) (-?[\d.]+)/g)].map(
      (point) => [Number(point[1]), Number(point[2])],
    ),
  );

const processMask = (mask, width, height, size = 30) => {
  const raw = ringsFrom(traceMaskToSVG(mask, width, height));
  return { raw, processed: postProcessPNGArtwork([[...raw]], size)[0] };
};

test("PNG tracing creates a closed contour", () => {
  const svg = traceMaskToSVG(
    new Uint8Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]),
    4,
    4,
  );

  assert.match(svg, /<svg/);
  assert.match(svg, /M1 1L3 1L3 3L1 3Z/);
});

test("PNG tracing preserves holes as a second contour", () => {
  const svg = traceMaskToSVG(new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]), 3, 3);

  assert.equal((svg.match(/M/g) ?? []).length, 2);
  assert.match(svg, /fill-rule="evenodd"/);
});

test("diagonally touching pixels remain separate shapes", () => {
  const svg = traceMaskToSVG(new Uint8Array([1, 0, 0, 1]), 2, 2);
  assert.equal((svg.match(/M/g) ?? []).length, 2);
});

test("PNG tracing rejects an empty image", () => {
  assert.throws(
    () => traceMaskToSVG(new Uint8Array(4), 2, 2),
    /no high-contrast artwork/i,
  );
});

test("rounded PNG silhouettes are simplified without changing their overall shape", () => {
  const width = 64;
  const height = 64;
  const mask = maskFrom(
    width,
    height,
    (x, y) => (x - 31.5) ** 2 + (y - 31.5) ** 2 <= 25 ** 2,
  );
  const { raw, processed } = processMask(mask, width, height);
  const ring = processed[0];

  assert.ok(ring.length < raw[0].length * 0.6);
  assert.ok(
    ring.every(([x, y]) => Math.abs(Math.hypot(x, y) - 15) <= 0.75),
  );
});

test("photographic edge noise is smoothed while a pronounced tip remains", () => {
  const width = 256;
  const height = 256;
  const mask = maskFrom(width, height, (x, y) => {
    const dx = x - 112;
    const dy = y - 128;
    const angle = Math.atan2(dy, dx);
    const noisyRadius = 88 + Math.sin(angle * 48) * 1.5;
    const body = Math.hypot(dx, dy) <= noisyRadius;
    const tip = x >= 198 && x <= 238 && Math.abs(y - 128) <= (238 - x) / 3;
    return body || tip;
  });
  const { raw, processed } = processMask(mask, width, height);
  const ring = processed[0];

  assert.ok(ring.length < raw[0].length * 0.35);
  assert.ok(ring.some(([x]) => x === 15));
});

test("PNG smoothing strength controls contour point reduction", () => {
  const width = 256;
  const height = 256;
  const mask = maskFrom(
    width,
    height,
    (x, y) =>
      Math.hypot(x - 127.5, y - 127.5) <=
      90 + Math.sin(Math.atan2(y - 127.5, x - 127.5) * 48) * 1.5,
  );
  const raw = ringsFrom(traceMaskToSVG(mask, width, height));
  const off = postProcessPNGArtwork([[...raw]], 30, { smoothing: 0 })[0][0];
  const normal = postProcessPNGArtwork([[...raw]], 30)[0][0];
  const strong = postProcessPNGArtwork([[...raw]], 30, { smoothing: 4 })[0][0];

  assert.ok(normal.length < off.length);
  assert.ok(strong.length < normal.length);
  assert.notEqual(ringArea(strong), 0);
});

test("diagonal PNG edges lose their staircase without losing the silhouette", () => {
  const width = 64;
  const height = 64;
  const mask = maskFrom(
    width,
    height,
    (x, y) => x >= 6 && y >= x / 2 + 8 && y <= 55,
  );
  const { raw, processed } = processMask(mask, width, height);

  assert.ok(processed[0].length < raw[0].length / 2);
  assert.ok(Math.abs(ringArea(processed[0])) > 100);
});

test("sharp PNG corners remain anchored", () => {
  const artwork = [[[
    [0, 0],
    [10, 0],
    [10, 4],
    [16, 5],
    [10, 6],
    [10, 10],
    [0, 10],
  ]]];
  const processed = postProcessPNGArtwork(artwork, 16, {
    smoothing: 4,
  })[0][0];

  assert.ok(processed.some(([x, y]) => x === 8 && y === 0));
});

test("PNG contour cleanup preserves holes and their winding", () => {
  const width = 48;
  const height = 48;
  const mask = maskFrom(width, height, (x, y) => {
    const outer = (x - 23.5) ** 2 + (y - 23.5) ** 2 <= 20 ** 2;
    const hole = (x - 23.5) ** 2 + (y - 23.5) ** 2 < 8 ** 2;
    return outer && !hole;
  });
  const { processed } = processMask(mask, width, height);

  assert.equal(processed.length, 2);
  assert.ok(ringArea(processed[0]) * ringArea(processed[1]) < 0);
});

test("cleaned PNG contours remain valid closed rings", () => {
  const artwork = [[[
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
    [2, 2],
    [0, 2],
  ]]];
  const ring = postProcessPNGArtwork(artwork, 20)[0][0];

  assert.ok(ring.length >= 3);
  assert.notDeepEqual(ring[0], ring[ring.length - 1]);
  assert.ok(ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  assert.notEqual(ringArea(ring), 0);
});

test("transparent PNGs preserve the existing alpha silhouette behavior", () => {
  const pixels = rgba(5, 5, [255, 255, 255, 0]);
  setPixel(pixels, 5, 2, 2, [255, 255, 255, 255]);
  const result = createPNGTraceMask(pixels, 5, 5, {
    backgroundMode: "auto",
  });

  assert.equal(at(result.mask, 5, 2, 2), 1);
  assert.equal(at(result.mask, 5, 0, 0), 0);
  assert.equal(result.exclusionMask.some(Boolean), false);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.segmentation, {
    status: "confident",
    method: "alpha",
    message: null,
  });
});

test("Auto removes a light border background around dark artwork", () => {
  const pixels = rgba(7, 7, [245, 245, 245, 255]);
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) setPixel(pixels, 7, x, y, [20, 20, 20, 255]);
  }
  const result = createPNGTraceMask(pixels, 7, 7);

  assert.equal(at(result.exclusionMask, 7, 0, 0), 1);
  assert.equal(at(result.mask, 7, 0, 0), 0);
  assert.equal(at(result.mask, 7, 3, 3), 1);
});

test("Auto removes a dark border background around light artwork", () => {
  const pixels = rgba(7, 7, [15, 15, 15, 255]);
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) setPixel(pixels, 7, x, y, [235, 235, 235, 255]);
  }
  const result = createPNGTraceMask(pixels, 7, 7);

  assert.equal(at(result.exclusionMask, 7, 0, 0), 1);
  assert.equal(at(result.mask, 7, 0, 0), 0);
  assert.equal(at(result.mask, 7, 3, 3), 1);
});

test("Auto detects and excludes a simple colored background", () => {
  const pixels = rgba(7, 7, [40, 190, 90, 255]);
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) setPixel(pixels, 7, x, y, [10, 10, 10, 255]);
  }
  const result = createPNGTraceMask(pixels, 7, 7);

  assert.equal(at(result.exclusionMask, 7, 0, 0), 1);
  assert.equal(at(result.mask, 7, 3, 3), 1);
});

test("contrasting artwork touching an edge is not flooded as background", () => {
  const pixels = rgba(9, 9, [255, 255, 255, 255]);
  for (let y = 0; y <= 5; y++) setPixel(pixels, 9, 4, y, [0, 0, 0, 255]);
  const result = createPNGTraceMask(pixels, 9, 9);

  assert.equal(at(result.exclusionMask, 9, 4, 0), 0);
  assert.equal(at(result.mask, 9, 4, 0), 1);
  assert.equal(at(result.exclusionMask, 9, 3, 0), 1);
});

test("background removal does not flood an enclosed hole", () => {
  const pixels = rgba(9, 9, [255, 255, 255, 255]);
  for (let y = 1; y <= 7; y++) {
    for (let x = 1; x <= 7; x++) setPixel(pixels, 9, x, y, [0, 0, 0, 255]);
  }
  for (let y = 3; y <= 5; y++) {
    for (let x = 3; x <= 5; x++) setPixel(pixels, 9, x, y, [255, 255, 255, 255]);
  }
  const result = createPNGTraceMask(pixels, 9, 9);
  const svg = traceMaskToSVG(result.mask, 9, 9);

  assert.equal(at(result.exclusionMask, 9, 4, 4), 0);
  assert.equal(at(result.mask, 9, 4, 4), 0);
  assert.equal((svg.match(/M/g) ?? []).length, 2);
});

test("ambiguous Auto borders fall back to original processing with a note", () => {
  const width = 6;
  const pixels = rgba(width, 6, [255, 255, 255, 255]);
  for (let x = 0; x < width; x++) {
    setPixel(pixels, width, x, 0, [220, 30, 30, 255]);
    setPixel(pixels, width, x, 5, [30, 30, 220, 255]);
  }
  for (let y = 1; y < 5; y++) {
    setPixel(pixels, width, 0, y, [220, 30, 30, 255]);
    setPixel(pixels, width, 5, y, [30, 30, 220, 255]);
  }
  const automatic = createPNGTraceMask(pixels, width, 6);
  const original = createPNGTraceMask(pixels, width, 6, {
    backgroundMode: "original",
  });

  assert.deepEqual(automatic.mask, original.mask);
  assert.equal(automatic.exclusionMask.some(Boolean), false);
  assert.deepEqual(automatic.issues, [
    {
      level: "info",
      message: "Auto background detection failed — review the traced result.",
    },
  ]);
  assert.equal(automatic.segmentation.status, "needs-review");
});

test("an all-background image produces the existing empty-trace failure", () => {
  const result = createPNGTraceMask(rgba(5, 5, [255, 255, 255, 255]), 5, 5);

  assert.equal(result.mask.some(Boolean), false);
  assert.throws(() => traceMaskToSVG(result.mask, 5, 5), /no high-contrast artwork/i);
});

test("explicit polarity never restores pixels excluded as background", () => {
  const light = rgba(5, 5, [230, 230, 230, 255]);
  setPixel(light, 5, 2, 2, [0, 0, 0, 255]);
  const dark = rgba(5, 5, [25, 25, 25, 255]);
  setPixel(dark, 5, 2, 2, [255, 255, 255, 255]);

  const lightResult = createPNGTraceMask(light, 5, 5, { backgroundMode: "light" });
  const darkResult = createPNGTraceMask(dark, 5, 5, { backgroundMode: "dark" });
  assert.equal(at(lightResult.exclusionMask, 5, 0, 0), 1);
  assert.equal(at(lightResult.mask, 5, 0, 0), 0);
  assert.equal(at(darkResult.exclusionMask, 5, 0, 0), 1);
  assert.equal(at(darkResult.mask, 5, 0, 0), 0);
  assert.equal(at(lightResult.mask, 5, 2, 2), 1);
  assert.equal(at(darkResult.mask, 5, 2, 2), 1);
});

test("Auto removes a vertical blue gradient before tracing", () => {
  const width = 40;
  const height = 40;
  const pixels = spatialRGBA(width, height, (_x, y) =>
    interpolate([165, 225, 250], [12, 45, 125], y / (height - 1)),
  );
  for (let y = 14; y <= 25; y++) {
    for (let x = 14; x <= 25; x++) {
      setPixel(pixels, width, x, y, [245, 230, 40, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(at(result.mask, width, 0, 0), 0);
  assert.equal(at(result.mask, width, 39, 39), 0);
  assert.equal(at(result.mask, width, 20, 20), 1);
  assert.ok(countMask(result.mask) < width * height * 0.2);
  assert.deepEqual(result.issues, []);
  assert.equal(result.segmentation.method, "plane");
});

test("Auto removes a diagonal blue gradient", () => {
  const width = 44;
  const height = 36;
  const pixels = spatialRGBA(width, height, (x, y) => {
    const amount = (x / (width - 1) + y / (height - 1)) / 2;
    return interpolate([175, 230, 250], [8, 42, 125], amount);
  });
  for (let y = 12; y <= 23; y++) {
    for (let x = 16; x <= 27; x++) {
      setPixel(pixels, width, x, y, [250, 250, 250, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(at(result.mask, width, 2, 2), 0);
  assert.equal(at(result.mask, width, 41, 33), 0);
  assert.equal(at(result.mask, width, 20, 18), 1);
  assert.ok(countMask(result.mask) < width * height * 0.2);
});

test("Auto removes a bilinear blue gradient", () => {
  const width = 48;
  const height = 40;
  const pixels = spatialRGBA(width, height, (x, y) => {
    const nx = x / (width - 1);
    const ny = y / (height - 1);
    return [
      Math.round(10 + 10 * nx + 20 * ny + 180 * nx * ny),
      Math.round(70 + 80 * nx + 30 * ny + 40 * nx * ny),
      Math.round(200 + 30 * nx - 50 * ny + 60 * nx * ny),
    ];
  });
  for (let y = 15; y <= 25; y++) {
    for (let x = 18; x <= 29; x++) {
      setPixel(pixels, width, x, y, [250, 220, 35, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(at(result.mask, width, 1, 1), 0);
  assert.equal(at(result.mask, width, 46, 38), 0);
  assert.equal(at(result.mask, width, 24, 20), 1);
  assert.ok(countMask(result.mask) < width * height * 0.2);
});

test("gradient segmentation preserves white, yellow, and edge-touching green foreground", () => {
  const width = 64;
  const height = 64;
  const backgroundAt = (x, y) => {
    const amount = (x / (width - 1) + y / (height - 1)) / 2;
    return interpolate([170, 230, 250], [8, 42, 120], amount);
  };
  const pixels = spatialRGBA(width, height, backgroundAt);

  for (let y = 13; y <= 39; y++) {
    for (let x = 18; x <= 46; x++) {
      const leftPetal = (x - 24) ** 2 + (y - 26) ** 2 <= 9 ** 2;
      const rightPetal = (x - 40) ** 2 + (y - 26) ** 2 <= 9 ** 2;
      const topPetal = (x - 32) ** 2 + (y - 20) ** 2 <= 9 ** 2;
      const bottomPetal = (x - 32) ** 2 + (y - 33) ** 2 <= 9 ** 2;
      if (leftPetal || rightPetal || topPetal || bottomPetal) {
        setPixel(pixels, width, x, y, [248, 248, 245, 255]);
      }
    }
  }
  for (let y = 22; y <= 30; y++) {
    for (let x = 28; x <= 36; x++) {
      if ((x - 32) ** 2 + (y - 26) ** 2 <= 4 ** 2) {
        setPixel(pixels, width, x, y, [245, 190, 20, 255]);
      }
    }
  }
  for (let y = 34; y < height; y++) {
    for (let x = 30; x <= 33; x++) {
      setPixel(pixels, width, x, y, [35, 145, 55, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);
  const traced = traceMaskToSVG(result.mask, width, height);

  assert.equal(at(result.mask, width, 23, 26), 1, "white petal");
  assert.equal(at(result.mask, width, 32, 26), 1, "yellow centre");
  assert.equal(at(result.mask, width, 31, 63), 1, "green stem at edge");
  assert.equal(at(result.mask, width, 2, 2), 0, "blue background");
  assert.ok(countMask(result.mask) < width * height * 0.4);
  assert.match(traced, /<path/);
});

test("foreground-contaminated border samples are rejected as model outliers", () => {
  const width = 48;
  const height = 48;
  const pixels = spatialRGBA(width, height, (_x, y) =>
    interpolate([155, 220, 248], [12, 50, 130], y / (height - 1)),
  );
  for (let x = 7; x <= 12; x++) {
    setPixel(pixels, width, x, 0, [250, 250, 245, 255]);
  }
  for (let y = 34; y < height; y++) {
    for (let x = 23; x <= 25; x++) {
      setPixel(pixels, width, x, y, [30, 145, 55, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(at(result.mask, width, 9, 0), 1);
  assert.equal(at(result.mask, width, 24, 47), 1);
  assert.equal(at(result.mask, width, 2, 24), 0);
  assert.equal(at(result.mask, width, 45, 24), 0);
});

test("gradient anti-aliasing removes background-like blends but keeps foreground-like edges", () => {
  const width = 40;
  const height = 40;
  const backgroundAt = (_x, y) =>
    interpolate([160, 225, 250], [15, 50, 125], y / (height - 1));
  const pixels = spatialRGBA(width, height, backgroundAt);
  const background = backgroundAt(12, 20);
  setPixel(pixels, width, 12, 20, [...mix(background, [250, 250, 245], 0.1), 255]);
  setPixel(pixels, width, 13, 20, [...mix(backgroundAt(13, 20), [250, 250, 245], 0.55), 255]);
  for (let y = 16; y <= 24; y++) {
    for (let x = 14; x <= 22; x++) {
      setPixel(pixels, width, x, y, [250, 250, 245, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(at(result.mask, width, 12, 20), 0);
  assert.equal(at(result.mask, width, 13, 20), 1);
  assert.equal(at(result.mask, width, 18, 20), 1);
});

test("uniform Auto background behavior remains unchanged", () => {
  const pixels = rgba(7, 7, [240, 240, 240, 255]);
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) {
      setPixel(pixels, 7, x, y, [20, 20, 20, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, 7, 7);
  const expected = maskFrom(7, 7, (x, y) => x >= 2 && x <= 4 && y >= 2 && y <= 4);

  assert.deepEqual(result.mask, expected);
  assert.deepEqual(result.issues, []);
  assert.equal(result.segmentation.method, "uniform");
});

test("irregular multicolour backgrounds fall back to Original processing", () => {
  const width = 40;
  const height = 40;
  const palette = [
    [235, 35, 45],
    [25, 190, 80],
    [35, 70, 225],
    [235, 205, 25],
  ];
  const pixels = spatialRGBA(width, height, (x, y) =>
    palette[(Math.floor(x / 4) + Math.floor(y / 5) * 3) % palette.length],
  );

  const automatic = createPNGTraceMask(pixels, width, height);
  const original = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "original",
  });

  assert.deepEqual(automatic.mask, original.mask);
  assert.deepEqual(automatic.issues, [
    {
      level: "info",
      message: "Auto background detection failed — review the traced result.",
    },
  ]);
  assert.equal(automatic.segmentation.status, "needs-review");
});

test("Auto removes a quadratic gray vignette while preserving a red logo", () => {
  const width = 72;
  const height = 72;
  const pixels = spatialRGBA(width, height, (x, y) => {
    const dx = (x / (width - 1) - 0.5) * 2;
    const dy = (y / (height - 1) - 0.5) * 2;
    const gray = Math.round(220 - 85 * (dx * dx + dy * dy));
    return [gray, gray, gray];
  });
  for (let y = 26; y <= 45; y++) {
    for (let x = 24; x <= 47; x++) {
      setPixel(pixels, width, x, y, [220, 25, 30, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(result.segmentation.status, "confident");
  assert.equal(result.segmentation.method, "quadratic");
  assert.equal(at(result.mask, width, 35, 35), 1);
  assert.equal(at(result.mask, width, 10, 10), 0);
  assert.equal(countMask(result.mask), 24 * 20);
});

test("black artwork remains foreground on a varying gray background", () => {
  const width = 48;
  const height = 48;
  const pixels = spatialRGBA(width, height, (_x, y) => {
    const gray = Math.round(225 - (y / (height - 1)) * 105);
    return [gray, gray, gray];
  });
  for (let y = 16; y <= 31; y++) {
    for (let x = 17; x <= 30; x++) {
      setPixel(pixels, width, x, y, [10, 10, 10, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(result.segmentation.status, "confident");
  assert.equal(at(result.mask, width, 23, 23), 1);
  assert.equal(at(result.mask, width, 3, 23), 0);
});

test("low-chroma artwork is retained when it differs from the local gray background", () => {
  const width = 48;
  const height = 48;
  const pixels = spatialRGBA(width, height, (x, _y) => {
    const gray = Math.round(235 - (x / (width - 1)) * 75);
    return [gray, gray, gray];
  });
  for (let y = 17; y <= 30; y++) {
    for (let x = 17; x <= 30; x++) {
      setPixel(pixels, width, x, y, [80, 82, 81, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(at(result.mask, width, 23, 23), 1);
  assert.equal(at(result.mask, width, 4, 23), 0);
});

test("similar border colors with an inconsistent interior require review", () => {
  const width = 56;
  const height = 56;
  const pixels = spatialRGBA(width, height, (x, y) => {
    const dx = Math.abs((x / (width - 1) - 0.5) * 2);
    const dy = Math.abs((y / (height - 1) - 0.5) * 2);
    const edgeDistance = Math.max(dx, dy);
    const gray = Math.round(40 + 180 * (1 - edgeDistance) ** 2);
    return [gray, gray, gray];
  });

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(result.segmentation.status, "needs-review");
  assert.equal(result.segmentation.method, "original-fallback");
  assert.match(result.segmentation.message, /review the traced result/i);
});

test("an underdetermined quadratic fit falls back for review", () => {
  const width = 1;
  const height = 24;
  const pixels = spatialRGBA(width, height, (_x, y) =>
    y % 2 === 0 ? [220, 30, 30] : [30, 40, 220],
  );

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(result.segmentation.status, "needs-review");
});

test("quadratic fields with implausible unclamped predictions are rejected", () => {
  const width = 64;
  const height = 64;
  const pixels = spatialRGBA(width, height, (x, y) => {
    const nx = x / (width - 1);
    const ny = y / (height - 1);
    const gray = Math.min(
      255,
      Math.round(20 + 500 * nx * (1 - nx) + 500 * ny * (1 - ny)),
    );
    return [gray, gray, gray];
  });

  const result = createPNGTraceMask(pixels, width, height);

  assert.equal(result.segmentation.status, "needs-review");
  assert.equal(result.segmentation.method, "original-fallback");
});

test("one trusted sample removes a uniform background", () => {
  const width = 40;
  const height = 32;
  const pixels = rgba(width, height, [210, 210, 210, 255]);
  for (let y = 10; y <= 21; y++) {
    for (let x = 13; x <= 26; x++) {
      setPixel(pixels, width, x, y, [210, 25, 35, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "pick",
    backgroundSamples: [{ x: 0.1, y: 0.1 }],
  });

  assert.equal(result.segmentation.status, "confident");
  assert.equal(result.segmentation.method, "picked-uniform");
  assert.equal(at(result.mask, width, 2, 2), 0);
  assert.equal(at(result.mask, width, 20, 15), 1);
});

test("distributed trusted samples fit a directional gradient", () => {
  const width = 52;
  const height = 44;
  const pixels = spatialRGBA(width, height, (x, y) => {
    const nx = x / (width - 1);
    const ny = y / (height - 1);
    const gray = Math.round(225 - 70 * nx - 45 * ny);
    return [gray, gray, gray];
  });
  for (let y = 16; y <= 28; y++) {
    for (let x = 19; x <= 32; x++) {
      setPixel(pixels, width, x, y, [15, 15, 15, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "pick",
    backgroundSamples: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  });

  assert.equal(result.segmentation.method, "picked-plane");
  assert.equal(at(result.mask, width, 3, 3), 0);
  assert.equal(at(result.mask, width, 25, 22), 1);
});

test("distributed trusted samples fit a radial gray vignette and preserve red artwork", () => {
  const width = 72;
  const height = 72;
  const pixels = spatialRGBA(width, height, (x, y) => {
    const nx = x / (width - 1);
    const ny = y / (height - 1);
    const dx = nx - 0.5;
    const dy = ny - 0.5;
    const gray = Math.round(220 - 150 * (dx * dx + dy * dy));
    return [gray, gray, gray];
  });
  for (let y = 27; y <= 44; y++) {
    for (let x = 24; x <= 47; x++) {
      setPixel(pixels, width, x, y, [220, 25, 30, 255]);
    }
  }
  const backgroundSamples = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
    { x: 0.5, y: 1 },
    { x: 1, y: 1 },
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
  ];

  const result = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "pick",
    backgroundSamples,
  });

  assert.equal(result.segmentation.status, "confident");
  assert.equal(result.segmentation.method, "picked-quadratic");
  assert.equal(at(result.mask, width, 35, 35), 1, "red logo");
  assert.equal(at(result.mask, width, 8, 8), 0, "dark background");
  assert.equal(at(result.mask, width, 35, 8), 0, "bright background");
  assert.equal(countMask(result.mask), 24 * 18);
});

test("trusted spatial background keeps contrasting artwork touching the border", () => {
  const width = 48;
  const height = 48;
  const pixels = spatialRGBA(width, height, (_x, y) => {
    const gray = Math.round(225 - (y / (height - 1)) * 90);
    return [gray, gray, gray];
  });
  for (let y = 28; y < height; y++) {
    for (let x = 22; x <= 25; x++) {
      setPixel(pixels, width, x, y, [20, 120, 45, 255]);
    }
  }

  const result = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "pick",
    backgroundSamples: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  });

  assert.equal(at(result.mask, width, 23, 47), 1);
  assert.equal(at(result.mask, width, 4, 47), 0);
});

test("Pick background tolerance conservatively expands accepted background distance", () => {
  const width = 24;
  const height = 20;
  const pixels = rgba(width, height, [205, 205, 205, 255]);
  for (let y = 0; y < height; y++) {
    setPixel(pixels, width, 1, y, [185, 185, 185, 255]);
  }
  for (let y = 6; y <= 13; y++) {
    for (let x = 9; x <= 14; x++) {
      setPixel(pixels, width, x, y, [25, 25, 25, 255]);
    }
  }

  const conservative = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "pick",
    backgroundSamples: [{ x: 0, y: 0 }],
    backgroundTolerance: 0.5,
  });
  const permissive = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "pick",
    backgroundSamples: [{ x: 0, y: 0 }],
    backgroundTolerance: 1.5,
  });

  assert.equal(at(conservative.mask, width, 1, 2), 1);
  assert.equal(at(permissive.mask, width, 1, 2), 0);
  assert.equal(at(conservative.mask, width, 11, 9), 1);
  assert.equal(at(permissive.mask, width, 11, 9), 1);
});

test("poorly distributed trusted samples request more background samples", () => {
  const width = 40;
  const height = 40;
  const pixels = spatialRGBA(width, height, (_x, y) => {
    const gray = Math.round(220 - (y / (height - 1)) * 100);
    return [gray, gray, gray];
  });

  const result = createPNGTraceMask(pixels, width, height, {
    backgroundMode: "pick",
    backgroundSamples: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.5 },
      { x: 0.1, y: 0.9 },
    ],
  });

  assert.equal(result.segmentation.status, "needs-review");
  assert.equal(result.segmentation.method, "pick-fallback");
  assert.match(result.segmentation.message, /more background samples/i);
  assert.equal(result.issues[0].level, "info");
});

test("Pick background asks for a sample without creating a geometry error", () => {
  const result = createPNGTraceMask(
    rgba(12, 12, [230, 230, 230, 255]),
    12,
    12,
    { backgroundMode: "pick", backgroundSamples: [] },
  );

  assert.equal(result.segmentation.status, "needs-review");
  assert.match(result.segmentation.message, /at least one trusted/i);
  assert.deepEqual(result.issues.map(({ level }) => level), ["info"]);
});

test("transparent PNG handling is unchanged in Pick background mode", () => {
  const pixels = rgba(6, 6, [255, 255, 255, 0]);
  setPixel(pixels, 6, 3, 3, [20, 20, 20, 255]);

  const result = createPNGTraceMask(pixels, 6, 6, {
    backgroundMode: "pick",
    backgroundSamples: [{ x: 0, y: 0 }],
    backgroundTolerance: 1.5,
  });

  assert.equal(result.segmentation.method, "alpha");
  assert.equal(at(result.mask, 6, 3, 3), 1);
  assert.equal(at(result.mask, 6, 0, 0), 0);
});
