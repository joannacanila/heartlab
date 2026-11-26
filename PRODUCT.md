# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
A university group presenting a Computational Science final project, and the instructor and classmates who assess it. The primary viewing scene is a live projector demo in a classroom (bright room, washed-out projector), with the presenter driving the simulation workspace while the audience reads the numbers from a distance.

## Product Purpose
HEARTLAB implements Gordon & Guilfoos (2017), Ch. 14 §14.3.6: a state-level multiple linear regression of 1998 U.S. coronary heart disease mortality on smoking, obesity, physical inactivity and low fruit/vegetable intake, plus scenario and cigarette-price simulations. Success means the audience understands what the fitted model says, how a scenario changes the estimate, and where the uncertainty and limits are.

## Positioning
Every number is computed by the Python backend from the real dataset; nothing is illustrative except the heart visual. The cigarette-price pathway separates the sourced demand elasticity (−0.4, Bader et al. 2011) from the user-set prevalence elasticity assumption.

## Constraints
- Views: landing page, simulator, model evidence, methods & data. The landing page fits one viewport and holds no simulation controls.
- No fabricated values. No causal or individual-level claims (ecological, state-level data).
- At most two font families: one sans-serif and one monospace for numbers.
- The landing background (lit ground, engraved heart, the 51 jurisdictions plotted from the data) is illustrative; the heart is not physiological and never reflects model output.
- Must avoid a template or AI-assembled look; numbers must be easy to read from a projector.
- Accessibility: semantic headings, labelled controls, keyboard focus, reduced motion.

## Evidence
Dataset `data/raw/HEARTLAB_1998_CDC_CHD_dataset.csv` (51 jurisdictions, assembled from separate CDC-published tables; not the original CDCHeartRisk.xls).
