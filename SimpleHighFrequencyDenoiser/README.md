# Simple High Frequency Denoiser

A minimal, transparent noise-reduction script for PixInsight. It smooths high-frequency noise in the faint parts of an image while leaving bright structures — stars, nebula cores, galaxy detail — untouched.

No neural networks, no wavelets, no black box: just a luminance mask, a Gaussian blur and a PixelMath blend. You can see every intermediate step and understand exactly what happened to your data.

## How it works

1. **Luminance mask** — the luminance of the target image (`CIEY` for RGB, the image itself for mono) is extracted into a grayscale mask. Optionally it is stretched with a midtones transfer function and smoothed with a Gaussian blur so transitions stay soft.
2. **Blurred copy** — a copy of the original image is passed through a Gaussian `Convolution`.
3. **Blend** — the two are mixed pixel by pixel through the mask:

   ```
   result = mask * original + (1 - mask) * blurred
   ```

   Where the mask is close to **1** (bright signal) the original pixels are kept. Where it is close to **0** (background, faint areas) the blurred pixels take over.

The blend is applied to the target as a single PixelMath step, so the whole operation can be undone with **Ctrl/Cmd+Z**.

## Requirements

- **PixInsight 1.9 or later** (V8 JavaScript runtime)
- Linux, macOS or Windows
- Works with RGB and monochrome images, linear or stretched

## Installation

1. Download the `SimpleHighFrequencyDenoiser` folder (it contains `SimpleHighFrequencyDenoiser.js`).
2. Copy it to your PixInsight scripts directory, for example:
   - Linux/macOS: `~/PixInsight/src/scripts/SimpleHighFrequencyDenoiser/`
   - Windows: `%APPDATA%\PixInsight\src\scripts\SimpleHighFrequencyDenoiser\`
3. In PixInsight: **Script → Feature Scripts → Add** → select the folder → **OK**.
4. The script appears under **Script → Noise Reduction → Simple High Frequency Denoiser**.

Alternatively, run it once without installing via **Script → Execute Script File**.

## Usage

1. Open an image.
2. Run the script and pick the **Target** image in the dialog.
3. On **linear** data, press **Auto** next to *Mask midtones* — otherwise the raw luminance is nearly black, the mask is ~0 everywhere and the whole image (stars included) gets blurred.
4. Adjust *Blur sigma* and *Amount* to taste.
5. Click **Apply**.

Tip: enable **Keep mask window** on the first run to see which areas are protected (white) and which are smoothed (black).

## Parameters

### Blur
| Parameter | Default | Description |
|-----------|---------|-------------|
| Blur sigma (px) | 1.5 | Gaussian sigma of the blurred copy. Larger = stronger smoothing, also of fine detail. |
| Amount (0–1) | 1.0 | Overall strength. 0 = no change, 1 = full mask-based blend. At 0.5 even the background gets only half of the blur. |

### Luminance mask
| Parameter | Default | Description |
|-----------|---------|-------------|
| Mask midtones | 0.5 | Midtones transfer function applied to the mask. 0.5 = linear (no change). Smaller values brighten the mask, so more of the image is protected. |
| Auto | — | Computes the midtones so that the luminance median (the background) maps to *Auto target*. Recommended for linear images. |
| Auto target | 0.20 | Mask value the background receives when using *Auto*. Lower = background is smoothed more strongly. |
| Mask smoothing σ (px) | 2.0 | Gaussian blur of the mask to avoid hard edges around stars. 0 = off. |

### Output
| Parameter | Default | Description |
|-----------|---------|-------------|
| Keep mask window | off | Leave the mask open as `SHFD_mask` for inspection. |
| Keep blurred window | off | Leave the blurred copy open as `SHFD_blurred`. |

## Tips

- **Start small.** A blur sigma of 1–2 px removes pixel-level noise without visibly softening structure. Go above 3 px only for very noisy backgrounds.
- **Auto target** is the main knob for *where* the denoise is applied: 0.1–0.15 smooths the background aggressively, 0.25–0.35 protects more of the faint signal.
- Stars stay sharp because they are bright in the mask. If faint stars get softened, lower *Mask midtones* (or raise *Auto target*) to brighten the mask.
- Running the script twice with a small sigma usually looks more natural than once with a large one.
- If PixInsight's `Convolution` process is unavailable in your build, the script automatically falls back to PixelMath's `gconv()` and prints a warning to the console.

## Limitations

This is a deliberately simple tool. A single Gaussian blur cannot tell noise from fine detail of the same scale, so it targets **high-frequency** noise only. Low-frequency blotches and color mottle are outside its scope; for those, use multiscale tools (MultiscaleLinearTransform, TGVDenoise) or dedicated AI denoisers.

## License

MIT License — free to use, modify and distribute.
