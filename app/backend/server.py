"""
HEARTLAB web backend (FastAPI). Every number the interface shows comes from these endpoints,
which call the Python model in src/. The frontend performs no statistical calculation.

Run:  .venv/bin/python -m uvicorn app.backend.server:app --port 8000
Env:  HEARTLAB_DATA=/path/to/file   load a specific file instead of the configured dataset in data/raw/
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src import data_processing as dp
from src.engine import HeartLabEngine
from src.simulation import InputError

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "app" / "frontend"
ALLOWED = {".xls", ".xlsx", ".csv"}
MAX_UPLOAD = 10 * 1024 * 1024

app = FastAPI(title="HEARTLAB", version="1.0")
engine = HeartLabEngine()


def _initial_load():
    path = os.environ.get("HEARTLAB_DATA")
    if path:
        engine.load(path)
    else:
        engine.load_default()


_initial_load()


class SimulationRequest(BaseModel):
    model: str = "full"
    baseline_state: Optional[str] = "mean"
    inputs: dict[str, float] = Field(default_factory=dict)
    price_increase_pct: float = 0.0
    prevalence_elasticity: float = 0.0
    uncertainty_range: Optional[tuple[float, float]] = None


@app.exception_handler(InputError)
async def _input_error(_, exc: InputError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.get("/api/status")
def status():
    return engine.status()


@app.get("/api/model")
def model():
    return engine.model_summary()


@app.get("/api/baseline")
def baseline(state: str = "mean"):
    if not engine.ready:
        raise HTTPException(409, "dataset not loaded")
    return {"state": state, "inputs": engine.baseline(state)}


@app.post("/api/simulate")
def simulate(req: SimulationRequest):
    return engine.simulate(req.model, req.baseline_state, req.inputs, req.price_increase_pct,
                           req.prevalence_elasticity, req.uncertainty_range)


@app.get("/api/states")
def states():
    if not engine.ready:
        raise HTTPException(409, "dataset not loaded")
    q = engine.data[dp.PREDICTORS].quantile([0.25, 0.5, 0.75])
    quartiles = {v: {"p25": float(q.loc[0.25, v]), "p50": float(q.loc[0.5, v]), "p75": float(q.loc[0.75, v])}
                 for v in dp.PREDICTORS}
    return {"states": engine.states(), "bounds": engine.bounds.bounds, "quartiles": quartiles}


@app.get("/api/sensitivity")
def sensitivity(model: str = "full", state: str = "mean"):
    return engine.sensitivity(model, state)


@app.post("/api/dataset")
async def upload_dataset(file: UploadFile = File(...)):
    """Upload the original spreadsheet. It is validated before it replaces anything in data/raw/."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, f"Unsupported file type '{suffix}'. Use .xls, .xlsx or .csv.")
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "File larger than 10 MB.")
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / f"upload{suffix}"
        tmp_path.write_bytes(content)
        try:
            frame, report = dp.ingest(tmp_path, dp.load_mapping())
        except dp.DatasetError as exc:
            return JSONResponse(status_code=422, content={
                "detail": str(exc), "report": exc.report.to_dict() if exc.report else None})
        if report.synthetic:
            target = Path(tmp) / f"synthetic{suffix}"  # never persist test fixtures into data/raw
            shutil.copy(tmp_path, target)
            engine.load(target)
            return {"loaded": True, "persisted": False, "synthetic": True, "status": engine.status()}
        dp.RAW_DIR.mkdir(parents=True, exist_ok=True)
        target = dp.RAW_DIR / f"uploaded_dataset{suffix}"
        shutil.copy(tmp_path, target)
    engine.load(target)
    dp.save_processed(engine.clean, engine.report)
    return {"loaded": engine.ready, "persisted": True, "synthetic": False, "status": engine.status()}


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
