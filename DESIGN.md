# Heartlab design system: the plate

A scientific plate: alabaster paper, deep ink and one arterial crimson. The heart is an engraved contour study, not a product render. Light and dark themes are designed separately; neither is an inversion of the other.

## Colour (tokens in `app/frontend/styles.css` `:root`)
| Role | Light | Dark | Meaning |
|---|---|---|---|
| `--bg` | #f7f7f5 | #0d0f16 | Paper |
| `--surface` / `--sunken` | #ffffff / #eeeeea | #151824 / #1b1f2d | Inputs, stat cells / tips, equation strip |
| `--line` / `--line-2` | #e2e2e6 / #c9c9d1 | #262a39 / #3b4053 | Hairlines / control borders, slider tracks |
| `--ink`, `--ink-2`, `--ink-3` | #11131e, #3b3e4d, #5c5f70 | #eceef4, #c0c3d0, #9599ab | Text tiers |
| `--accent` | #c81e3c | #ff5a70 | **The scenario estimate** and current focus. Never decoration. |
| `--base` | #4a5878 | #9cadd6 | The starting point (marker, slider tick, −1 SD) |
| `--amber` (+ wash, line) | #8a5a00 | #e8b75c | **User-supplied assumptions** (smoking response), extrapolation flags, the fruit/veg sign note |
| `--dot` | #b9bcc8 | #4a5066 | Observed state data in charts |

Charts read these tokens through inline `style` (see `charts.js`), so they follow the theme. The heart reads `--heart-*` and `--accent` and re-reads them when the theme changes.

## Theme
`data-theme` on `<html>` (`light` or `dark`), stored in `localStorage["heartlab-theme"]` and applied by an inline script before first paint. With nothing stored, `prefers-color-scheme` decides. The toggle sits in the top bar on every view.

## Type
- **Hanken Grotesk** (variable, 300–800, self-hosted): everything, with tabular figures for numbers.
- **Fragment Mono**: only the fitted equation and source column names.
- Scale: landing H1 36–56px/640; view titles 32–34px; section heads 19–23px; body 16px; captions 13–13.5px. The headline estimate is 60–92px, 620 weight, in crimson.
- No uppercase micro-labels and no letter-spaced eyebrows.

## Mark
One cardiac cycle (ECG trace) whose R peak is a data point: the trace in ink, the point in crimson. It is used in the bar, on the landing page and as the favicon (`mark.svg`, theme-aware).

## Structure
- **Landing:** an editorial two-column layout. The question, a short lede, a live "Try it" block (four sliders, a backend estimate, and the way in) on the left. The heart stage on the right, whose crimson level marks the estimate's place between the lowest and highest observed state rates. The values set in "Try it" carry into the simulator.
- **App:** one top bar with three views: Simulate, Model evidence, Methods & data.
  - **Simulate:** title, starting-point select, presets, then controls (left) beside the outcome (right, sticky). On narrow screens the estimate comes first, then the controls, then the explanation, with a floating result bar while the estimate is off-screen.
  - **Model evidence** and **Methods & data:** long-form pages with a section index that tracks scrolling.

## Components
- Factor row: name with an info toggle, change in points, a number box with the unit inside, a slider with the observed state range as a band and the start as a slate tick, then "Start x%" and the state range (amber when extrapolating).
- Smoking response: a five-way segmented control (None, Small, Moderate, Strong, Custom), coloured amber because it is an assumption.
- Price pathway: four steps on one line (price, then share who smoke (assumed), then smoking prevalence, then the estimate). The demand figure sits beneath as a dashed-margin reference.
- Range chart: all 51 observed rates as dots, the start as a slate line, the scenario as a crimson point with its confidence interval band, and kept scenarios as numbered rings.

## Motion
The heart turns towards the pointer (damped spring) with a slow, low-amplitude pulse, and its level eases to each new estimate. Numbers tween in about 320ms; the view swap uses a View Transition. `prefers-reduced-motion` removes the sway, the pulse and the tweens.
