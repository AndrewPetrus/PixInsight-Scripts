# Split RGB Channels

A PixInsight batch script that splits every RGB image in a folder into three separate monochrome files — **R**, **G** and **B** — saved as XISF.

Useful when you want to process the channels of OSC / DSLR data individually: per-channel integration or weighting, channel-specific gradient removal, building synthetic luminance, or feeding single channels into tools that expect mono frames.

## Features

- **Batch processing** — handles all supported images in the selected folder in one run
- **Format-preserving copy** — samples go through a Float64 buffer, which represents every supported format exactly (8/16/32-bit integer, 32/64-bit float); the output keeps the source bit depth and sample type
- **Verified output** — every channel file is read back after saving and compared with the source channel sample by sample (exact equality); a mismatch fails the file
- **All-or-nothing sets** — channels are written under temporary names and only a complete, verified R/G/B set is renamed to its final names
- **No silent overwrites** — output names are planned for the whole batch first; inputs that would collide are disambiguated or rejected, and existing outputs are skipped unless you choose to overwrite them
- **Safe for sources** — input files are never modified; non-RGB images are skipped with a warning
- **Honest summary** — the final report counts the channel files actually written, including partial results

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
3. If some inputs already have outputs, choose **Yes** (overwrite), **No** (skip those inputs) or **Cancel**.
4. Wait for the summary dialog — progress is printed to the Process Console.

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

### Name collisions

Output names drop the source extension, so `frame.fit` and `frame.xisf` would both map to `frame_R.xisf`. When inputs share a name, the extension is appended instead:

```
frame.fit  → R/frame_fit_R.xisf
frame.xisf → R/frame_xisf_R.xisf
```

Names are compared case-insensitively (macOS and Windows file systems are). Inputs that still collide after that are rejected and listed in the console; nothing is overwritten within a run.

## Notes

- Only the top level of the selected folder is scanned; subfolders are not processed.
- Files that are not RGB (mono, fewer than 3 channels) or cannot be opened are skipped and reported in the console.
- If a file contains several images, only the first one is split (a note is printed).
- If a run is interrupted, leftover `*_R.partial.xisf` files are temporary and can be deleted.
- The output files contain pixel data only — FITS keywords and other metadata from the source are not copied.
- The input must already be debayered. Raw CFA frames are mono images and will be skipped.

## Testing

`tests/SplitRGBChannelsSelfTest.js` is a round-trip test you can run in PixInsight (**Script → Execute Script File**). For each sample format — 8/16/32-bit integer, 32/64-bit float — it creates a synthetic RGB image with values that need more than 24 bits of precision, saves it, splits it, reads the outputs back and compares them exactly with the source. It also checks the output name planner. Everything happens in a temporary directory that is removed afterwards.

## License

MIT License — free to use, modify and distribute.

## Author

Written by Andrii Petrus. Built on PixInsight's JavaScript Runtime (PJSR).
