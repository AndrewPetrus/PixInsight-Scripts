#engine v8

/*
 * SplitRGBChannelsSelfTest.js
 *
 * Round-trip test for SplitRGBChannels.js. Run with
 * Script > Execute Script File. Nothing outside a temporary directory is
 * touched, and the directory is removed at the end.
 *
 * For every supported sample format (8/16/32-bit integer, 32/64-bit float):
 *   synthetic RGB image -> save -> split -> read outputs back ->
 *   exact sample-by-sample comparison with the source channels.
 * Plus: output name planning for colliding input names.
 */

#define SPLIT_RGB_CHANNELS_SELF_TEST
#include "../SplitRGBChannels.js"

var SELF_TEST_TYPES = [
   { name: "uint8",   bits: 8,  real: false },
   { name: "uint16",  bits: 16, real: false },
   { name: "uint32",  bits: 32, real: false },
   { name: "float32", bits: 32, real: true  },
   { name: "float64", bits: 64, real: true  }
];
var TEST_W = 97, TEST_H = 301;   // odd sizes; height spans more than one strip

var results = [];
function check(name, fn) {
   try {
      fn();
      results.push({ name: name, ok: true });
      console.writeln("<b>PASS</b> " + name);
   } catch (e) {
      results.push({ name: name, ok: false, error: errText(e) });
      console.criticalln("FAIL " + name + ": " + errText(e));
   }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Deterministic pseudo-random samples with more than 24 significant bits,
// plus edge values, so that any Float32 round trip would be detected.
function fillTestImage(image) {
   var n = image.width * image.height;
   var seed = 20261109;
   for (var c = 0; c < image.numberOfChannels; ++c) {
      var buf = new Float64Array(n);
      for (var i = 0; i < n; ++i) {
         seed = (seed * 1103515245 + 12345) % 2147483648;
         var hi = seed / 2147483648;
         seed = (seed * 1103515245 + 12345) % 2147483648;
         buf[i] = hi + (seed / 2147483648) * 1e-9;
         if (buf[i] > 1) buf[i] = 1;
      }
      buf[0] = 0; buf[1] = 1; buf[2] = 0.123456789012345;
      image.setSamples(buf, new Rect(0, 0, image.width, image.height), c);
   }
}

function removeTree(dir) {
   var finder = new FileFind;
   var entries = [];
   if (finder.begin(joinPath(dir, "*"))) {
      do {
         if (finder.name !== "." && finder.name !== "..")
            entries.push({ path: joinPath(dir, finder.name), dir: finder.isDirectory });
      } while (finder.next());
      finder.end();
   }
   for (var i = 0; i < entries.length; ++i)
      if (entries[i].dir) removeTree(entries[i].path); else File.remove(entries[i].path);
   File.removeDirectory(dir);
}

function selfTest() {
   console.show();
   console.writeln("<end><cbr><br><b>SplitRGBChannels self-test</b>");

   // ── Output name planning ────────────────────────────────────────────────
   check("planOutputs: collisions", function () {
      var dirs = ["/o/R", "/o/G", "/o/B"];
      var p = planOutputs(["/in/frame.fit", "/in/frame.xisf", "/in/M31_120.0s_001.xisf",
                           "/in/a.FIT", "/in/A.fit"], dirs);
      var stems = p.plans.map(function (x) { return x.stem; });
      assert(stems.join("|") === "frame_fit|frame_xisf|M31_120.0s_001",
             "unexpected stems: " + stems.join("|"));
      assert(p.rejected.length === 2, "expected 2 rejected inputs, got " + p.rejected.length);
      assert(p.plans[0].outputs[0] === "/o/R/frame_fit_R.xisf", "bad path " + p.plans[0].outputs[0]);
      assert(p.plans[2].temps[2] === "/o/B/M31_120.0s_001_B.partial.xisf", "bad temp " + p.plans[2].temps[2]);
   });

   // ── Round trip for every sample format ──────────────────────────────────
   var tmp = joinPath(File.systemTempDirectory, "SplitRGBChannelsSelfTest_" + Date.now());
   File.createDirectory(tmp);
   var dirs = [joinPath(tmp, "R"), joinPath(tmp, "G"), joinPath(tmp, "B")];
   for (var d = 0; d < 3; ++d) File.createDirectory(dirs[d]);

   try {
      for (var t = 0; t < SELF_TEST_TYPES.length; ++t) {
         (function (type) {
            check("round trip " + type.name, function () {
               var input = joinPath(tmp, "selftest_" + type.name + ".xisf");
               var w = new ImageWindow(TEST_W, TEST_H, 3, type.bits, type.real, true,
                                       "SelfTest_" + type.name);
               try {
                  w.mainView.beginProcess();
                  try { fillTestImage(w.mainView.image); } finally { w.mainView.endProcess(); }
                  assert(w.saveAs(input, false, false, false, false), "cannot save " + input);
               } finally {
                  w.forceClose();
               }

               var plan = planOutputs([input], dirs).plans[0];
               var r = processPlan(plan);
               assert(r.status === "ok" && r.written === 3,
                      "processPlan returned " + r.status + "/" + r.written);

               // Independent check: reload input and compare each output exactly.
               withOpenedImage(input, function (src) {
                  assert(src.bitsPerSample === type.bits && src.isReal === type.real,
                         "input saved as " + src.bitsPerSample + (src.isReal ? "f" : "i"));
                  for (var ch = 0; ch < 3; ++ch) {
                     assert(!File.exists(plan.temps[ch]), "temporary file left: " + plan.temps[ch]);
                     withOpenedImage(plan.outputs[ch], function (out) {
                        compareChannel(src, ch, out, 0, type.name + " " + CHANNEL_NAMES[ch]);
                     });
                  }
               });
            });
         })(SELF_TEST_TYPES[t]);
      }
   } finally {
      try { removeTree(tmp); } catch (e) {
         console.warningln("Could not remove " + tmp + ": " + errText(e));
      }
   }

   var failed = results.filter(function (r) { return !r.ok; });
   var text = (results.length - failed.length) + " of " + results.length + " tests passed." +
              (failed.length ? "\n\nFailed:\n" + failed.map(function (r) {
                  return r.name + ": " + r.error; }).join("\n") : "");
   console.writeln("<end><cbr><br><b>" + text.replace(/\n/g, "<br>") + "</b>");
   (new MessageBox(text, "SplitRGBChannels self-test",
                   failed.length ? WARNING_ICON : INFO_ICON, OK_BUTTON)).execute();
}

selfTest();
