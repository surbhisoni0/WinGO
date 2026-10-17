"""REST API. Write endpoints require X-API-Key when ADMIN_API_KEY is configured."""
import secrets
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from app.api.schemas import ImportIn, ResultIn
from app.prediction.engine import ENGINE_VERSION

router = APIRouter(prefix="/api")
MAX_CSV_BYTES = 5_000_000


def svc(request: Request):
    return request.app.state.service


def require_key(request: Request, x_api_key: Optional[str] = Header(default=None)):
    key = request.app.state.settings.admin_api_key
    if key and not (x_api_key and secrets.compare_digest(x_api_key, key)):
        raise HTTPException(status_code=401, detail="missing or invalid X-API-Key")


def _rows(items):
    return [{"number": r.number, "period_id": r.period_id, "timestamp": r.timestamp.isoformat() if r.timestamp else None}
            for r in items]


@router.get("/status")
def status(request: Request):
    s = svc(request); last = s.repo.last_result()
    return {"engine_version": ENGINE_VERSION, "results": last["seq"] if last else 0,
            "backtest": s.backtest_state, "auth_required_for_writes": bool(request.app.state.settings.admin_api_key)}


@router.post("/data/import", dependencies=[Depends(require_key)])
def import_json(body: ImportIn, request: Request):
    return svc(request).import_rows(_rows(body.rows))


@router.post("/data/import/csv", dependencies=[Depends(require_key)])
async def import_csv(request: Request, newest_first: bool = Query(False, description="Set true if the file lists the newest round first")):
    raw = await request.body()
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="CSV too large")
    text = raw.decode("utf-8-sig", errors="replace")
    return await run_in_threadpool(svc(request).import_csv, text, newest_first)


@router.post("/data/import/paste", dependencies=[Depends(require_key)])
async def import_paste(request: Request, newest_first: bool = Query(False, description="True if the pasted list shows the newest round first")):
    """Paste rows copied from a results table (one round per line). Nothing is fetched from any website."""
    raw = await request.body()
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="text too large")
    return await run_in_threadpool(svc(request).import_paste, raw.decode("utf-8-sig", errors="replace"), newest_first)


@router.get("/data/stats")
def data_stats(request: Request):
    return svc(request).data_stats()


@router.get("/results")
def results(request: Request, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    return svc(request).results(limit, offset)


@router.post("/results", dependencies=[Depends(require_key)])
def add_result(body: ResultIn, request: Request):
    """validate -> store -> resolve previous prediction -> update live accuracy -> next prediction"""
    return svc(request).add_result(body.number, body.period_id, body.timestamp.isoformat() if body.timestamp else None)


@router.get("/prediction/next")
def prediction_next(request: Request):
    return svc(request).next_prediction()


@router.get("/prediction/history")
def prediction_history(request: Request, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    return svc(request).history(limit, offset)


@router.get("/backtest")
def backtest(request: Request):
    return svc(request).backtest_results()


@router.post("/backtest/run", status_code=202, dependencies=[Depends(require_key)])
def backtest_run(request: Request, background: BackgroundTasks):
    s = svc(request)
    if s.backtest_state["status"] == "running":
        raise HTTPException(status_code=409, detail="backtest already running")
    background.add_task(s.run_backtest)
    return {"status": "started"}


@router.get("/model-performance")
def model_performance(request: Request):
    return svc(request).performance()
