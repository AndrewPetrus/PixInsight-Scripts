/*
 * Regression test for DiffractionSpikes.js, runnable without PixInsight:
 *
 *    node tests/rasterization-test.js
 *
 * Loads the script with minimal PJSR stubs and checks that
 *   1. the energy of a rendered ray does not depend on its angle,
 *   2. the per-pixel peak matches the requested peak intensity,
 *   3. invalid parameters are rejected by validateParams().
 */
"use strict";
const fs = require("fs");
const path = require("path");

function loadScript() {
  const file = path.join(__dirname, "..", "DiffractionSpikes.js");
  let src = fs.readFileSync(file, "utf8")
    .split("\n").filter(l => !/^\s*#/.test(l)).join("\n")   // preprocessor
    .replace(/^ +.*\\$/gm, "").replace(/^ +Written by.*$/m, "") // #feature-info continuation
    .replace(/^try \{\s*main\(\);[\s\S]*$/m, "");                // do not run main()
  const sandbox = {};
  global.CoreApplication = { ensureMinimumVersion() {} };
  global.Dialog = class {};
  new Function("sandbox", src +
    "\nsandbox.drawRay = drawRay; sandbox.PARAMS = PARAMS;" +
    "\nsandbox.DEFAULT_PARAMS = DEFAULT_PARAMS; sandbox.validateParams = validateParams;")(sandbox);
  return sandbox;
}

function mockImage(W, H) {
  const d = new Float64Array(W * H);
  return { numberOfChannels: 1, data: d,
           sample: (x, y) => d[y * W + x], setSample: (v, x, y) => { d[y * W + x] = v; } };
}

function renderRay(S, angleDeg, sigma, peak) {
  Object.assign(S.PARAMS, { widthTaper: 1, chromaticAmount: 0, chromaticWaveAmt: 0,
                            colorAmount: 0, falloffExp: 2.5 });
  const W = 200, H = 200, cx = 100, cy = 100, len = 60, img = mockImage(W, H);
  const a = angleDeg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
  S.drawRay(img, W, H, cx, cy, dx, dy, len, peak, [1], sigma);
  let total = 0, max = 0;
  for (const v of img.data) { total += v; if (v > max) max = v; }
  return { total, max };
}

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) failures++;
}

const S = loadScript();
const ANGLES = [0, 10, 22.5, 30, 45, 60, 77, 90, 135];

for (const sigma of [0.75, 1.5, 3]) {
  const totals = ANGLES.map(a => renderRay(S, a, sigma, 0.001).total);
  const lo = Math.min(...totals), hi = Math.max(...totals);
  const spread = (hi - lo) / lo;
  check(`ray energy independent of angle (σ=${sigma})`, spread < 0.03,
        `spread ${(spread * 100).toFixed(2)}%`);
}

{
  const r = renderRay(S, 0, 1.5, 0.001);
  check("per-pixel peak equals requested peak", Math.abs(r.max - 0.001) < 1e-9,
        `max ${r.max}`);
}

const bad = {
  "infinite width":   { spikeWidth: Infinity },
  "negative width":   { spikeWidth: -1 },
  "NaN taper":        { widthTaper: NaN },
  "min > max length": { minLength: 200, maxLength: 100 },
  "zero chrom scale": { chromScale: [1, 0, 0.8] },
  "fractional rays":  { numRays: 4.5 }
};
check("defaults are valid", S.validateParams(S.DEFAULT_PARAMS) === null);
for (const [name, patch] of Object.entries(bad)) {
  const p = Object.assign(JSON.parse(JSON.stringify(S.DEFAULT_PARAMS)), patch);
  const msg = S.validateParams(p);
  check(`rejects ${name}`, typeof msg === "string", msg || "");
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
