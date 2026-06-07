# DiffractionSpikes

A PixInsight script that adds synthetic diffraction spikes to stars in refractor telescope images.

Refractors don't produce diffraction spikes naturally (no spider vanes), but many astrophotographers want them for aesthetic reasons or to match the style of reflector/SCT images. This script generates physically-motivated spikes using the native StarDetector and applies them via progressive screen/additive blending.

![Example](example.jpg)

## Features

- **Realistic spike geometry** — triangular profile (wider at base, narrower at tip), configurable number of rays (4, 6, 8…)
- **Chromatic aberration model** — R channel extends furthest, B shortest, mimicking refractor lens behavior; combined with sinusoidal color banding along each ray
- **Progressive blending** — additive near the star (bright core), screen blend at the tips (soft integration with background)
- **Dual glow** — tight core halo + wide diffuse outer glow
- **Secondary spikes** — a fainter rotated set of rays for an 8-point star look
- **Full UI** — all parameters exposed in a dialog with sliders and input fields
- **Native StarDetector** — uses PixInsight's built-in C++ star detection (fast, accurate)

## Requirements

- **PixInsight 1.9.4 or later** (V8 JavaScript runtime required)
- Works on Linux, macOS, and Windows

## Installation

1. Download `DiffractionSpikes.js`
2. Copy it to your PixInsight scripts directory:
   - Linux/macOS: `~/PixInsight/src/scripts/DiffractionSpikes/DiffractionSpikes.js`
   - Windows: `%APPDATA%\PixInsight\src\scripts\DiffractionSpikes\DiffractionSpikes.js`
3. In PixInsight: **Script → Feature Scripts → Add** → select the `DiffractionSpikes` folder → click **OK**
4. The script will appear under **Script → Utilities → DiffractionSpikes**

Alternatively, run it directly via **Script → Execute Script File**.

## Usage

1. Open an image in PixInsight and make it the active window
2. Run the script — a dialog will appear
3. Adjust parameters as needed (defaults work well for most images)
4. Click **Apply**

## Parameters

### Spike Shape
| Parameter | Default | Description |
|-----------|---------|-------------|
| Number of rays | 4 | Total rays (4 = cross, 6 = hex, 8 = octagram) |
| Angle offset | 45° | Rotation of the spike pattern |
| Max length | 180 px | Spike length for the brightest star |
| Min length | 15 px | Minimum spike length (floor for faint stars) |
| Spike width σ | 1.5 | Gaussian sigma at the base (near star) |
| Width taper | 0.05 | Tip/base width ratio — lower = more triangular |
| Falloff exponent | 2.5 | Controls how fast the spike fades along its length |
| Flux power | 1.0 | Length ∝ flux^power — higher = only bright stars get long spikes |

### Blending
| Parameter | Default | Description |
|-----------|---------|-------------|
| Intensity | 0.05 | Overall spike brightness |
| Star colour tint | 0.35 | How much the star's own colour tints the spikes |

### Chromatic Effect
| Parameter | Default | Description |
|-----------|---------|-------------|
| Chromatic amount | 0.75 | Strength of the R/G/B length gradient |
| Wave modulation | 0.55 | Strength of sinusoidal color banding |
| Wave cycles | 3 | Number of color oscillation cycles per spike |
| Scale R/G/B | 1.0 / 0.92 / 0.80 | Per-channel length fractions |

### Glow
| Parameter | Default | Description |
|-----------|---------|-------------|
| Core glow radius | 5 | Sigma of the tight halo around each star |
| Core glow intensity | 0.25 | Brightness of the core halo |
| Outer glow radius | 24 | Sigma of the wide diffuse halo |
| Outer glow intensity | 0.10 | Brightness of the outer halo |

### Secondary Spikes
| Parameter | Default | Description |
|-----------|---------|-------------|
| Enable | true | Draw a second fainter set of spikes |
| Angle offset | 45° | Rotation relative to primary spikes |
| Length fraction | 0.42 | Secondary length as a fraction of primary |
| Intensity fraction | 0.22 | Secondary brightness as a fraction of primary |
| Width σ | 0.75 | Secondary spike width |

### Star Detection
| Parameter | Default | Description |
|-----------|---------|-------------|
| Max stars (0=all) | 0 | Cap on number of stars processed |
| Min flux fraction | 0.01 | Ignore stars below this fraction of the brightest |
| SD sensitivity | 0.5 | StarDetector sensitivity (higher = more stars) |

## Tips

- **Intensity 0.05** is subtle by design — raise to 0.10–0.15 for more prominent spikes
- For dense star fields (M42, Carina), set **Max stars** to 200–500 to limit processing time
- **Min flux fraction** is useful for nebula-heavy images where the background confuses star detection — try 0.02–0.05
- **SD sensitivity** controls how faint a star needs to be to get detected: 0.3 = only bright stars, 0.8 = many faint stars
- The script runs on the active window — always work on a copy if you want to preserve the original

## License

MIT License — free to use, modify, and distribute.

## Acknowledgements

Built with PixInsight's V8 JavaScript Runtime (PJSR). Star detection powered by PixInsight's native `StarDetector` C++ class.
