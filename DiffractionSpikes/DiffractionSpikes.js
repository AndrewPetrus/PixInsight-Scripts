#engine v8

#feature-id    Utilities > DiffractionSpikes

#feature-info  Adds synthetic diffraction spikes to stars in refractor images.<br/>\
               <br/>\
               Simulates realistic 4- or 8-point diffraction patterns with chromatic \
               aberration gradient (R extends furthest, B shortest), sinusoidal color \
               banding, triangular spike profile, radial glow, and optional secondary \
               spikes. Uses the native StarDetector for star finding.<br/>\
               <br/>\
               Requires PixInsight 1.9.4 or later (V8 runtime).<br/>\
               <br/>\
               Written by Andrii Petrus

CoreApplication.ensureMinimumVersion(1, 9, 4);

// ─── Parameters ───────────────────────────────────────────────────────────────

var PARAMS = {
   // Spike shape
   numRays:         4,
   angleOffset:     0,
   maxLength:       120,
   minLength:       15,
   spikeWidth:      1.5,
   widthTaper:      0.05,
   falloffExp:      2.5,
   fluxPower:       1.0,

   // Blending
   // intensity = per-pixel peak of the brightest star's spike (0–1).
   // Settings v1 used an overlapping rasterizer that summed ≈ 2·ceil(3σ)+1
   // samples per pixel; 0.33 here matches the old default 0.03 at σ = 1.5.
   intensity:       0.33,
   colorAmount:     0.25,

   // Chromatic model: gradient envelope + oscillating waves
   chromaticAmount: 0.15,
   chromScale:      [1.0, 0.92, 0.80],
   chromaticWaves:  3,
   chromaticWaveAmt: 0.25,

   // Primary glow
   glowRadius:      8,
   glowIntensity:   0.25,

   // Outer diffuse glow
   outerGlowRadius:    24,
   outerGlowIntensity: 0.10,

   // Secondary spikes
   secondaryEnabled:   true,
   secondaryAngle:     45,
   secondaryLength:    0.42,
   secondaryIntensity: 0.14,   // ≈ old 0.22 after per-width gain correction
   secondaryWidth:     0.75,

   // Star detection
   maxStars:         0,     // 0 = no limit
   minFluxFraction:  0.01,  // ignore stars below this fraction of the brightest star's flux
   sdSensitivity:    0.5,   // StarDetector sensitivity (0–1, higher = more stars detected)

   settingsVersion:  2      // 1 = overlapping rasterizer (pre-2026-11), 2 = exact
};

var DEFAULT_PARAMS = JSON.parse(JSON.stringify(PARAMS));

var ERROR_ICON = (typeof StdIcon !== "undefined" && typeof StdIcon.Error !== "undefined")
               ? StdIcon.Error
               : ((typeof StdIcon_Error !== "undefined") ? StdIcon_Error : 4);

// Secondary spikes dimmer than this per-pixel peak are not drawn.
var SECONDARY_MIN_PEAK = 0.05;

function errText(e) {
   if (e === undefined || e === null) return "unknown error";
   if (typeof e === "string") return e;
   if (e.message) return String(e.message);
   return String(e);
}

// ─── Parameter validation ─────────────────────────────────────────────────────
// [key, label, min, max, integer]
var PARAM_RULES = [
   ["numRays",            "Number of rays",        2,     16,    true ],
   ["angleOffset",        "Angle offset",          -360,  360,   false],
   ["maxLength",          "Max length",            1,     5000,  false],
   ["minLength",          "Min length",            0,     5000,  false],
   ["spikeWidth",         "Spike width σ",         0.1,   50,    false],
   ["widthTaper",         "Width taper",           0,     1,     false],
   ["falloffExp",         "Falloff exponent",      0.1,   20,    false],
   ["fluxPower",          "Flux power",            0,     10,    false],
   ["intensity",          "Intensity",             0,     1,     false],
   ["colorAmount",        "Star colour tint",      0,     1,     false],
   ["chromaticAmount",    "Chromatic amount",      0,     1,     false],
   ["chromaticWaveAmt",   "Wave modulation",       0,     1,     false],
   ["chromaticWaves",     "Wave cycles",           1,     10,    true ],
   ["glowRadius",         "Core glow radius",      0,     500,   false],
   ["glowIntensity",      "Core glow intensity",   0,     1,     false],
   ["outerGlowRadius",    "Outer glow radius",     0,     500,   false],
   ["outerGlowIntensity", "Outer glow intensity",  0,     1,     false],
   ["secondaryAngle",     "Secondary angle offset",-360,  360,   false],
   ["secondaryLength",    "Length fraction",       0,     1,     false],
   ["secondaryIntensity", "Intensity fraction",    0,     1,     false],
   ["secondaryWidth",     "Secondary width σ",     0.1,   50,    false],
   ["maxStars",           "Max stars",             0,     100000, true],
   ["minFluxFraction",    "Min flux fraction",     0,     1,     false],
   ["sdSensitivity",      "SD sensitivity",        0,     1,     false]
];

// Returns null when p is valid, otherwise a message naming the offending field.
function validateParams(p) {
   for (var i = 0; i < PARAM_RULES.length; i++) {
      var r = PARAM_RULES[i], v = p[r[0]];
      if (typeof v !== "number" || !Number.isFinite(v))
         return r[1] + ": must be a finite number.";
      if (v < r[2] || v > r[3])
         return r[1] + ": must be between " + r[2] + " and " + r[3] + " (got " + v + ").";
      if (r[4] && Math.floor(v) !== v)
         return r[1] + ": must be an integer.";
   }
   if (p.minLength > p.maxLength)
      return "Min length (" + p.minLength + ") must not exceed Max length (" + p.maxLength + ").";
   if (!Array.isArray(p.chromScale) || p.chromScale.length !== 3)
      return "Scale R/G/B: three values are required.";
   var names = ["Scale R", "Scale G", "Scale B"];
   for (var c = 0; c < 3; c++) {
      var v = p.chromScale[c];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 2)
         return names[c] + ": must be in (0, 2] (got " + v + ").";
   }
   if (typeof p.secondaryEnabled !== "boolean")
      return "Enable secondary spikes: invalid value.";
   return null;
}

// Peak gain of the v1 rasterizer for a horizontal ray of base width σ.
function legacyGain(sigma) { return 2 * Math.ceil(3 * sigma) + 1; }

// ─── Settings persistence ─────────────────────────────────────────────────────
// Stores entire PARAMS as a single JSON string via PixInsight's Settings API.
// One string key means no DataType_Int32/Double/Boolean constants needed —
// only DataType_String (or its V8 equivalent, discovered at runtime).

var SETTINGS_KEY = "DiffractionSpikes/params";

// Resolve the string DataType constant across SM and V8 naming schemes.
var _DT_STRING = (function() {
   if (typeof DataType_String  !== "undefined") return DataType_String;
   if (typeof DataType         !== "undefined" &&
       typeof DataType.String  !== "undefined") return DataType.String;
   return 0; // numeric fallback (value in all known PJSR versions)
})();

function saveSettings() {
   try {
      Settings.write(SETTINGS_KEY, _DT_STRING, JSON.stringify(PARAMS));
   } catch(e) {
      console.warningln("DiffractionSpikes: could not save settings: " + e.message);
   }
}

function loadSettings() {
   try {
      var json = Settings.read(SETTINGS_KEY, _DT_STRING);
      if (!json) return;
      var saved = JSON.parse(json);
      var candidate = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
      // Only restore keys that already exist in PARAMS (safe when new params are added)
      for (var key in candidate) {
         if (key !== "settingsVersion" && saved.hasOwnProperty(key) &&
             saved[key] !== null && saved[key] !== undefined)
            candidate[key] = saved[key];
      }
      // v1 intensities were inflated by the overlapping rasterizer: convert
      // them so that saved settings keep their look.
      if (!saved.settingsVersion || saved.settingsVersion < 2) {
         var g  = legacyGain(candidate.spikeWidth);
         var gs = legacyGain(candidate.secondaryWidth);
         candidate.intensity          = Math.min(1, candidate.intensity * g);
         candidate.secondaryIntensity = Math.min(1, candidate.secondaryIntensity * gs / g);
         console.writeln("DiffractionSpikes: migrated saved settings to v2 " +
                         "(intensity ×" + g + ").");
      }
      var problem = validateParams(candidate);
      if (problem) {
         console.warningln("DiffractionSpikes: saved settings are invalid (" + problem +
                           "), using defaults.");
         return;
      }
      for (var key in candidate)
         PARAMS[key] = candidate[key];
   } catch(e) {
      console.writeln("DiffractionSpikes: no saved settings, using defaults (" + e.message + ").");
   }
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

var DiffractionDialog = class extends Dialog {
   constructor() {
      super();
      var self = this;
      this.windowTitle = "Diffraction Spikes";

      var LW = 165;  // label column width

      // ── Widget factories ───────────────────────────────────────────────────

      // Label + SpinBox row (integers)
      function spinRow(txt, val, mn, mx) {
         var lbl  = new Label(self);  lbl.text = txt;  lbl.setFixedWidth(LW);
         var spin = new SpinBox(self);
         spin.minimum = mn;  spin.maximum = mx;  spin.value = val;
         spin.setFixedWidth(62);
         var s = new Sizer(false);  s.spacing = 4;
         s.add(lbl);  s.add(spin);  s.addStretch();
         return { sizer: s, spin: spin };
      }

      // Label + Edit row (floats — any range)
      function editRow(txt, val, dec) {
         var lbl  = new Label(self);  lbl.text = txt;  lbl.setFixedWidth(LW);
         var edit = new Edit(self);
         edit.text = (dec > 0) ? val.toFixed(dec) : String(Math.round(val));
         edit.setFixedWidth(62);
         var s = new Sizer(false);  s.spacing = 4;
         s.add(lbl);  s.add(edit);  s.addStretch();
         return { sizer: s, edit: edit };
      }

      // Label + Slider + Edit row (floats 0–1)
      function sliderRow(txt, val) {
         var lbl    = new Label(self);  lbl.text = txt;  lbl.setFixedWidth(LW);
         var slider = new Slider(self);
         slider.minValue = 0;  slider.maxValue = 100;
         slider.value    = Math.round(val * 100);
         var edit = new Edit(self);
         edit.text = val.toFixed(2);  edit.setFixedWidth(42);
         slider.onValueUpdated = function(v) { edit.text = (v / 100).toFixed(2); };
         edit.onEditCompleted  = function() {
            var v = Math.max(0, Math.min(1, parseFloat(edit.text) || 0));
            slider.value = Math.round(v * 100);  edit.text = v.toFixed(2);
         };
         var s = new Sizer(false);  s.spacing = 4;
         s.add(lbl);  s.add(slider, 100);  s.add(edit);
         return { sizer: s, slider: slider, edit: edit,
                  value: function() { return this.slider.value / 100; } };
      }

      // CheckBox row
      function checkRow(txt, val) {
         var cb = new CheckBox(self);  cb.text = txt;  cb.checked = val;
         var s  = new Sizer(false);  s.add(cb);  s.addStretch();
         return { sizer: s, check: cb };
      }

      // GroupBox with vertical sizer
      function group(title, rows) {
         var gb = new GroupBox(self);
         gb.title = title;
         gb.sizer = new Sizer(true);
         gb.sizer.margin = 6;  gb.sizer.spacing = 3;
         for (var i = 0; i < rows.length; i++)
            gb.sizer.add(rows[i]);
         return gb;
      }

      // ── Spike Shape ────────────────────────────────────────────────────────
      var wNumRays  = spinRow("Number of rays:",     PARAMS.numRays,    2, 16);
      var wAngle    = editRow("Angle offset (°):",   PARAMS.angleOffset, 1);
      var wMaxLen   = editRow("Max length (px):",    PARAMS.maxLength,   0);
      var wMinLen   = editRow("Min length (px):",    PARAMS.minLength,   0);
      var wWidth    = editRow("Spike width σ (px):", PARAMS.spikeWidth,  2);
      var wTaper    = editRow("Width taper (0–1):",  PARAMS.widthTaper,  2);
      var wFalloff  = editRow("Falloff exponent:",   PARAMS.falloffExp,  1);
      var wFluxPow  = editRow("Flux power:",         PARAMS.fluxPower,   1);
      var gbShape = group("Spike Shape", [
         wNumRays.sizer, wAngle.sizer, wMaxLen.sizer, wMinLen.sizer,
         wWidth.sizer, wTaper.sizer, wFalloff.sizer, wFluxPow.sizer
      ]);

      // ── Blending ───────────────────────────────────────────────────────────
      var wIntensity = sliderRow("Intensity:",       PARAMS.intensity);
      var wColorAmt  = sliderRow("Star colour tint:", PARAMS.colorAmount);
      var gbBlend = group("Blending", [wIntensity.sizer, wColorAmt.sizer]);

      // ── Star Detection ─────────────────────────────────────────────────────
      var wMaxStars   = spinRow("Max stars (0=all):", PARAMS.maxStars, 0, 9999);
      var wMinFlux    = editRow("Min flux fraction:", PARAMS.minFluxFraction, 3);
      var wSdSens     = editRow("SD sensitivity:", PARAMS.sdSensitivity, 2);
      var gbDetect = group("Star Detection", [wMaxStars.sizer, wMinFlux.sizer, wSdSens.sizer]);

      // ── Chromatic Effect ───────────────────────────────────────────────────
      var wChromAmt  = sliderRow("Chromatic amount:", PARAMS.chromaticAmount);
      var wWaveAmt   = sliderRow("Wave modulation:",  PARAMS.chromaticWaveAmt);
      var wWaves     = spinRow("Wave cycles:",        PARAMS.chromaticWaves, 1, 10);
      var wChromR    = editRow("Scale R (1.0):",     PARAMS.chromScale[0], 2);
      var wChromG    = editRow("Scale G (<1):",      PARAMS.chromScale[1], 2);
      var wChromB    = editRow("Scale B (<1):",      PARAMS.chromScale[2], 2);
      var gbChrom = group("Chromatic Effect", [
         wChromAmt.sizer, wWaveAmt.sizer, wWaves.sizer,
         wChromR.sizer, wChromG.sizer, wChromB.sizer
      ]);

      // ── Glow ───────────────────────────────────────────────────────────────
      var wGlowR    = editRow("Core glow radius:",      PARAMS.glowRadius,       1);
      var wGlowI    = sliderRow("Core glow intensity:", PARAMS.glowIntensity);
      var wOuterR   = editRow("Outer glow radius:",     PARAMS.outerGlowRadius,  0);
      var wOuterI   = sliderRow("Outer glow intensity:", PARAMS.outerGlowIntensity);
      var gbGlow = group("Glow", [
         wGlowR.sizer, wGlowI.sizer, wOuterR.sizer, wOuterI.sizer
      ]);

      // ── Secondary Spikes ───────────────────────────────────────────────────
      var wSecOn  = checkRow("Enable secondary spikes", PARAMS.secondaryEnabled);
      var wSecAng = editRow("Angle offset (°):",  PARAMS.secondaryAngle,     0);
      var wSecLen = editRow("Length fraction:",   PARAMS.secondaryLength,    2);
      var wSecInt = editRow("Intensity fraction:", PARAMS.secondaryIntensity, 2);
      var wSecW   = editRow("Width σ:",           PARAMS.secondaryWidth,     2);
      var gbSec = group("Secondary Spikes", [
         wSecOn.sizer, wSecAng.sizer, wSecLen.sizer, wSecInt.sizer, wSecW.sizer
      ]);

      // ── Two-column layout ──────────────────────────────────────────────────
      var leftCol = new Sizer(true);
      leftCol.spacing = 6;
      leftCol.add(gbShape);
      leftCol.add(gbBlend);
      leftCol.add(gbDetect);
      leftCol.addStretch();

      var rightCol = new Sizer(true);
      rightCol.spacing = 6;
      rightCol.add(gbChrom);
      rightCol.add(gbGlow);
      rightCol.add(gbSec);
      rightCol.addStretch();

      var cols = new Sizer(false);
      cols.spacing = 8;
      cols.add(leftCol);
      cols.add(rightCol);

      // ── Buttons ────────────────────────────────────────────────────────────
      this.okBtn = new PushButton(this);
      this.okBtn.text = "Apply";
      this.okBtn.onClick = function() {
         // Strict number parsing: "12abc", "" or "Infinity" become invalid
         // values and are reported by validateParams() instead of being
         // silently replaced or accepted.
         function pf(edit) {
            var text = String(edit.text).trim();
            return text.length > 0 ? Number(text) : NaN;
         }
         var P = JSON.parse(JSON.stringify(PARAMS));

         P.numRays           = wNumRays.spin.value;
         P.angleOffset       = pf(wAngle.edit);
         P.maxLength         = pf(wMaxLen.edit);
         P.minLength         = pf(wMinLen.edit);
         P.spikeWidth        = pf(wWidth.edit);
         P.widthTaper        = pf(wTaper.edit);
         P.falloffExp        = pf(wFalloff.edit);
         P.fluxPower         = pf(wFluxPow.edit);
         P.intensity         = wIntensity.slider.value / 100;
         P.colorAmount       = wColorAmt.slider.value  / 100;
         P.chromaticAmount   = wChromAmt.slider.value  / 100;
         P.chromaticWaveAmt  = wWaveAmt.slider.value   / 100;
         P.chromaticWaves    = wWaves.spin.value;
         P.chromScale        = [
            pf(wChromR.edit),
            pf(wChromG.edit),
            pf(wChromB.edit)
         ];
         P.glowRadius        = pf(wGlowR.edit);
         P.glowIntensity     = wGlowI.slider.value  / 100;
         P.outerGlowRadius   = pf(wOuterR.edit);
         P.outerGlowIntensity = wOuterI.slider.value / 100;
         P.secondaryEnabled  = wSecOn.check.checked;
         P.secondaryAngle    = pf(wSecAng.edit);
         P.secondaryLength   = pf(wSecLen.edit);
         P.secondaryIntensity = pf(wSecInt.edit);
         P.secondaryWidth    = pf(wSecW.edit);
         P.maxStars          = wMaxStars.spin.value;
         P.minFluxFraction   = pf(wMinFlux.edit);
         P.sdSensitivity     = pf(wSdSens.edit);

         var problem = validateParams(P);
         if (problem) {
            new MessageBox(problem, "Diffraction Spikes", ERROR_ICON).execute();
            return;   // keep the dialog open
         }
         for (var key in P)
            PARAMS[key] = P[key];
         saveSettings();
         self.ok();
      };

      this.cancelBtn = new PushButton(this);
      this.cancelBtn.text = "Cancel";
      this.cancelBtn.onClick = function() { self.cancel(); };

      var btnRow = new Sizer(false);
      btnRow.spacing = 6;  btnRow.addStretch();
      btnRow.add(this.okBtn);  btnRow.add(this.cancelBtn);

      this.sizer = new Sizer(true);
      this.sizer.margin = 10;  this.sizer.spacing = 8;
      this.sizer.add(cols);
      this.sizer.add(btnRow);

      this.adjustToContents();
   }
};

// ─── Star Detection ───────────────────────────────────────────────────────────
// StarDetector is a native C++ core object in V8 — no #include required.

function findStars(image) {
   var sd = new StarDetector();
   sd.sensitivity = PARAMS.sdSensitivity;
   sd.maxStars    = 999999;

   var detected = sd.stars(image);
   console.writeln("  StarDetector raw output: " + detected.length + " stars.");

   // Normalise flux to [0, 1] and convert to internal format
   var maxFlux = 0;
   for (var i = 0; i < detected.length; i++)
      if (detected[i].flux > maxFlux) maxFlux = detected[i].flux;
   if (maxFlux === 0) maxFlux = 1;

   var stars = [];
   for (var i = 0; i < detected.length; i++)
      stars.push({ x: detected[i].pos.x, y: detected[i].pos.y,
                   flux: detected[i].flux / maxFlux });

   // Sort brightest first
   stars.sort(function(a, b) { return b.flux - a.flux; });

   // Drop stars below minFluxFraction of the brightest
   if (PARAMS.minFluxFraction > 0 && stars.length > 0) {
      var threshold = PARAMS.minFluxFraction; // stars[0].flux is always 1.0 after normalisation
      var cut = stars.length;
      for (var i = 0; i < stars.length; i++) {
         if (stars[i].flux < threshold) { cut = i; break; }
      }
      if (cut < stars.length) {
         console.writeln("  Flux filter: kept " + cut + ", dropped " + (stars.length - cut) +
                         " stars below " + (PARAMS.minFluxFraction * 100).toFixed(1) +
                         "% of brightest.");
         stars.length = cut;
      } else {
         console.writeln("  Flux filter: all " + stars.length + " stars passed.");
      }
   }

   // Cap count if maxStars > 0
   if (PARAMS.maxStars > 0 && stars.length > PARAMS.maxStars) {
      console.writeln("  maxStars cap: keeping top " + PARAMS.maxStars +
                      " of " + stars.length + ".");
      stars.length = PARAMS.maxStars;
   }

   return stars;
}

// ─── Star Colour Sampling ─────────────────────────────────────────────────────

function sampleStarColor(image, x, y) {
   var nc = image.numberOfChannels;
   var color = [], r = 2, maxC = 0;
   for (var c = 0; c < nc; c++) {
      var sum = 0, cnt = 0;
      for (var dy = -r; dy <= r; dy++) {
         for (var dx = -r; dx <= r; dx++) {
            var ix = x + dx, iy = y + dy;
            if (ix >= 0 && ix < image.width && iy >= 0 && iy < image.height) {
               sum += image.sample(ix, iy, c); cnt++;
            }
         }
      }
      color[c] = cnt > 0 ? sum / cnt : 1;
      if (color[c] > maxC) maxC = color[c];
   }
   for (var c = 0; c < nc; c++) color[c] = maxC > 0 ? color[c] / maxC : 1;
   return color;
}

// ─── Spike Rendering ──────────────────────────────────────────────────────────

/*
 * Chromatic aberration gradient model (physically motivated):
 * In a refractor, blue light focuses shorter → blue spike decays faster.
 * Each channel gets a different effective length → warm (reddish) tips.
 * chromScale = [R, G, B] relative length factors.
 *
 * Rasterization: every pixel inside the ray's bounding box is visited exactly
 * once. Its position is projected onto the ray to get the longitudinal (t) and
 * perpendicular (perp) coordinates, and the spike profile is evaluated a
 * single time. The energy of a ray therefore does not depend on its angle or
 * on the kernel size, and peakIntensity is the peak of the profile itself.
 * (The brightest *pixel* of a very thin ray still varies a little with angle:
 * that is ordinary sampling of a ~1–2 px wide line, not accumulation.)
 */
function drawRay(spikeImg, W, H, cx, cy, dx, dy, length, peakIntensity, starColor, width) {
   var baseW  = (width !== undefined) ? width : PARAMS.spikeWidth;
   var taper  = Math.max(0.05, Math.min(1.0, PARAMS.widthTaper));
   var reach  = 3 * baseW;               // max perpendicular extent (3σ at the base)
   var nc     = spikeImg.numberOfChannels;
   var cAmt   = PARAMS.chromaticAmount;
   var colAmt = PARAMS.colorAmount;
   var cs     = PARAMS.chromScale;
   var wAmt   = PARAMS.chromaticWaveAmt;
   var nW     = PARAMS.chromaticWaves;
   var fExp   = PARAMS.falloffExp;
   var TAU    = 2 * Math.PI;
   var wPhase = [0, TAU / 3, 2 * TAU / 3];

   if (!(length > 0) || !(peakIntensity > 0)) return;

   // Per-channel constants: effective length (R longest, B shortest) and tint.
   var effLen = [], tint = [];
   for (var c = 0; c < nc; c++) {
      var scale = (nc >= 3 && c < cs.length) ? (1 - cAmt + cAmt * cs[c]) : 1.0;
      effLen[c] = length * scale;
      tint[c]   = (1 - colAmt) + colAmt * starColor[c];
   }

   // Bounding box of the segment [star, star + length·d], widened by the reach.
   var ex = cx + length * dx, ey = cy + length * dy;
   var x0 = Math.max(0,     Math.floor(Math.min(cx, ex) - reach));
   var x1 = Math.min(W - 1, Math.ceil (Math.max(cx, ex) + reach));
   var y0 = Math.max(0,     Math.floor(Math.min(cy, ey) - reach));
   var y1 = Math.min(H - 1, Math.ceil (Math.max(cy, ey) + reach));
   var nx = -dy, ny = dx;                // unit normal to the ray

   for (var iy = y0; iy <= y1; iy++) {
      for (var ix = x0; ix <= x1; ix++) {
         var rx = ix - cx, ry = iy - cy;
         var t  = rx * dx + ry * dy;     // along the ray
         if (t < 0 || t > length) continue;
         var perp = rx * nx + ry * ny;   // across the ray
         // Width tapers linearly: wide at base (near star), narrow at tip
         var sigma = baseW * (taper + (1 - taper) * (1 - t / length));
         if (Math.abs(perp) > 3 * sigma) continue;
         var gauss = Math.exp(-(perp * perp) / (2 * sigma * sigma));

         for (var c = 0; c < nc; c++) {
            // Per-channel intensity = gradient envelope × sinusoidal wave
            // Wave: 120° phase offset between R/G/B → color rings along spike
            var falloff = Math.exp(-Math.pow(t / effLen[c], fExp) * 5);
            var wave    = 0.5 + 0.5 * Math.sin(nW * TAU * t / length + (wPhase[c] || 0));
            var add     = peakIntensity * falloff * ((1 - wAmt) + wAmt * wave) * gauss * tint[c];
            if (add < 1e-7) continue;
            spikeImg.setSample(Math.min(1.0, spikeImg.sample(ix, iy, c) + add), ix, iy, c);
         }
      }
   }
}

// Radial glow: soft gaussian halo. radius and intensity passed explicitly.
function drawGlow(spikeImg, W, H, cx, cy, normFlux, starColor, glowRadius, glowIntensity) {
   var sigma  = glowRadius * Math.sqrt(normFlux);
   if (sigma < 0.5) return;
   var kR     = Math.ceil(sigma * 3);
   var nc     = spikeImg.numberOfChannels;
   var colAmt = PARAMS.colorAmount;
   var intens = glowIntensity * normFlux;

   for (var kx = -kR; kx <= kR; kx++) {
      for (var ky = -kR; ky <= kR; ky++) {
         var gauss = Math.exp(-(kx*kx + ky*ky) / (2 * sigma * sigma));
         var ix = Math.round(cx + kx);
         var iy = Math.round(cy + ky);
         if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;
         for (var c = 0; c < nc; c++) {
            var colTint = (1 - colAmt) + colAmt * starColor[c];
            var add     = intens * gauss * colTint;
            spikeImg.setSample(Math.min(1.0, spikeImg.sample(ix, iy, c) + add), ix, iy, c);
         }
      }
   }
}

function addStarSpikes(spikeImg, W, H, star, normFlux, image) {
   var starColor     = sampleStarColor(image, star.x, star.y);
   var length        = PARAMS.minLength + (PARAMS.maxLength - PARAMS.minLength) * Math.pow(normFlux, PARAMS.fluxPower);
   var peakIntensity = PARAMS.intensity * normFlux;
   // Tight core glow
   drawGlow(spikeImg, W, H, star.x, star.y, normFlux, starColor,
            PARAMS.glowRadius, PARAMS.glowIntensity);
   // Outer diffuse glow
   drawGlow(spikeImg, W, H, star.x, star.y, normFlux, starColor,
            PARAMS.outerGlowRadius, PARAMS.outerGlowIntensity);

   // Primary spikes
   for (var n = 0; n < PARAMS.numRays; n++) {
      var angle = (PARAMS.angleOffset + n * (360.0 / PARAMS.numRays)) * Math.PI / 180.0;
      drawRay(spikeImg, W, H, star.x, star.y,
              Math.cos(angle), Math.sin(angle), length, peakIntensity, starColor);
   }

   // Secondary spikes — rotated, shorter, dimmer
   if (PARAMS.secondaryEnabled) {
      var secLen   = length * PARAMS.secondaryLength;
      var secPeak  = peakIntensity * PARAMS.secondaryIntensity;
      if (secLen > 4 && secPeak > SECONDARY_MIN_PEAK) {
         for (var n = 0; n < PARAMS.numRays; n++) {
            var angle = (PARAMS.angleOffset + PARAMS.secondaryAngle +
                         n * (360.0 / PARAMS.numRays)) * Math.PI / 180.0;
            drawRay(spikeImg, W, H, star.x, star.y,
                    Math.cos(angle), Math.sin(angle),
                    secLen, secPeak, starColor, PARAMS.secondaryWidth);
         }
      }
   }
}

// ─── Blending ─────────────────────────────────────────────────────────────────

// Progressive blend: near star (s → 1) = additive, tips (s → 0) = screen.
// mix(screen, add, s) — bright spike pixels land additively, dim ones integrate softly.
function screenBlend(targetImg, spikeImg, W, H) {
   var nc = targetImg.numberOfChannels;
   for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
         for (var c = 0; c < nc; c++) {
            var o = targetImg.sample(x, y, c);
            var s = spikeImg.sample(x, y, c);
            if (s < 1e-6) continue;
            var screen = 1.0 - (1.0 - o) * (1.0 - s);   // soft integration
            var add    = Math.min(1.0, o + s);            // bright near star
            targetImg.setSample(screen * (1.0 - s) + add * s, x, y, c);
         }
      }
   }
}

// ─── Console logging ──────────────────────────────────────────────────────────

function logParams() {
   var hr = "────────────────────────────────────────";
   console.writeln(hr);
   console.writeln("DiffractionSpikes — active parameters:");
   console.writeln("  Spike Shape:");
   console.writeln("    numRays      = " + PARAMS.numRays);
   console.writeln("    angleOffset  = " + PARAMS.angleOffset + "°");
   console.writeln("    maxLength    = " + PARAMS.maxLength + " px");
   console.writeln("    minLength    = " + PARAMS.minLength + " px");
   console.writeln("    spikeWidth   = " + PARAMS.spikeWidth + " (base σ)");
   console.writeln("    widthTaper   = " + PARAMS.widthTaper + "  (tip/base ratio)");
   console.writeln("    falloffExp   = " + PARAMS.falloffExp);
   console.writeln("    fluxPower    = " + PARAMS.fluxPower);
   console.writeln("  Blending:");
   console.writeln("    intensity    = " + PARAMS.intensity);
   console.writeln("    colorAmount  = " + PARAMS.colorAmount);
   console.writeln("  Chromatic:");
   console.writeln("    amount       = " + PARAMS.chromaticAmount);
   console.writeln("    waves        = " + PARAMS.chromaticWaves);
   console.writeln("    waveAmt      = " + PARAMS.chromaticWaveAmt);
   console.writeln("    chromScale   = [" + PARAMS.chromScale.join(", ") + "]");
   console.writeln("  Glow:");
   console.writeln("    core r/i     = " + PARAMS.glowRadius + " / " + PARAMS.glowIntensity);
   console.writeln("    outer r/i    = " + PARAMS.outerGlowRadius + " / " + PARAMS.outerGlowIntensity);
   console.writeln("  Secondary spikes:");
   console.writeln("    enabled      = " + PARAMS.secondaryEnabled);
   if (PARAMS.secondaryEnabled) {
      console.writeln("    angle        = " + PARAMS.secondaryAngle + "°");
      console.writeln("    length frac  = " + PARAMS.secondaryLength);
      console.writeln("    intens frac  = " + PARAMS.secondaryIntensity);
      console.writeln("    width σ      = " + PARAMS.secondaryWidth);
   }
   console.writeln("  Star Detection:");
   console.writeln("    maxStars     = " + (PARAMS.maxStars > 0 ? PARAMS.maxStars : "unlimited"));
   console.writeln("    minFluxFrac  = " + PARAMS.minFluxFraction +
                   "  (≥" + (PARAMS.minFluxFraction * 100).toFixed(1) + "% of brightest)");
   console.writeln("    sdSensitivity= " + PARAMS.sdSensitivity);
   console.writeln(hr);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
   var win = ImageWindow.activeWindow;
   if (win.isNull) {
      console.criticalln("DiffractionSpikes: no active image window.");
      return;
   }

   loadSettings();

   var dlg = new DiffractionDialog();
   if (dlg.execute() !== 1) return;
   // All PARAMS already updated by the Apply button handler
   logParams();

   var view  = win.mainView;
   var image = view.image;
   var W = image.width, H = image.height;

   console.writeln("DiffractionSpikes: detecting stars…");
   var stars = findStars(image);
   if (stars.length === 0) {
      console.criticalln("DiffractionSpikes: no stars detected.");
      return;
   }
   console.writeln("  " + stars.length + " stars" +
      (PARAMS.maxStars > 0 ? " (capped at " + PARAMS.maxStars + ")" : "") + ".");

   console.writeln("  Generating spikes…");
   // PixelSampleType.Real = 32-bit float (V8 constant, replaces old SampleType_Real)
   var spikeImg = new Image(W, H, image.numberOfChannels, image.colorSpace, 32, 1 /*PixelSampleType.Real*/);
   try {
      spikeImg.fill(0);

      for (var s = 0; s < stars.length; s++)
         addStarSpikes(spikeImg, W, H, stars[s], stars[s].flux, image);

      console.writeln("  Blending…");
      view.beginProcess();
      try {
         screenBlend(image, spikeImg, W, H);
      } finally {
         view.endProcess();
      }
   } finally {
      spikeImg.free();
   }
   console.writeln("DiffractionSpikes: done.");
}

try {
   main();
} catch (e) {
   console.criticalln("DiffractionSpikes: " + errText(e));
}
