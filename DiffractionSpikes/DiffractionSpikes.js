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
   intensity:       0.03,
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
   secondaryIntensity: 0.22,
   secondaryWidth:     0.75,

   // Star detection
   maxStars:         0,     // 0 = no limit
   minFluxFraction:  0.01,  // ignore stars below this fraction of the brightest star's flux
   sdSensitivity:    0.5    // StarDetector sensitivity (0–1, higher = more stars detected)
};

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
         function pf(edit, def) { var v = parseFloat(edit.text); return isNaN(v) ? def : v; }

         PARAMS.numRays           = wNumRays.spin.value;
         PARAMS.angleOffset       = pf(wAngle.edit,   PARAMS.angleOffset);
         PARAMS.maxLength         = pf(wMaxLen.edit,  PARAMS.maxLength);
         PARAMS.minLength         = pf(wMinLen.edit,  PARAMS.minLength);
         PARAMS.spikeWidth        = pf(wWidth.edit,   PARAMS.spikeWidth);
         PARAMS.widthTaper        = pf(wTaper.edit,   PARAMS.widthTaper);
         PARAMS.falloffExp        = pf(wFalloff.edit, PARAMS.falloffExp);
         PARAMS.fluxPower         = pf(wFluxPow.edit, PARAMS.fluxPower);
         PARAMS.intensity         = wIntensity.slider.value / 100;
         PARAMS.colorAmount       = wColorAmt.slider.value  / 100;
         PARAMS.chromaticAmount   = wChromAmt.slider.value  / 100;
         PARAMS.chromaticWaveAmt  = wWaveAmt.slider.value   / 100;
         PARAMS.chromaticWaves    = wWaves.spin.value;
         PARAMS.chromScale        = [
            pf(wChromR.edit, PARAMS.chromScale[0]),
            pf(wChromG.edit, PARAMS.chromScale[1]),
            pf(wChromB.edit, PARAMS.chromScale[2])
         ];
         PARAMS.glowRadius        = pf(wGlowR.edit,  PARAMS.glowRadius);
         PARAMS.glowIntensity     = wGlowI.slider.value  / 100;
         PARAMS.outerGlowRadius   = pf(wOuterR.edit, PARAMS.outerGlowRadius);
         PARAMS.outerGlowIntensity = wOuterI.slider.value / 100;
         PARAMS.secondaryEnabled  = wSecOn.check.checked;
         PARAMS.secondaryAngle    = pf(wSecAng.edit, PARAMS.secondaryAngle);
         PARAMS.secondaryLength   = pf(wSecLen.edit, PARAMS.secondaryLength);
         PARAMS.secondaryIntensity = pf(wSecInt.edit, PARAMS.secondaryIntensity);
         PARAMS.secondaryWidth    = pf(wSecW.edit,   PARAMS.secondaryWidth);
         PARAMS.maxStars          = wMaxStars.spin.value;
         PARAMS.minFluxFraction   = pf(wMinFlux.edit,  PARAMS.minFluxFraction);
         PARAMS.sdSensitivity     = pf(wSdSens.edit,   PARAMS.sdSensitivity);

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
 */
function drawRay(spikeImg, W, H, cx, cy, dx, dy, length, peakIntensity, starColor, width) {
   var baseW  = (width !== undefined) ? width : PARAMS.spikeWidth;
   var taper  = Math.max(0.05, Math.min(1.0, PARAMS.widthTaper));
   var kR     = Math.ceil(baseW * 3); // kernel based on max (base) width
   var nc     = spikeImg.numberOfChannels;
   var cAmt   = PARAMS.chromaticAmount;
   var colAmt = PARAMS.colorAmount;
   var cs     = PARAMS.chromScale;

   for (var t = 1; t <= length; t++) {
      var px = cx + t * dx;
      var py = cy + t * dy;
      // Width tapers linearly: wide at base (near star), narrow at tip
      var sigma = baseW * (taper + (1 - taper) * (1 - t / length));

      // Per-channel intensity = gradient envelope × sinusoidal wave
      // Envelope: R longest, B shortest (refractor aberration)
      // Wave: 120° phase offset between R/G/B → color rings along spike
      var chanI = [];
      var anyVisible = false;
      var wAmt  = PARAMS.chromaticWaveAmt;
      var nW    = PARAMS.chromaticWaves;
      var TAU   = 2 * Math.PI;
      var wPhase = [0, TAU / 3, 2 * TAU / 3];
      for (var c = 0; c < nc; c++) {
         var scale   = (nc >= 3 && c < cs.length) ? (1 - cAmt + cAmt * cs[c]) : 1.0;
         var effLen  = length * scale;
         var falloff = Math.exp(-Math.pow(t / effLen, PARAMS.falloffExp) * 5);
         var wave    = 0.5 + 0.5 * Math.sin(nW * TAU * t / length + (wPhase[c] || 0));
         chanI[c]    = peakIntensity * falloff * ((1 - wAmt) + wAmt * wave);
         if (chanI[c] > 1e-6) anyVisible = true;
      }
      if (!anyVisible) break;

      for (var kx = -kR; kx <= kR; kx++) {
         for (var ky = -kR; ky <= kR; ky++) {
            var perp  = kx * (-dy) + ky * dx;
            var gauss = Math.exp(-(perp * perp) / (2 * sigma * sigma));
            var ix    = Math.round(px + kx);
            var iy    = Math.round(py + ky);
            if (ix < 0 || ix >= W || iy < 0 || iy >= H) continue;

            for (var c = 0; c < nc; c++) {
               if (chanI[c] < 1e-6) continue;
               var colTint = (1 - colAmt) + colAmt * starColor[c];
               var add     = chanI[c] * gauss * colTint;
               spikeImg.setSample(Math.min(1.0, spikeImg.sample(ix, iy, c) + add), ix, iy, c);
            }
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
      if (secLen > 4 && secPeak > 0.005) {
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
   spikeImg.fill(0);

   for (var s = 0; s < stars.length; s++)
      addStarSpikes(spikeImg, W, H, stars[s], stars[s].flux, image);

   console.writeln("  Blending…");
   view.beginProcess();
   screenBlend(image, spikeImg, W, H);
   view.endProcess();

   spikeImg.free();
   console.writeln("DiffractionSpikes: done.");
}

main();
