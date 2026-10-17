"""FastAPI entry point:  uvicorn app.main:app --reload   (run from backend/)"""
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.api.routes import router
from app.config import get_settings
from app.database.factory import create_repository
from app.prediction.engine import ENGINE_VERSION, PredictionEngine
from app.services.errors import ServiceError
from app.services.predictor_service import PredictorService

log = logging.getLogger("wingo")
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    repo = create_repository(s.database_url); repo.init()
    service = PredictorService(repo, PredictionEngine(refit_every=s.refit_every), s.min_history, s.min_validation_n)
    app.state.settings, app.state.service = s, service
    seed = Path(s.seed_csv)
    if s.auto_seed and repo.last_result() is None and seed.exists():
        log.info("seeding from %s", seed)
        service.import_csv(seed.read_text(encoding="utf-8"))
    last = repo.last_result()
    if s.auto_backtest and last and last["seq"] > s.min_history + 50 and repo.latest_backtest() is None:
        threading.Thread(target=service.run_backtest, daemon=True).start()     # ~1-2 min, results appear when done
    yield


app = FastAPI(title="WinGo Analysis Platform", version=ENGINE_VERSION, lifespan=lifespan,
              description="Research/analysis tool. Statistical candidates only - no guarantees, no betting functionality.")
app.add_middleware(CORSMiddleware, allow_origins=list(get_settings().allowed_origins), allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type", "X-API-Key"])


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError):
    return JSONResponse(status_code=exc.status, content={"error": str(exc)})


app.include_router(router)
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
