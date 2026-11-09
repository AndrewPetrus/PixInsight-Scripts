#engine v8

#feature-id    SimpleHighFrequencyDenoiser : Noise Reduction > Simple High Frequency Denoiser
#feature-info  Simple High Frequency Denoiser: luminance-masked Gaussian denoise.<br/>\
               <br/>\
               1. Builds a luminance mask from the target image.<br/>\
               2. Blurs a copy of the image with a Gaussian convolution.<br/>\
               3. Blends: result = mask * original + (1 - mask) * blurred.<br/>\
               <br/>\
               Bright areas (mask -> 1) keep the original pixels,<br/>\
               dark/background areas (mask -> 0) take the blurred ones.<br/>\
               <br/>\
               Written by Andrii Petrus

/*
 * SimpleHighFrequencyDenoiser.js
 *
 * Run with Script > Execute Script File. The result is applied to the selected
 * main view as a single PixelMath step, so it can be undone with Ctrl/Cmd+Z.
 *
 * Supported input range: PixInsight's normalized range [0, 1]. Images with
 * samples outside it are rejected instead of being silently clipped. Inside
 * that range the final blend is a convex combination of the original and the
 * blurred copy, so it is applied without any truncation; only the mask is
 * clamped to [0, 1].
 */

var TITLE = "Simple High Frequency Denoiser";

var PARAMS = {
   blurSigma:    1.5,   // Gaussian sigma for the blurred copy (px)
   maskMidtones: 0.5,   // MTF midtones applied to the luminance mask (0.5 = none)
   maskBlur:     2.0,   // Gaussian sigma to smooth the mask (0 = off)
   autoTarget:   0.20,  // Auto mask: luminance median is mapped to this value
   amount:       1.0,   // 0 = no change, 1 = full effect
   keepMask:     false,
   keepBlurred:  false
};

// Set to true to exercise the PixelMath gconv() fallback instead of Convolution.
var FORCE_GCONV_FALLBACK = false;

var NO_SWAP = (typeof UndoFlag !== "undefined" && typeof UndoFlag.NoSwapFile !== "undefined")
            ? UndoFlag.NoSwapFile
            : ((typeof UndoFlag_NoSwapFile !== "undefined") ? UndoFlag_NoSwapFile : 0);
var ERROR_ICON = (typeof StdIcon !== "undefined" && typeof StdIcon.Error !== "undefined")
               ? StdIcon.Error
               : ((typeof StdIcon_Error !== "undefined") ? StdIcon_Error : 4);

// Right + vertically centered label alignment (scoped enum in V8, global in old PJSR).
var ALIGN_RIGHT_VC = (typeof TextAlign !== "undefined" && typeof TextAlign.Right !== "undefined")
                   ? (TextAlign.Right | TextAlign.VertCenter)
                   : ((typeof TextAlign_Right !== "undefined")
                      ? (TextAlign_Right | TextAlign_VertCenter) : 0x82);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Midtones transfer function, same as PixelMath mtf(m, x).
function mtf(m, x) {
   if (x <= 0) return 0;
   if (x >= 1) return 1;
   if (m === x) return 0.5;
   return ((m - 1) * x) / (((2 * m - 1) * x) - m);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function uniqueId(base) {
   var id = base, n = 1;
   while (!ImageWindow.windowById(id).isNull)
      id = base + (n++);
   return id;
}

// Temporary windows are floating point: 64-bit for 64-bit sources, 32-bit
// otherwise (exact for every integer format and for 32-bit float).
function newWindowLike(srcImage, channels, isColor, id) {
   var bits = (srcImage.isReal && srcImage.bitsPerSample === 64) ? 64 : 32;
   return new ImageWindow(srcImage.width, srcImage.height, channels,
                          bits, true, isColor, uniqueId(id));
}

function closeWindow(win) {
   try {
      if (win && !win.isNull)
         win.forceClose();
   } catch (e) {
      console.warningln("  could not close temporary window: " + errText(e));
   }
}

// truncate = true clamps the result to [0, 1] (used for the mask only).
function runPixelMath(view, expr, truncate) {
   var P = new PixelMath;
   P.expression = expr;
   P.useSingleExpression = true;
   P.rescale = false;
   P.truncate = (truncate === true);
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;
   if (!P.executeOn(view))
      throw new Error("PixelMath failed on " + view.id + ": " + expr);
}

function errText(e) {
   if (e === undefined || e === null) return "unknown error";
   if (typeof e === "string") return e;
   if (e.message) return String(e.message);
   return String(e);
}

// Convolution.Parametric: scoped constant in V8 builds, prototype constant in
// older PJSR, numeric 0 as the last resort.
function convolutionParametricMode() {
   if (typeof Convolution.Parametric !== "undefined") return Convolution.Parametric;
   if (typeof Convolution.prototype.Parametric !== "undefined") return Convolution.prototype.Parametric;
   return 0;
}

function gaussianBlur(view, sigma) {
   if (sigma <= 0) return;
   var reason = null;
   if (FORCE_GCONV_FALLBACK) {
      reason = "forced by FORCE_GCONV_FALLBACK";
   } else {
      try {
         var C = new Convolution;
         C.mode = convolutionParametricMode();
         C.sigma = sigma;
         C.shape = 2;          // 2 = Gaussian
         C.aspectRatio = 1;
         C.rotationAngle = 0;
         if (C.executeOn(view, false))
            return;
         reason = "executeOn() returned false";
      } catch (e) {
         reason = errText(e);
      }
   }
   // Fallback: PixelMath Gaussian convolution. Values stay inside the input
   // range (positive normalized kernel), so no truncation is needed.
   console.warningln("  Convolution unavailable (" + reason +
                     "), falling back to PixelMath gconv()");
   runPixelMath(view, "gconv($T, " + sigma.toFixed(4) + ")", false);
}

// Raw luminance (no stretch) into a new grayscale window.
function makeLuminanceWindow(srcView) {
   var img = srcView.image;
   var win = newWindowLike(img, 1, false, "SHFD_mask");
   try {
      var expr = img.isColor ? "CIEY(" + srcView.id + ")" : srcView.id;
      runPixelMath(win.mainView, expr, true);
   } catch (e) {
      closeWindow(win);
      throw e;
   }
   return win;
}

// Median of the luminance -> midtones that maps it to PARAMS.autoTarget.
// For mtf: if mtf(m, x) = t then m = mtf(t, x).
function autoMidtones(srcView) {
   var win = makeLuminanceWindow(srcView);
   var med;
   try {
      med = win.mainView.image.median();
   } finally {
      closeWindow(win);
   }
   if (!(med > 0)) return 0.5;
   return clamp(mtf(PARAMS.autoTarget, med), 0.0001, 0.9999);
}

// ─── Core ─────────────────────────────────────────────────────────────────────

// Throws when the image has samples outside [0, 1] (see header comment).
function checkInputRange(image) {
   var lo = image.minimum(), hi = image.maximum();
   if (!(lo >= 0 && hi <= 1))
      throw new Error("The image contains samples outside [0, 1] (min " + lo +
                      ", max " + hi + "). Rescale or truncate it first; " +
                      "this script does not clip your data.");
}

function denoise(target) {
   var t0 = Date.now();
   var src = target.image;
   console.show();
   console.writeln("<b>" + TITLE + "</b>: " + target.id +
                   " (" + src.width + "x" + src.height + ", " +
                   (src.isColor ? "RGB" : "mono") + ", " + src.bitsPerSample +
                   (src.isReal ? "-bit float" : "-bit integer") + ")");

   if (PARAMS.amount <= 0) {
      console.writeln("  Amount = 0: nothing to do, the image is unchanged.");
      return;
   }
   checkInputRange(src);

   var maskWin = null, blurWin = null, succeeded = false;
   try {
      // 1. Luminance mask (clamped to [0, 1] at every step)
      maskWin = makeLuminanceWindow(target);
      var maskView = maskWin.mainView;
      if (Math.abs(PARAMS.maskMidtones - 0.5) > 1e-6)
         runPixelMath(maskView, "mtf(" + PARAMS.maskMidtones.toFixed(6) + ", $T)", true);
      gaussianBlur(maskView, PARAMS.maskBlur);
      // amount < 1: push the mask towards 1 (more of the original survives)
      if (PARAMS.amount < 1)
         runPixelMath(maskView, "1 - " + PARAMS.amount.toFixed(4) + "*(1 - $T)", true);
      console.writeln("  mask: midtones=" + PARAMS.maskMidtones.toFixed(4) +
                      ", smooth sigma=" + PARAMS.maskBlur +
                      ", median=" + maskView.image.median().toFixed(4));

      // 2. Blurred copy
      blurWin = newWindowLike(src, src.numberOfChannels, src.isColor, "SHFD_blurred");
      var blurView = blurWin.mainView;
      blurView.beginProcess(NO_SWAP);
      try {
         blurView.image.assign(src);
      } finally {
         blurView.endProcess();
      }
      gaussianBlur(blurView, PARAMS.blurSigma);
      console.writeln("  blur: sigma=" + PARAMS.blurSigma);

      // 3. Blend: mask -> 1 keeps original, mask -> 0 takes blurred.
      // Convex combination of two [0, 1] images: no truncation applied.
      var m = maskView.id, b = blurView.id;
      runPixelMath(target, m + "*$T + (1 - " + m + ")*" + b, false);
      succeeded = true;
   } finally {
      // On failure every temporary window is closed; on success the
      // Keep mask / Keep blurred options decide.
      if (succeeded && PARAMS.keepMask)    maskWin.show(); else closeWindow(maskWin);
      if (succeeded && PARAMS.keepBlurred) blurWin.show(); else closeWindow(blurWin);
   }

   console.writeln("  done in " + ((Date.now() - t0) / 1000).toFixed(2) + " s");
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

var DenoiseDialog = class extends Dialog {
   constructor() {
      super();
      var self = this;
      this.windowTitle = TITLE;
      var LW = 150;

      function editRow(txt, val, dec, tip, extra) {
         var lbl = new Label(self); lbl.text = txt; lbl.setFixedWidth(LW);
         lbl.textAlignment = ALIGN_RIGHT_VC;
         var edit = new Edit(self); edit.text = val.toFixed(dec); edit.setFixedWidth(70);
         if (tip) { lbl.toolTip = tip; edit.toolTip = tip; }
         var s = new Sizer(false); s.spacing = 6;
         s.add(lbl); s.add(edit);
         if (extra) s.add(extra);
         s.addStretch();
         return { sizer: s, edit: edit, label: lbl };
      }
      function checkRow(txt, val) {
         var cb = new CheckBox(self); cb.text = txt; cb.checked = val;
         var s = new Sizer(false); s.addSpacing(LW + 6); s.add(cb); s.addStretch();
         return { sizer: s, check: cb };
      }
      function pf(edit, def) { var v = parseFloat(edit.text); return isNaN(v) ? def : v; }

      // Target view
      var tLbl = new Label(this); tLbl.text = "Target:"; tLbl.setFixedWidth(LW);
      tLbl.textAlignment = ALIGN_RIGHT_VC;
      this.viewList = new ViewList(this);
      this.viewList.getMainViews();
      var aw = ImageWindow.activeWindow;
      if (!aw.isNull) this.viewList.currentView = aw.mainView;
      var tRow = new Sizer(false); tRow.spacing = 6;
      tRow.add(tLbl); tRow.add(this.viewList, 100);

      var wSigma = editRow("Blur sigma (px):", PARAMS.blurSigma, 2,
                           "Gaussian sigma of the blurred copy.");
      var wAmount = editRow("Amount (0–1):", PARAMS.amount, 2,
                            "0 = no change, 1 = full mask-based blend.");

      var autoBtn = new PushButton(this);
      autoBtn.text = "Auto";
      autoBtn.toolTip = "Pick midtones so the luminance median maps to the auto target.<br/>" +
                        "Use this on linear images — their raw luminance is almost black.";
      var wMid = editRow("Mask midtones:", PARAMS.maskMidtones, 4,
                         "MTF applied to the luminance mask. 0.5 = linear.<br/>" +
                         "Smaller values brighten the mask (protect more).", autoBtn);
      var wTarget = editRow("Auto target:", PARAMS.autoTarget, 2,
                            "Mask value the background (median) gets with Auto.");
      autoBtn.onClick = function() {
         var v = self.viewList.currentView;
         if (v.isNull) return;
         PARAMS.autoTarget = clamp(pf(wTarget.edit, PARAMS.autoTarget), 0.01, 0.99);
         try {
            checkInputRange(v.image);
            wMid.edit.text = autoMidtones(v).toFixed(4);
         } catch (e) {
            new MessageBox(errText(e), TITLE, ERROR_ICON).execute();
         }
      };
      var wMaskBlur = editRow("Mask smoothing σ (px):", PARAMS.maskBlur, 2,
                              "Gaussian blur of the mask to avoid hard transitions. 0 = off.");

      var wKeepMask = checkRow("Keep mask window", PARAMS.keepMask);
      var wKeepBlur = checkRow("Keep blurred window", PARAMS.keepBlurred);

      var gbBlur = new GroupBox(this); gbBlur.title = "Blur";
      gbBlur.sizer = new Sizer(true); gbBlur.sizer.margin = 6; gbBlur.sizer.spacing = 4;
      gbBlur.sizer.add(wSigma.sizer); gbBlur.sizer.add(wAmount.sizer);

      var gbMask = new GroupBox(this); gbMask.title = "Luminance mask";
      gbMask.sizer = new Sizer(true); gbMask.sizer.margin = 6; gbMask.sizer.spacing = 4;
      gbMask.sizer.add(wMid.sizer); gbMask.sizer.add(wTarget.sizer);
      gbMask.sizer.add(wMaskBlur.sizer);

      var gbOut = new GroupBox(this); gbOut.title = "Output";
      gbOut.sizer = new Sizer(true); gbOut.sizer.margin = 6; gbOut.sizer.spacing = 4;
      gbOut.sizer.add(wKeepMask.sizer); gbOut.sizer.add(wKeepBlur.sizer);

      var okBtn = new PushButton(this); okBtn.text = "Apply";
      okBtn.onClick = function() {
         if (self.viewList.currentView.isNull) {
            new MessageBox("Select a target image.", TITLE, ERROR_ICON).execute();
            return;
         }
         PARAMS.blurSigma    = clamp(pf(wSigma.edit, PARAMS.blurSigma), 0.1, 250);
         PARAMS.amount       = clamp(pf(wAmount.edit, PARAMS.amount), 0, 1);
         PARAMS.maskMidtones = clamp(pf(wMid.edit, PARAMS.maskMidtones), 0.0001, 0.9999);
         PARAMS.autoTarget   = clamp(pf(wTarget.edit, PARAMS.autoTarget), 0.01, 0.99);
         PARAMS.maskBlur     = clamp(pf(wMaskBlur.edit, PARAMS.maskBlur), 0, 250);
         PARAMS.keepMask     = wKeepMask.check.checked;
         PARAMS.keepBlurred  = wKeepBlur.check.checked;
         self.target = self.viewList.currentView;
         self.ok();
      };
      var cancelBtn = new PushButton(this); cancelBtn.text = "Cancel";
      cancelBtn.onClick = function() { self.cancel(); };
      var btnRow = new Sizer(false); btnRow.spacing = 6; btnRow.addStretch();
      btnRow.add(okBtn); btnRow.add(cancelBtn);

      this.sizer = new Sizer(true);
      this.sizer.margin = 10; this.sizer.spacing = 8;
      this.sizer.add(tRow);
      this.sizer.add(gbBlur);
      this.sizer.add(gbMask);
      this.sizer.add(gbOut);
      this.sizer.add(btnRow);
      this.adjustToContents();
   }
};

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
   if (ImageWindow.activeWindow.isNull) {
      new MessageBox("Open an image first.", TITLE, ERROR_ICON).execute();
      return;
   }
   var dlg = new DenoiseDialog();
   if (dlg.execute() !== 1) return;
   try {
      denoise(dlg.target);
   } catch (e) {
      var msg = errText(e);
      console.criticalln(TITLE + ": " + msg);
      new MessageBox(msg, TITLE, ERROR_ICON).execute();
   }
}

main();
