"""
HEARTLAB data layer: ingestion, validation and cleaning of the state-level
CDC heart-disease risk-factor spreadsheet (CDCHeartRisk.xls).

Nothing in this module hardcodes column positions. Headers are located by
inspecting the sheet, then mapped to model variables through
config/column_mapping.json (explicit header names win over pattern matching).

The project materials warn that the spreadsheet contains extra labels and a
total row; those rows are identified and excluded with a recorded reason.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAPPING = ROOT / "config" / "column_mapping.json"
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"

MODEL_VARIABLES = ["heart_disease", "smoking", "obesity", "inactivity", "fruit_veg"]
PREDICTORS = ["smoking", "obesity", "inactivity", "fruit_veg"]
DEPENDENT = "heart_disease"

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
DC = {"DC": "District of Columbia"}
TERRITORIES = {"PR": "Puerto Rico", "GU": "Guam", "VI": "Virgin Islands", "AS": "American Samoa",
               "MP": "Northern Mariana Islands"}
AGGREGATE_PATTERNS = [r"\btotal\b", r"\bunited states\b", r"^u\.?s\.?a?\.?$", r"\bnational\b", r"\bmedian\b",
                      r"\baverage\b", r"\bmean\b", r"\ball states\b", r"\bnationwide\b", r"\bsum\b"]


class DatasetError(Exception):
    """Raised when the spreadsheet cannot be turned into an analysis-ready dataset."""

    def __init__(self, message: str, report: "IngestionReport | None" = None):
        super().__init__(message)
        self.report = report


@dataclass
class IngestionReport:
    source_file: str
    sheet_names: list[str] = field(default_factory=list)
    sheet_used: str | None = None
    header_row_index: int | None = None
    headers_found: list[str] = field(default_factory=list)
    column_mapping: dict[str, str] = field(default_factory=dict)
    mapping_method: dict[str, str] = field(default_factory=dict)
    rows_scanned: int = 0
    observations: int = 0
    excluded_rows: list[dict[str, Any]] = field(default_factory=list)
    invalid_values: list[dict[str, Any]] = field(default_factory=list)
    missing_by_variable: dict[str, int] = field(default_factory=dict)
    complete_cases: int = 0
    states_included: list[str] = field(default_factory=list)
    states_absent: list[str] = field(default_factory=list)
    includes_dc: bool = False
    value_scale: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    synthetic: bool = False
    metadata_text: list[str] = field(default_factory=list)
    file_metadata: dict[str, list[str]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_mapping(path: Path | str | None = None) -> dict[str, Any]:
    with open(path or DEFAULT_MAPPING, encoding="utf-8") as fh:
        return json.load(fh)


def read_workbook(path: Path | str) -> dict[str, pd.DataFrame]:
    """Read every sheet with no header so that label rows are preserved for inspection."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return {"csv": pd.read_csv(path, header=None, dtype=object)}
    engine = "xlrd" if suffix == ".xls" else "openpyxl"
    return pd.read_excel(path, sheet_name=None, header=None, dtype=object, engine=engine)


def _norm(text: Any) -> str:
    if text is None or (isinstance(text, float) and np.isnan(text)):
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()


def _matches(header: str, patterns: list[str]) -> bool:
    h = header.lower()
    return any(p.lower() in h for p in patterns)


def find_header_row(raw: pd.DataFrame, mapping: dict[str, Any], max_scan: int = 40) -> int:
    """The header row is the row whose cells match the most variable patterns."""
    best_row, best_score = None, 0
    for i in range(min(max_scan, len(raw))):
        cells = [_norm(c) for c in raw.iloc[i].tolist()]
        score = 0
        for spec in mapping["variables"].values():
            target = spec.get("header")
            known = [k.lower() for k in spec.get("known_headers") or []]
            if any((target and c.lower() == target.lower())
                   or (not target and c and (c.lower() in known or _matches(c, spec["patterns"])))
                   for c in cells):
                score += 1
        if score > best_score:
            best_row, best_score = i, score
    if best_row is None or best_score < 3:
        raise DatasetError(
            "Could not locate a header row naming at least three of the model variables. "
            "Set 'header_row' and the variable 'header' fields in config/column_mapping.json.")
    return best_row


def map_columns(headers: list[str], mapping: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """Return {model_variable: spreadsheet_header} and how each was mapped."""
    result, method = {}, {}
    used: set[str] = set()
    specs = dict(mapping["variables"])
    specs["state"] = mapping["state_column"]
    for var, spec in specs.items():
        explicit = spec.get("header")
        if explicit:
            hits = [h for h in headers if h.lower() == explicit.lower()]
            if not hits:
                raise DatasetError(f"Configured header '{explicit}' for '{var}' is not in the sheet. Found: {headers}")
            result[var], method[var] = hits[0], "explicit"
        elif any(h.lower() in [k.lower() for k in spec.get("known_headers") or []] for h in headers if h):
            known = [k.lower() for k in spec["known_headers"]]
            result[var], method[var] = next(h for h in headers if h and h.lower() in known), "known"
        else:
            hits = [h for h in headers if h and h not in used and _matches(h, spec["patterns"])]
            if var == "state":
                hits = hits[:1] if hits else []
            if len(hits) == 0:
                raise DatasetError(f"No column matches '{var}' (patterns {spec['patterns']}). Headers found: {headers}. "
                                   f"Set variables.{var}.header in config/column_mapping.json.")
            if len(hits) > 1:
                raise DatasetError(f"Ambiguous columns for '{var}': {hits}. Set variables.{var}.header explicitly "
                                   f"in config/column_mapping.json.")
            result[var], method[var] = hits[0], "pattern"
        used.add(result[var])
    return result, method


def classify_state(label: str, include_dc: bool, include_territories: bool) -> tuple[str | None, str | None]:
    """Return (state_code, None) for an observation, or (None, exclusion_reason)."""
    text = _norm(label)
    if not text:
        return None, "blank state label"
    low = text.lower().rstrip(".*")
    for pat in AGGREGATE_PATTERNS:
        if re.search(pat, low):
            return None, "aggregate/summary row (total, national or average value)"
    candidates = dict(STATES)
    if include_dc:
        candidates.update(DC)
    lookup = {k.lower(): k for k in candidates}
    lookup.update({v.lower(): k for k, v in candidates.items()})
    lookup.update({"washington dc": "DC", "washington, d.c.": "DC", "d.c.": "DC"} if include_dc else {})
    clean = re.sub(r"[\*†‡]+$", "", low).strip()
    if clean in lookup:
        return lookup[clean], None
    terr = {k.lower() for k in TERRITORIES} | {v.lower() for v in TERRITORIES.values()}
    if clean in terr:
        return None, "territory (excluded by configuration)"
    if not include_dc and (clean in {"dc", "district of columbia", "washington dc", "d.c."}):
        return None, "District of Columbia (excluded by configuration)"
    return None, "label or note row (not a recognised state)"


def to_number(value: Any) -> tuple[float, str | None]:
    """Convert a cell to float. Returns (nan, reason) when the cell is missing or invalid."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return np.nan, "missing"
    if isinstance(value, (int, float, np.integer, np.floating)) and not isinstance(value, bool):
        return float(value), None
    text = _norm(value).replace(",", "").replace("%", "")
    if text in {"", "-", "--", "NA", "N/A", "n/a", ".", "*"}:
        return np.nan, "missing"
    try:
        return float(text), None
    except ValueError:
        return np.nan, "non-numeric"


def ingest(path: Path | str, mapping: dict[str, Any] | None = None) -> tuple[pd.DataFrame, IngestionReport]:
    """Turn the raw spreadsheet into one clean row per state.

    Returns the clean frame (columns: state, state_name and the five model
    variables; rows with missing values are retained and flagged) and a
    report describing every decision made.
    """
    path = Path(path)
    if not path.exists():
        raise DatasetError(f"Dataset file not found: {path}")
    mapping = mapping or load_mapping()
    report = IngestionReport(source_file=path.name)
    sheets = read_workbook(path)
    report.sheet_names = list(sheets)

    sheet_name = mapping.get("sheet")
    if sheet_name:
        if sheet_name not in sheets:
            raise DatasetError(f"Sheet '{sheet_name}' not found. Sheets: {report.sheet_names}", report)
        candidates = [sheet_name]
    else:
        candidates = list(sheets)

    raw, header_idx, last_error = None, None, None
    for name in candidates:
        try:
            idx = mapping.get("header_row")
            idx = int(idx) if idx is not None else find_header_row(sheets[name], mapping)
            raw, header_idx, report.sheet_used = sheets[name], idx, name
            break
        except DatasetError as exc:
            last_error = exc
    if raw is None:
        raise DatasetError(str(last_error), report)

    report.header_row_index = header_idx
    report.metadata_text = [t for t in (_norm(" ".join(_norm(c) for c in raw.iloc[i].tolist()))
                                        for i in range(header_idx)) if t]
    all_text = " ".join(report.metadata_text + [_norm(c) for c in raw.iloc[header_idx:].astype(str).values.ravel()])
    report.synthetic = "SYNTHETIC" in all_text.upper()

    headers = [_norm(c) for c in raw.iloc[header_idx].tolist()]
    report.headers_found = [h for h in headers if h]
    colmap, method = map_columns(headers, mapping)
    report.column_mapping, report.mapping_method = colmap, method
    col_index = {var: headers.index(h) for var, h in colmap.items()}

    body = raw.iloc[header_idx + 1:]
    mapped = set(colmap.values())
    for j, h in enumerate(headers):  # constant descriptive columns (year, definition, provenance)
        if h and h not in mapped:
            vals = sorted({_norm(v) for v in body.iloc[:, j].tolist() if _norm(v)})
            if 0 < len(vals) <= 3:
                report.file_metadata[h] = vals
    records = []
    for offset, (_, row) in enumerate(body.iterrows()):
        excel_row = header_idx + 2 + offset  # 1-based spreadsheet row number
        values = row.tolist()
        if all(_norm(v) == "" for v in values):
            continue
        report.rows_scanned += 1
        label = values[col_index["state"]]
        code, reason = classify_state(label, mapping.get("include_district_of_columbia", True),
                                      mapping.get("include_territories", False))
        if code is None:
            report.excluded_rows.append({"row": excel_row, "label": _norm(label), "reason": reason})
            continue
        rec = {"state": code, "state_name": {**STATES, **DC}[code]}
        for var in MODEL_VARIABLES:
            num, problem = to_number(values[col_index[var]])
            rec[var] = num
            if problem:
                report.invalid_values.append({"row": excel_row, "state": code, "variable": var,
                                              "raw": _norm(values[col_index[var]]), "issue": problem})
        records.append(rec)

    df = pd.DataFrame.from_records(records, columns=["state", "state_name", *MODEL_VARIABLES])
    dupes = df["state"][df["state"].duplicated()].tolist()
    if dupes:
        raise DatasetError(f"Duplicate state rows found: {dupes}", report)

    for var in MODEL_VARIABLES:
        col = df[var]
        if var != DEPENDENT and col.notna().any():
            if (col.dropna() < 0).any():
                report.warnings.append(f"{var}: negative values present; prevalence cannot be negative.")
            mx = col.max()
            report.value_scale[var] = "proportion (0-1)" if mx <= 1 else ("percent (0-100)" if mx <= 100 else "unknown (>100)")
            if mx > 100:
                report.warnings.append(f"{var}: values exceed 100; check the unit in the source sheet.")
        else:
            report.value_scale[var] = "rate (source units)"
        report.missing_by_variable[var] = int(col.isna().sum())

    report.observations = len(df)
    report.complete_cases = int(df[MODEL_VARIABLES].notna().all(axis=1).sum())
    report.states_included = df["state"].tolist()
    expected = set(STATES) | (set(DC) if mapping.get("include_district_of_columbia", True) else set())
    report.states_absent = sorted(expected - set(df["state"]))
    report.includes_dc = "DC" in report.states_included
    if report.states_absent:
        report.warnings.append(f"{len(report.states_absent)} expected jurisdiction(s) absent: {report.states_absent}")
    if report.complete_cases < len(PREDICTORS) + 2:
        raise DatasetError(f"Only {report.complete_cases} complete observations; too few to fit the model.", report)
    return df, report


def analysis_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Listwise deletion: the regression uses complete cases only (documented in the report)."""
    return df.dropna(subset=MODEL_VARIABLES).reset_index(drop=True)


def describe(df: pd.DataFrame) -> pd.DataFrame:
    d = df[MODEL_VARIABLES].describe().T
    d["missing"] = df[MODEL_VARIABLES].isna().sum()
    return d[["count", "missing", "mean", "std", "min", "25%", "50%", "75%", "max"]]


def save_processed(df: pd.DataFrame, report: IngestionReport, out_dir: Path | None = None) -> None:
    out_dir = Path(out_dir or PROCESSED_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_dir / "heart_risk_clean.csv", index=False)
    with open(out_dir / "ingestion_report.json", "w", encoding="utf-8") as fh:
        json.dump(report.to_dict(), fh, indent=2, default=str)


def locate_dataset(mapping: dict[str, Any] | None = None) -> Path | None:
    """Find the dataset in data/raw: the file named by config 'dataset_file', an uploaded file,
    or a CDCHeartRisk.* spreadsheet. When several exist, the most recently written wins, so an
    upload made through the interface survives a restart."""
    try:
        mapping = mapping or load_mapping()
    except (OSError, ValueError):
        mapping = {}
    candidates: list[Path] = []
    if mapping.get("dataset_file"):
        candidates.append(RAW_DIR / mapping["dataset_file"])
    for pattern in ("uploaded_dataset.*", "CDCHeartRisk*.xls", "CDCHeartRisk*.xlsx", "CDCHeartRisk*.csv"):
        candidates.extend(sorted(RAW_DIR.glob(pattern)))
    existing = [c for c in candidates if c.is_file() and c.suffix.lower() in {".xls", ".xlsx", ".csv"}]
    return max(existing, key=lambda c: c.stat().st_mtime) if existing else None


if __name__ == "__main__":
    import sys
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else locate_dataset()
    if target is None:
        print("No dataset found in data/raw/. Pass a path or set dataset_file in config/column_mapping.json.")
        sys.exit(1)
    frame, rep = ingest(target)
    save_processed(frame, rep)
    print(json.dumps({k: v for k, v in rep.to_dict().items() if k not in {"states_included"}}, indent=2, default=str))
