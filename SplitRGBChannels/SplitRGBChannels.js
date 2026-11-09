#engine v8

#feature-id    Batch Processing > Split RGB Channels
#feature-info  Splits every RGB image in a selected directory into separate<br/>\
               monochrome R, G, and B XISF files.<br/>\
               <br/>\
               Source files are not modified. Results are written to an<br/>\
               RGB_channels subdirectory.<br/>\
               <br/>\
               Written by Andrii Petrus

/*
 * SplitRGBChannels.js
 *
 * Batch channel extraction for calibrated/debayered or registered RGB files.
 * Run with Script > Execute Script File, then select the input directory.
 */

var OUTPUT_DIRECTORY_NAME = "RGB_channels";
var CHANNEL_SUFFIXES = ["_R", "_G", "_B"];
var CHANNEL_NAMES = ["Red", "Green", "Blue"];
var CHANNEL_DIRECTORY_NAMES = ["R", "G", "B"];

// PixInsight 1.9 V8 exposes many enums as scoped objects (StdIcon.Information),
// while older PJSR versions used global names (StdIcon_Information).
var INFO_ICON = (typeof StdIcon !== "undefined" &&
                 typeof StdIcon.Information !== "undefined")
              ? StdIcon.Information
              : ((typeof StdIcon_Information !== "undefined")
                 ? StdIcon_Information : 1);
var OK_BUTTON = (typeof StdButton !== "undefined" &&
                 typeof StdButton.Ok !== "undefined")
               ? StdButton.Ok
               : ((typeof StdButton_Ok !== "undefined")
                  ? StdButton_Ok : 1);

function joinPath(directory, name) {
   if (directory.length === 0)
      return name;
   var last = directory.charAt(directory.length - 1);
   return (last === "/" || last === "\\") ? directory + name
                                               : directory + "/" + name;
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

function copyChannel(sourceImage, sourceChannel, destinationImage) {
   // Copy in horizontal strips to keep memory use modest for large frames.
   var stripHeight = 256;
   var width = sourceImage.width;
   var height = sourceImage.height;

   for (var y = 0; y < height; y += stripHeight) {
      var y1 = Math.min(y + stripHeight, height);
      var rect = new Rect(0, y, width, y1);
      var samples = new Float32Array(width * (y1 - y));
      sourceImage.getSamples(samples, rect, sourceChannel);
      destinationImage.setSamples(samples, rect, 0);
   }
}

function extractChannel(sourceWindow, sourcePath, outputDirectory, channel) {
   var sourceImage = sourceWindow.mainView.image;
   // File.extractName() already returns the filename without its extension.
   // Do not trim it again: astronomical filenames often contain decimal
   // values such as "120.0s", which must remain part of the output name.
   var stem = File.extractName(sourcePath);
   var outputName = stem + CHANNEL_SUFFIXES[channel] + ".xisf";
   var outputPath = joinPath(outputDirectory, outputName);
   var viewId = sanitizeViewId(stem + CHANNEL_SUFFIXES[channel]);

   var outputWindow = new ImageWindow(
      sourceImage.width,
      sourceImage.height,
      1,
      sourceImage.bitsPerSample,
      sourceImage.isReal,
      false,
      viewId
   );

   try {
      // No explicit undo flag: scoped undo enums differ between PJSR runtimes,
      // and a newly created temporary window does not need an undo history.
      outputWindow.mainView.beginProcess();
      try {
         copyChannel(sourceImage, channel, outputWindow.mainView.image);
      } finally {
         outputWindow.mainView.endProcess();
      }

      if (!outputWindow.saveAs(outputPath, false, false, false, false))
         throw new Error("PixInsight could not save the output file");

      console.writeln("  " + CHANNEL_NAMES[channel] + " -> " + outputPath);
   } finally {
      outputWindow.forceClose();
   }
}

function processFile(path, channelDirectories) {
   console.writeln("<end><cbr><b>Input:</b> " + path);

   var windows;
   try {
      windows = ImageWindow.open(path);
   } catch (e) {
      console.warningln("  Skipped: cannot open file (" + e.message + ")");
      return false;
   }

   if (!windows || windows.length === 0) {
      console.warningln("  Skipped: the file contains no readable images.");
      return false;
   }

   var sourceWindow = windows[0];
   try {
      var image = sourceWindow.mainView.image;
      if (!image.isColor || image.numberOfChannels < 3) {
         console.warningln("  Skipped: image is not RGB.");
         return false;
      }

      for (var channel = 0; channel < 3; ++channel)
         extractChannel(sourceWindow, path, channelDirectories[channel], channel);

      return true;
   } catch (e) {
      console.criticalln("  Failed: " + e.message);
      return false;
   } finally {
      // Some formats can contain multiple images. Close all windows opened from
      // this file, even though only the first one is processed.
      for (var i = 0; i < windows.length; ++i)
         if (!windows[i].isNull)
            windows[i].forceClose();
   }
}

function main() {
   console.show();

   var directoryDialog = new GetDirectoryDialog;
   directoryDialog.caption = "Select a directory containing RGB images";
   if (!directoryDialog.execute()) {
      console.writeln("Split RGB Channels: cancelled.");
      return;
   }

   var inputDirectory = directoryDialog.directory;
   var outputDirectory = joinPath(inputDirectory, OUTPUT_DIRECTORY_NAME);
   var files = listInputFiles(inputDirectory);

   if (files.length === 0) {
      (new MessageBox(
         "No supported image files were found in the selected directory.\n\n" +
         "Supported formats: XISF, FIT, FITS, FTS, TIF, TIFF.",
         "Split RGB Channels",
         INFO_ICON,
         OK_BUTTON
      )).execute();
      return;
   }

   if (!File.directoryExists(outputDirectory))
      File.createDirectory(outputDirectory);

   var channelDirectories = [];
   for (var channel = 0; channel < 3; ++channel) {
      var channelDirectory = joinPath(
         outputDirectory, CHANNEL_DIRECTORY_NAMES[channel]);
      if (!File.directoryExists(channelDirectory))
         File.createDirectory(channelDirectory);
      channelDirectories.push(channelDirectory);
   }

   console.writeln("<end><cbr><br><b>Split RGB Channels</b>");
   console.writeln("Input directory : " + inputDirectory);
   console.writeln("Output directory: " + outputDirectory);
   console.writeln("Files found     : " + files.length);

   var succeeded = 0;
   for (var i = 0; i < files.length; ++i) {
      processEvents();
      if (processFile(files[i], channelDirectories))
         ++succeeded;
   }

   var failed = files.length - succeeded;
   var summary = "Finished.\n\n" +
                 "RGB files processed: " + succeeded + "\n" +
                 "Files skipped/failed: " + failed + "\n" +
                 "Channels created: " + (succeeded * 3) + "\n\n" +
                 "Output directory:\n" + outputDirectory;

   console.writeln("<end><cbr><br><b>Done:</b> " + succeeded + " processed, " +
                   failed + " skipped/failed.");
   (new MessageBox(summary, "Split RGB Channels", INFO_ICON,
                   OK_BUTTON)).execute();
}

main();
