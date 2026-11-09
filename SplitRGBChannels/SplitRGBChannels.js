#engine v8

#feature-id    Batch Processing > Split RGB Channels
#feature-info  Splits every RGB image in a selected directory into separate<br/>\
               monochrome R, G, and B XISF files.<br/>\
               <br/>\
               Source files are not modified. Results are written to an<br/>\
               RGB_channels subdirectory. Each written file is read back and<br/>\
               compared with the source channel before it is published.<br/>\
               <br/>\
               Written by Andrii Petrus

/*
 * SplitRGBChannels.js
 *
 * Batch channel extraction for calibrated/debayered or registered RGB files.
 * Run with Script > Execute Script File, then select the input directory.
 *
 * Guarantees:
 *  - Samples are copied through a Float64 buffer, which represents every
 *    supported sample format exactly (8/16/32-bit integer, 32/64-bit float).
 *    The output keeps the source bit depth and sample type.
 *  - Every channel file is saved under a temporary name, read back and
 *    compared sample by sample with the source. Only a complete, verified
 *    R/G/B set is renamed to its final names.
 *  - Output names are planned for the whole batch before anything is written;
 *    inputs that would map to the same output are disambiguated or rejected.
 *  - Existing outputs are skipped unless the user explicitly chooses to
 *    overwrite them.
 *
 * tests/SplitRGBChannelsSelfTest.js runs a round-trip test for all sample
 * formats and the output name planner.
 */

var TITLE = "Split RGB Channels";
var OUTPUT_DIRECTORY_NAME = "RGB_channels";
var CHANNEL_SUFFIXES = ["_R", "_G", "_B"];
var CHANNEL_NAMES = ["Red", "Green", "Blue"];
var CHANNEL_DIRECTORY_NAMES = ["R", "G", "B"];
var TEMP_SUFFIX = ".partial";     // frame_R.partial.xisf until the set is verified
var VERIFY_OUTPUT = true;         // read back and compare every written file
var STRIP_HEIGHT = 256;           // rows per copy/compare strip

// ─── PJSR compatibility ───────────────────────────────────────────────────────
// PixInsight 1.9 V8 exposes many enums as scoped objects (StdIcon.Information),
// while older PJSR versions used global names (StdIcon_Information).

function pjsrEnum(scopeName, member, fallback) {
   // eval() resolves names exactly like ordinary code would, including
   // natively defined globals that are not properties of globalThis.
   try {
      var scoped = eval("typeof " + scopeName + " !== 'undefined' ? " +
                        scopeName + "." + member + " : undefined");
      if (scoped !== undefined) return scoped;
   } catch (e) {}
   try {
      var legacy = eval("typeof " + scopeName + "_" + member + " !== 'undefined' ? " +
                        scopeName + "_" + member + " : undefined");
      if (legacy !== undefined) return legacy;
   } catch (e) {}
   return fallback;
}

var INFO_ICON     = pjsrEnum("StdIcon", "Information", 2);
var QUESTION_ICON = pjsrEnum("StdIcon", "Question", 1);
var WARNING_ICON  = pjsrEnum("StdIcon", "Warning", 3);
var OK_BUTTON     = pjsrEnum("StdButton", "Ok", 1);
var CANCEL_BUTTON = pjsrEnum("StdButton", "Cancel", 2);
var YES_BUTTON    = pjsrEnum("StdButton", "Yes", 3);
var NO_BUTTON     = pjsrEnum("StdButton", "No", 4);

function errText(e) {
   if (e === undefined || e === null) return "unknown error";
   if (typeof e === "string") return e;
   if (e.message) return String(e.message);
   return String(e);
}

// ─── Paths ────────────────────────────────────────────────────────────────────

function joinPath(directory, name) {
   if (directory.length === 0)
      return name;
   var last = directory.charAt(directory.length - 1);
   return (last === "/" || last === "\\") ? directory + name
                                               : directory + "/" + name;
}

function fileNameOf(path) {
   var p = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
   return p >= 0 ? path.substring(p + 1) : path;
}

// "M31_120.0s_001.xisf" -> "M31_120.0s_001". Only the last extension is
// removed: decimal values such as "120.0s" must stay part of the name.
function stemOf(path) {
   var name = fileNameOf(path);
   var p = name.lastIndexOf(".");
   return p > 0 ? name.substring(0, p) : name;
}

function fileExtension(name) {
   var p = name.lastIndexOf(".");
   return p >= 0 ? name.substring(p).toLowerCase() : "";
}

function isSupportedImage(name) {
   var ext = fileExtension(name);
   return ext === ".xisf" || ext === ".fit" || ext === ".fits" ||
          ext === ".fts"  || ext === ".tif" || ext === ".tiff";
}

function sanitizeViewId(text) {
   var id = text.replace(/[^A-Za-z0-9_]/g, "_");
   if (!/^[A-Za-z_]/.test(id))
      id = "C_" + id;
   return id;
}

function listInputFiles(directory) {
   var files = [];
   var finder = new FileFind;
   if (finder.begin(joinPath(directory, "*"))) {
      do {
         if (!finder.isDirectory && isSupportedImage(finder.name))
            files.push(joinPath(directory, finder.name));
      } while (finder.next());
      finder.end();
   }
   files.sort();
   return files;
}

/*
 * Plans the output names for the whole batch before anything is written.
 *
 * Inputs that share a stem ("frame.fit" and "frame.xisf") get their source
 * extension appended ("frame_fit_R.xisf", "frame_xisf_R.xisf"). Names are
 * compared case-insensitively, because macOS and Windows file systems are.
 * Inputs that still collide after that are rejected rather than overwriting
 * each other.
 *
 * Returns { plans: [{ source, stem, outputs[3], temps[3] }],
 *           rejected: [{ source, reason }] }.
 */
function planOutputs(files, channelDirectories) {
   function key(s) { return s.toLowerCase(); }

   var stemCount = {};
   for (var i = 0; i < files.length; ++i) {
      var k = key(stemOf(files[i]));
      stemCount[k] = (stemCount[k] || 0) + 1;
   }

   var candidates = [];
   for (var i = 0; i < files.length; ++i) {
      var stem = stemOf(files[i]);
      if (stemCount[key(stem)] > 1)
         stem += "_" + fileExtension(files[i]).substring(1);
      candidates.push({ source: files[i], stem: stem });
   }

   var finalCount = {};
   for (var i = 0; i < candidates.length; ++i) {
      var k = key(candidates[i].stem);
      finalCount[k] = (finalCount[k] || 0) + 1;
   }

   var result = { plans: [], rejected: [] };
   for (var i = 0; i < candidates.length; ++i) {
      var c = candidates[i];
      if (finalCount[key(c.stem)] > 1) {
         result.rejected.push({ source: c.source,
            reason: "output name '" + c.stem + "' collides with another input" });
         continue;
      }
      var outputs = [], temps = [];
      for (var ch = 0; ch < 3; ++ch) {
         var base = c.stem + CHANNEL_SUFFIXES[ch];
         outputs.push(joinPath(channelDirectories[ch], base + ".xisf"));
         temps.push(joinPath(channelDirectories[ch], base + TEMP_SUFFIX + ".xisf"));
      }
      result.plans.push({ source: c.source, stem: c.stem,
                          outputs: outputs, temps: temps });
   }
   return result;
}

function planHasExistingOutput(plan) {
   for (var ch = 0; ch < 3; ++ch)
      if (File.exists(plan.outputs[ch]))
         return true;
   return false;
}

// ─── Channel copy and verification ────────────────────────────────────────────

// Float64 represents every supported sample format exactly: 8/16/32-bit
// integers (normalized to [0,1]) and 32/64-bit floats. A Float32 buffer would
// silently drop precision for 64-bit float and 32-bit integer images.
function copyChannel(sourceImage, sourceChannel, destinationImage) {
   var width = sourceImage.width;
   var height = sourceImage.height;
   for (var y = 0; y < height; y += STRIP_HEIGHT) {
      var y1 = Math.min(y + STRIP_HEIGHT, height);
      var rect = new Rect(0, y, width, y1);
      var samples = new Float64Array(width * (y1 - y));
      sourceImage.getSamples(samples, rect, sourceChannel);
      destinationImage.setSamples(samples, rect, 0);
   }
}

// Throws unless image channel `channelB` of imageB equals channel `channelA`
// of imageA sample by sample (exact equality, no tolerance).
function compareChannel(imageA, channelA, imageB, channelB, label) {
   if (imageA.width !== imageB.width || imageA.height !== imageB.height)
      throw new Error(label + ": geometry differs (" + imageA.width + "x" + imageA.height +
                      " vs " + imageB.width + "x" + imageB.height + ")");
   if (imageA.bitsPerSample !== imageB.bitsPerSample || imageA.isReal !== imageB.isReal)
      throw new Error(label + ": sample format differs (" +
                      imageA.bitsPerSample + (imageA.isReal ? "-bit float" : "-bit int") + " vs " +
                      imageB.bitsPerSample + (imageB.isReal ? "-bit float" : "-bit int") + ")");

   var width = imageA.width, height = imageA.height;
   var mismatches = 0, maxDiff = 0;
   for (var y = 0; y < height; y += STRIP_HEIGHT) {
      var y1 = Math.min(y + STRIP_HEIGHT, height);
      var rect = new Rect(0, y, width, y1);
      var n = width * (y1 - y);
      var a = new Float64Array(n), b = new Float64Array(n);
      imageA.getSamples(a, rect, channelA);
      imageB.getSamples(b, rect, channelB);
      for (var i = 0; i < n; ++i)
         if (a[i] !== b[i]) {
            ++mismatches;
            var d = Math.abs(a[i] - b[i]);
            if (d > maxDiff) maxDiff = d;
         }
   }
   if (mismatches > 0)
      throw new Error(label + ": " + mismatches + " samples differ (max |diff| = " +
                      maxDiff.toExponential(3) + ")");
}

// Opens `path` and runs check(image). Always closes the opened windows.
function withOpenedImage(path, check) {
   var windows = ImageWindow.open(path);
   if (!windows || windows.length === 0)
      throw new Error("cannot read back " + path);
   try {
      return check(windows[0].mainView.image);
   } finally {
      for (var i = 0; i < windows.length; ++i)
         if (!windows[i].isNull)
            windows[i].forceClose();
   }
}

function writeChannelFile(sourceImage, channel, path, viewIdBase) {
   var outputWindow = new ImageWindow(
      sourceImage.width, sourceImage.height, 1,
      sourceImage.bitsPerSample, sourceImage.isReal, false,
      sanitizeViewId(viewIdBase + CHANNEL_SUFFIXES[channel]));
   try {
      // No explicit undo flag: scoped undo enums differ between PJSR runtimes,
      // and a newly created temporary window does not need an undo history.
      outputWindow.mainView.beginProcess();
      try {
         copyChannel(sourceImage, channel, outputWindow.mainView.image);
      } finally {
         outputWindow.mainView.endProcess();
      }
      if (!outputWindow.saveAs(path, false, false, false, false))
         throw new Error("PixInsight could not save " + path);
   } finally {
      outputWindow.forceClose();
   }
}

function verifyChannelFile(sourceImage, channel, path) {
   withOpenedImage(path, function (written) {
      if (written.numberOfChannels !== 1)
         throw new Error(CHANNEL_NAMES[channel] + ": expected 1 channel, read " +
                         written.numberOfChannels);
      compareChannel(sourceImage, channel, written, 0, CHANNEL_NAMES[channel]);
   });
}

function removeIfExists(path) {
   try {
      if (File.exists(path))
         File.remove(path);
   } catch (e) {
      console.warningln("  Could not remove " + path + ": " + errText(e));
   }
}

// ─── Per-file processing ──────────────────────────────────────────────────────

/*
 * Splits one input according to its plan.
 * Returns { status: "ok" | "skipped" | "failed", written: <final files created> }.
 */
function processPlan(plan) {
   console.writeln("<end><cbr><b>Input:</b> " + plan.source);

   var windows;
   try {
      windows = ImageWindow.open(plan.source);
   } catch (e) {
      console.warningln("  Skipped: cannot open file (" + errText(e) + ")");
      return { status: "failed", written: 0 };
   }
   if (!windows || windows.length === 0) {
      console.warningln("  Skipped: the file contains no readable images.");
      return { status: "failed", written: 0 };
   }

   var written = 0;
   try {
      var image = windows[0].mainView.image;
      if (!image.isColor || image.numberOfChannels < 3) {
         console.warningln("  Skipped: image is not RGB.");
         return { status: "skipped", written: 0 };
      }
      if (windows.length > 1)
         console.warningln("  Note: file contains " + windows.length +
                           " images; only the first one is split.");

      // 1. Write all three channels under temporary names and verify them.
      for (var ch = 0; ch < 3; ++ch) {
         writeChannelFile(image, ch, plan.temps[ch], plan.stem);
         if (VERIFY_OUTPUT)
            verifyChannelFile(image, ch, plan.temps[ch]);
      }

      // 2. Publish the complete set.
      for (var ch = 0; ch < 3; ++ch) {
         if (File.exists(plan.outputs[ch]))
            File.remove(plan.outputs[ch]);
         File.move(plan.temps[ch], plan.outputs[ch]);
         ++written;
         console.writeln("  " + CHANNEL_NAMES[ch] + " -> " + plan.outputs[ch] +
                         (VERIFY_OUTPUT ? "  (verified)" : ""));
      }
      return { status: "ok", written: written };
   } catch (e) {
      console.criticalln("  Failed: " + errText(e));
      if (written > 0)
         console.criticalln("  Partial result: " + written + " of 3 channel files were published.");
      return { status: "failed", written: written };
   } finally {
      for (var ch = 0; ch < 3; ++ch)
         removeIfExists(plan.temps[ch]);
      // Some formats can contain multiple images. Close all windows opened from
      // this file, even though only the first one is processed.
      for (var i = 0; i < windows.length; ++i)
         if (!windows[i].isNull)
            windows[i].forceClose();
   }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
   console.show();

   var directoryDialog = new GetDirectoryDialog;
   directoryDialog.caption = "Select a directory containing RGB images";
   if (!directoryDialog.execute()) {
      console.writeln(TITLE + ": cancelled.");
      return;
   }

   var inputDirectory = directoryDialog.directory;
   var outputDirectory = joinPath(inputDirectory, OUTPUT_DIRECTORY_NAME);
   var files = listInputFiles(inputDirectory);

   if (files.length === 0) {
      (new MessageBox(
         "No supported image files were found in the selected directory.\n\n" +
         "Supported formats: XISF, FIT, FITS, FTS, TIF, TIFF.",
         TITLE, INFO_ICON, OK_BUTTON)).execute();
      return;
   }

   var channelDirectories = [];
   for (var ch = 0; ch < 3; ++ch)
      channelDirectories.push(joinPath(outputDirectory, CHANNEL_DIRECTORY_NAMES[ch]));

   var planned = planOutputs(files, channelDirectories);

   // Existing outputs are skipped unless the user explicitly asks to overwrite.
   var existing = {};
   var existingCount = 0;
   for (var i = 0; i < planned.plans.length; ++i)
      if (planHasExistingOutput(planned.plans[i])) {
         existing[planned.plans[i].source] = true;
         ++existingCount;
      }
   var overwrite = false;
   if (existingCount > 0) {
      var answer = (new MessageBox(
         existingCount + " of " + planned.plans.length +
         " input files already have output channels in\n" + outputDirectory + "\n\n" +
         "Yes — overwrite them\nNo — skip these inputs\nCancel — stop",
         TITLE, QUESTION_ICON, YES_BUTTON, NO_BUTTON, CANCEL_BUTTON)).execute();
      if (answer === YES_BUTTON)
         overwrite = true;
      else if (answer !== NO_BUTTON) {
         console.writeln(TITLE + ": cancelled.");
         return;
      }
   }

   if (!File.directoryExists(outputDirectory))
      File.createDirectory(outputDirectory);
   for (var ch = 0; ch < 3; ++ch)
      if (!File.directoryExists(channelDirectories[ch]))
         File.createDirectory(channelDirectories[ch]);

   console.writeln("<end><cbr><br><b>" + TITLE + "</b>");
   console.writeln("Input directory : " + inputDirectory);
   console.writeln("Output directory: " + outputDirectory);
   console.writeln("Files found     : " + files.length);
   console.writeln("Existing outputs: " + (existingCount === 0 ? "none"
                   : existingCount + (overwrite ? " (overwrite)" : " (skip)")));

   for (var i = 0; i < planned.rejected.length; ++i)
      console.warningln("Rejected " + planned.rejected[i].source + ": " +
                        planned.rejected[i].reason);

   var stats = { ok: 0, skipped: 0, existingSkipped: 0, failed: 0, partial: 0, filesWritten: 0 };
   for (var i = 0; i < planned.plans.length; ++i) {
      processEvents();
      var plan = planned.plans[i];
      if (existing[plan.source] && !overwrite) {
         console.writeln("<end><cbr>Skipped (outputs exist): " + plan.source);
         ++stats.existingSkipped;
         continue;
      }
      var r = processPlan(plan);
      stats.filesWritten += r.written;
      if (r.status === "ok") ++stats.ok;
      else if (r.status === "skipped") ++stats.skipped;
      else {
         ++stats.failed;
         if (r.written > 0) ++stats.partial;
      }
   }

   var summary = "Finished.\n\n" +
                 "RGB files split: " + stats.ok + "\n" +
                 "Skipped (not RGB): " + stats.skipped + "\n" +
                 "Skipped (outputs exist): " + stats.existingSkipped + "\n" +
                 "Rejected (name collision): " + planned.rejected.length + "\n" +
                 "Failed: " + stats.failed +
                 (stats.partial > 0 ? " (" + stats.partial + " with partial output)" : "") + "\n" +
                 "Channel files written: " + stats.filesWritten + "\n\n" +
                 "Output directory:\n" + outputDirectory;

   console.writeln("<end><cbr><br><b>Done:</b> " + stats.ok + " split, " +
                   stats.filesWritten + " channel files written, " +
                   (stats.skipped + stats.existingSkipped) + " skipped, " +
                   planned.rejected.length + " rejected, " + stats.failed + " failed.");
   (new MessageBox(summary, TITLE,
                   (stats.failed > 0 || planned.rejected.length > 0) ? WARNING_ICON : INFO_ICON,
                   OK_BUTTON)).execute();
}

#ifndef SPLIT_RGB_CHANNELS_SELF_TEST
main();
#endif
