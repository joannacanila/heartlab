# Heartlab design system: the plate

A scientific plate: alabaster paper, deep ink and one arterial crimson. The heart is an engraved contour study, not a product render. Light and dark themes are designed separately; neither is an inversion of the other. The landing page is the exception: it is always deep-toned, a dark plate the data is drawn on.

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
| `.deep` landing tokens | n/a | #090a0f ground, #eef0f6 ink, #ff5a70 accent, wine #5a1020 and steel #1c2846 light | The landing plate, identical in both themes |

Charts read these tokens through inline `style` (see `charts.js`), so they follow the theme. The heart reads `--heart-*` and `--accent` and re-reads them when the theme changes.

## Theme
`data-theme` on `<html>` (`light` or `dark`), stored in `localStorage["heartlab-theme"]` and applied by an inline script before first paint. With nothing stored, `prefers-color-scheme` decides. The toggle sits in the top bar on every view.

## Type
- **Hanken Grotesk** (variable, 300–800, self-hosted): everything, with tabular figures for numbers.
- **Fragment Mono**: only the fitted equation and source column names.
- Scale: the landing wordmark is 64–260px, weight 800, −0.06em tracking, "HEART" solid and "LAB" outlined. View titles are 32–34px; section heads 19–23px; body 16px; captions 13–13.5px. The headline estimate is 60–92px, 620 weight, in crimson.
- Fragment Mono also sets the landing field's axis labels and readout.
- No uppercase micro-labels and no letter-spaced eyebrows.

## Mark
One cardiac cycle (ECG trace) whose R peak is a data point: the trace in ink, the point in crimson. It is used in the bar and as the favicon: `mark.svg` (theme-aware), plus `icons/` with `favicon.ico` (16/32/48), a 32px PNG, the 180px Apple touch icon and 192/512 manifest icons, all on a #0d0f16 tile. Regenerate them with `scripts/make_icons.py`.

## Structure
- **Landing:** one full-screen deep-toned composition with nothing to scroll. In the centre: the HEARTLAB wordmark, one line of description with an ⓘ disclaimer button, and one call to action, **Explore the simulator**. Behind it, from back to front:
  - a ground lit from the pointer (wine and steel radial light);
  - the engraved heart, drawn as lines only;
  - the 51 jurisdictions plotted at their real values (smoking against the observed CHD rate), with hairline axes.

  The jurisdiction nearest the pointer is dimensioned to both axes and named in a mono readout. There are no simulation controls or estimates. The bar floats over the landing; the theme toggle is hidden there.
- **App:** one top bar on every view: Simulator, Model evidence, Methods & data, and the theme toggle.
  - **Simulator:** "Build a scenario", then three numbered steps:
    1. Starting point (select).
    2. Adjust the risk factors (presets and Reset as text buttons, four factor rows, the collapsed pricing section).
    3. How the estimate changed: the estimate, starting point versus scenario bars, one sentence, the state comparison, the contribution bars, and a folded "Statistical details" panel.

    Below 980px the steps stack in order and a small estimate bar follows the scroll.
  - **Model evidence** and **Methods & data:** long-form pages with a section index.

## Components
- **Disclaimer:** a 30px circular ⓘ button. Hover or keyboard focus previews the popover, a click or tap pins it, and Escape or a click outside closes it.
- **Factor row:** name; change in points (crimson, only when moved); the value as an editable field (dotted underline at rest, hairline on hover, crimson ring on focus, amber when the text is invalid) followed by a muted %. The track fills crimson from the starting tick to the thumb, and the observed state range is a faint band. On hover or focus the row shows the starting value and the states' range. When the value is outside the historical data, or a typed value is refused, an amber line explains why.
- **Presets:** underlined text buttons; the active one is underlined in crimson.
- **Starting point versus scenario:** two 12px bars from zero on one scale. The starting point is slate. The scenario is crimson, with its uncertainty range as a translucent band and a slate tick where the starting point ends.
- **Statistical details:** a folded panel with R², adjusted R², F and n as a stat row, a compact coefficient table, and the scenario's CI and prediction interval.
- **Pricing:** price slider, a smoking-response segmented control (amber, because it is an assumption), a two-by-two pathway, and the sourced demand figure as a reference set off by a dashed margin.
- **State comparison:** all 51 observed rates as dots, the starting point as a slate line, and the scenario as a crimson point with its uncertainty band. The axis widens to fit the scenario; values beyond every state are hatched and labelled. Labels stack when they are close.
- **Contribution bars:** ink bars from a zero line. Untouched factors show an open dot and "unchanged". The counter-intuitive fruit and veg coefficient is hatched amber.

## Motion
On the landing page, the wordmark, description and call to action rise in sequence (≈1s). The field's points develop left to right and its axes draw in. The heart turns towards the pointer (damped spring) with a slow sway. It has no pulse, never reflects model output, and renders at no more than 30 fps. The light follows the pointer. In the app, numbers tween in about 320ms, comparison bars ease in 350ms, and the view swap uses a View Transition. `prefers-reduced-motion` removes the sway, the entrance sequence and the tweens.
