"""Settings come from environment variables / backend/.env. No secrets live in code."""
import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv() -> None:
    p = Path(__file__).resolve().parents[1] / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "mongodb://localhost:27017/wingo")
    admin_api_key: str = os.getenv("ADMIN_API_KEY", "")
    allowed_origins: tuple = tuple(o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8000").split(",") if o.strip())
    auto_seed: bool = os.getenv("AUTO_SEED", "true").lower() == "true"
    seed_csv: str = os.getenv("SEED_CSV", "../data/wingo_transcribed.csv")
    auto_backtest: bool = os.getenv("AUTO_BACKTEST", "true").lower() == "true"
    refit_every: int = int(os.getenv("MODEL_REFIT_EVERY", "10"))
    min_history: int = int(os.getenv("MIN_HISTORY", "100"))
    min_validation_n: int = int(os.getenv("MIN_VALIDATION_N", "300"))


def get_settings() -> Settings:
    return Settings()
