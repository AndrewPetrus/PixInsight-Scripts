# Split RGB Channels

A PixInsight batch script that splits every RGB image in a folder into three separate monochrome files — **R**, **G** and **B** — saved as XISF.

Useful when you want to process the channels of OSC / DSLR data individually: per-channel integration or weighting, channel-specific gradient removal, building synthetic luminance, or feeding single channels into tools that expect mono frames.

## Features

- **Batch processing** — handles all supported images in the selected folder in one run
- **Lossless** — copies the raw channel samples; bit depth and sample type (integer / floating point) are preserved
- **Organized output** — channels go into separate `R`, `G` and `B` subfolders
- **Safe** — source files are never modified; non-RGB images are skipped with a warning
- **Memory-friendly** — channels are copied in strips, so large frames don't need extra full-size buffers
- **Filename-safe** — names with decimal values like `120.0s` are kept intact

## Requirements

- **PixInsight 1.9 or later** (V8 JavaScript runtime); older PJSR versions are also supported
- Linux, macOS or Windows

## Installation

1. Download the `SplitRGBChannels` folder (it contains `SplitRGBChannels.js`).
2. Copy it to your PixInsight scripts directory, for example:
   - Linux/macOS: `~/PixInsight/src/scripts/SplitRGBChannels/`
   - Windows: `%APPDATA%\PixInsight\src\scripts\SplitRGBChannels\`
3. In PixInsight: **Script → Feature Scripts → Add** → select the folder → **OK**.
4. The script appears under **Script → Batch Processing → Split RGB Channels**.

Alternatively, run it once without installing via **Script → Execute Script File**.

## Usage

1. Run the script.
2. Select the folder that contains your RGB images (calibrated and debayered, or registered).
3. Wait for the summary dialog — progress is printed to the Process Console.

### Supported input formats

`.xisf`, `.fit`, `.fits`, `.fts`, `.tif`, `.tiff`

### Output structure

For an input folder like this:

```
lights/
├── M31_120.0s_001.xisf
└── M31_120.0s_002.xisf
```

the script creates:

```
lights/
└── RGB_channels/
    ├── R/
    │   ├── M31_120.0s_001_R.xisf
    │   └── M31_120.0s_002_R.xisf
    ├── G/
    │   ├── M31_120.0s_001_G.xisf
    │   └── M31_120.0s_002_G.xisf
    └── B/
        ├── M31_120.0s_001_B.xisf
        └── M31_120.0s_002_B.xisf
```

## Notes

- Only the top level of the selected folder is scanned; subfolders are not processed.
- Files that are not RGB (mono, fewer than 3 channels) or cannot be opened are skipped and reported in the console.
- If a file contains several images, only the first one is split.
- Existing output files with the same name are **overwritten** without asking.
- The output files contain pixel data only — FITS keywords and other metadata from the source are not copied.
- The input must already be debayered. Raw CFA frames are mono images and will be skipped.

## License

MIT License — free to use, modify and distribute.

## Author

Written by Andrii Petrus. Built on PixInsight's JavaScript Runtime (PJSR).
