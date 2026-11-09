# PixInsight Scripts

Small PJSR scripts for astrophotography processing in [PixInsight](https://pixinsight.com/). Each script lives in its own folder with a README and can be added via **Script → Feature Scripts → Add**.

| Script | Menu | What it does |
|--------|------|--------------|
| [DiffractionSpikes](DiffractionSpikes/) | Utilities | Adds synthetic diffraction spikes with a chromatic model to stars in refractor images |
| [SimpleHighFrequencyDenoiser](SimpleHighFrequencyDenoiser/) | Noise Reduction | Luminance-masked Gaussian denoise for high-frequency noise in faint areas |
| [SplitRGBChannels](SplitRGBChannels/) | Batch Processing | Splits every RGB image in a folder into verified R, G and B XISF files |

Requirements: PixInsight 1.9 or later (V8 JavaScript runtime).

## Tests

- `DiffractionSpikes/tests/rasterization-test.js` — `node DiffractionSpikes/tests/rasterization-test.js`
- `SplitRGBChannels/tests/SplitRGBChannelsSelfTest.js` — run in PixInsight via **Script → Execute Script File**

## License

MIT License — free to use, modify and distribute.

By Andreas Petrus.
