import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAMP, fitToFace } from "../src/pipeline/stamp.js";
import { thinFeatureIssues } from "../src/pipeline/validate.js";

const artwork = [[[
  [-10, -0.5],
  [10, -0.5],
  [10, 0.5],
  [-10, 0.5],
]]];

const fit = (faceSize) =>
  fitToFace(
    artwork,
    {
      ...DEFAULT_STAMP,
      faceShape: "square",
      autoFaceSize: false,
      faceSize,
      margin: 1,
    },
    [],
  ).art;

test("artwork that becomes too thin only after fitting is warned", () => {
  assert.deepEqual(thinFeatureIssues(artwork), []);

  const issues = thinFeatureIssues(fit(10));
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /thinner than about 0\.8 mm/i);
});

test("artwork that remains above the threshold after fitting is not warned", () => {
  assert.deepEqual(thinFeatureIssues(fit(12)), []);
});

test("artwork requiring no fitting stays unchanged", () => {
  const fitted = fit(24);

  assert.deepEqual(fitted, artwork);
  assert.deepEqual(thinFeatureIssues(fitted), []);
});
