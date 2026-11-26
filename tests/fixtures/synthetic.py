"""
SYNTHETIC TEST FIXTURES — NOT CDC DATA.

Generates small spreadsheets that imitate the *layout problems* described in the
project materials (label rows above the header, a total row, notes, missing
cells) so that the software can be tested before the original CDCHeartRisk.xls
is available. Values are drawn from a known linear model with a fixed seed.
They must never be reported as observations or research findings.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

STATE_NAMES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
               "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
               "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
               "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
               "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
               "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
               "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]

# Known generating coefficients (synthetic). Tests check that OLS recovers these.
TRUE_BETA = {"const": 40.0, "smoking": 6.0, "obesity": 3.0, "inactivity": 0.0, "fruit_veg": -1.5}
HEADERS = ["State", "Heart Disease Rate (synthetic)", "Smoking (%)", "Obesity (%)",
           "No Leisure-Time Physical Activity (%)", "Fruit & Vegetable 5+/day (%)"]


def synthetic_values(n: int = 51, noise: float = 4.0, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    smoking = rng.uniform(14, 30, n)
    obesity = rng.uniform(12, 24, n)
    inactivity = rng.uniform(18, 40, n)
    fruit = rng.uniform(15, 32, n)
    y = (TRUE_BETA["const"] + TRUE_BETA["smoking"] * smoking + TRUE_BETA["obesity"] * obesity
         + TRUE_BETA["inactivity"] * inactivity + TRUE_BETA["fruit_veg"] * fruit + rng.normal(0, noise, n))
    return pd.DataFrame({"state": STATE_NAMES[:n], "heart_disease": y, "smoking": smoking, "obesity": obesity,
                         "inactivity": inactivity, "fruit_veg": fruit})


def write_messy_workbook(path: Path, noise: float = 4.0, seed: int = 7, with_problems: bool = True,
                         digits: int | None = 3) -> Path:
    """Write an .xlsx (or .csv) with label rows, a header row, 51 jurisdictions, a total and a note."""
    v = synthetic_values(noise=noise, seed=seed)
    rows: list[list] = [["SYNTHETIC TEST FIXTURE - NOT CDC DATA"], ["Generated for HEARTLAB software tests only"], []]
    rows.append(HEADERS)
    for _, r in v.iterrows():
        rnd = (lambda x: round(float(x), digits)) if digits is not None else float
        rows.append([r.state, rnd(r.heart_disease), rnd(r.smoking), rnd(r.obesity), rnd(r.inactivity), rnd(r.fruit_veg)])
    if with_problems:
        rows[4 + 1][2] = f"{rows[4 + 1][2]}%"      # Alaska smoking written as text with a percent sign
        rows[4 + 2][3] = None                        # Arizona obesity missing
        rows[4 + 3][4] = "N/A"                       # Arkansas inactivity missing (text)
        rows[4 + 4][5] = "abc"                       # California fruit/veg non-numeric
    rows.append(["Total", *(round(float(v[c].mean()), 3) for c in ["heart_disease", "smoking", "obesity",
                                                                     "inactivity", "fruit_veg"])])
    rows.append(["Source: synthetic fixture", None, None, None, None, None])
    width = max(len(r) for r in rows)
    df = pd.DataFrame([r + [None] * (width - len(r)) for r in rows])
    path = Path(path)
    if path.suffix == ".csv":
        df.to_csv(path, header=False, index=False)
    else:
        df.to_excel(path, header=False, index=False, sheet_name="SYNTHETIC")
    return path


if __name__ == "__main__":
    import sys
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "synthetic_CDCHeartRisk_TEST.xlsx")
    write_messy_workbook(out)
    print(f"Wrote SYNTHETIC fixture to {out}")
