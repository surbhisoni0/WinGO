# WinGo Analysis Platform

A research/analysis platform for WinGo 1-minute results: data validation, statistical baselines, ML models, strict
walk-forward backtesting, live accuracy tracking, and a dashboard.

> **What the evidence says.** On the 802 real rounds available, no model (frequency, recent-frequency, Markov,
> logistic regression, random forest, gradient boosting, or their unweighted consensus) beat random guessing out-of-sample
> after confidence intervals, multiple-testing correction and time-consistency checks. The platform therefore reports
> **NO STRONG SIGNAL**. Candidates it shows are model-generated statistical candidates, **not** guaranteed outcomes.
> The project contains **no** betting, deposit, withdrawal or auto-bet functionality and never will.

## Architecture
```
backend/app/
  main.py                 FastAPI app + static frontend + startup seeding
  api/                    routes.py (REST), schemas.py (pydantic validation)
  services/               predictor_service.py (flow), data_service.py (validation/CSV), analysis.py (tests)
  prediction/             features.py, baselines.py, ml_models.py, engine.py (consensus), signal.py (evidence rules)
  backtesting/            walk_forward.py (strict chronological validation)
  database/               base.py (interface), mongo_repo.py (MongoDB), memory_repo.py (tests)
  scripts/                run_backtest.py, import_csv.py
frontend/                 index.html, css/style.css, js/app.js (no build step, no CDN)
data/                     wingo_transcribed.csv (+ README on its limits)
tests/                    unit tests (unittest)
```
MongoDB collections: `raw_results` (never modified) · `results` (validated) · `predictions` · `prediction_outcomes` ·
`backtest_runs` · `backtest_predictions` · `performance_snapshots`.

### How the signal label works
`prediction/signal.py` — pre-specified rules on walk-forward hit flags of the consensus ranking:
Bonferroni-corrected exact-binomial p < 0.05 (K = models × metrics), Wilson 95% lower bound above baseline,
above baseline in ≥ 3 of 4 time blocks. **Strong** additionally needs confirmation on ≥ 100 *live* rounds that arrived after
the backtest. **Moderate** = without live confirmation. **Weak** = nominal p < 0.05 that does not survive correction.
Otherwise **NO STRONG SIGNAL**. Scores shown are rank scores, never probabilities. Baselines: Top-1 10%, Top-3 30%,
Big/Small 50%, Color 40% (best constant guess).

## Local setup (Windows + VS Code)
1. Install **Python 3.10, 3.11 or 3.12** from python.org (tick *Add Python to PATH*) and **VS Code** with its *Python* extension.
2. Install **MongoDB Community Server** as a Windows service (see *Database: MongoDB* below).
3. In VS Code: *File → Open Folder…* and choose this `wingo-ai-predictor` folder. Open a terminal (*Terminal → New Terminal*).
4. First time only: `setup.bat` (creates `backend\.venv`, installs `backend\requirements.txt`, copies `.env.example` to `.env`).
5. Start the app: `run.bat` — it opens http://localhost:8000. The first start loads `data/wingo_transcribed.csv` and runs the
   walk-forward test in the background (about 1–2 minutes; progress shows in the top-right pill).
6. Run the tests any time: `test.bat`. To debug in VS Code press **F5** (*WinGo: run server*).

Other systems: `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cp .env.example .env && uvicorn app.main:app --reload`

Edit `backend/.env` to change settings (database, `ADMIN_API_KEY`, refit interval). Restart `run.bat` after editing.

## Adding new rounds (instead of connecting to a website)
The app never logs in to, scrapes or calls any betting site. Open the **Add rounds** tab and either paste rows copied from the
game's history list (one round per line, e.g. `5 Big green violet`; tick *newest round is on top* if that is how the list is
ordered), tap a single result, or import a CSV. Rows are checked (number 0–9, size/colour must agree with the number,
no `2.03E+16` round IDs) and nothing is stored if any row is invalid. Only paste rounds **newer** than the last stored one.

## About accuracy targets
The colour pick is evaluated on rounds it had not seen (walk-forward). On the 802 stored rounds the ensemble scored 42.0 % on
colour (95 % range 38.4–45.7 %) against 40 % for always guessing Green or Red. A target such as 80 % is far outside that range,
and every randomness test on the data is consistent with a fair random draw. The dashboard shows this comparison on the
**Predict** tab, and the signal label only changes if the evidence rules below are met.

## Database: MongoDB
The app stores everything in MongoDB (database `wingo`, collections are created automatically). Pick one:
* **On your PC (Windows):** install *MongoDB Community Server* from mongodb.com/try/download/community and keep *Install MongoDB as a Service*
  ticked. It then runs in the background and the default `DATABASE_URL=mongodb://localhost:27017/wingo` works unchanged.
  Optional: *MongoDB Compass* (installed with it) lets you browse the data.
* **Cloud:** create a free cluster on MongoDB Atlas, add your IP under *Network Access*, and put the `mongodb+srv://...` connection
  string in `backend/.env` as `DATABASE_URL`.

If the app says it cannot reach MongoDB, the service is not running (Windows: *Services → MongoDB Server → Start*) or `DATABASE_URL` is wrong.
An old `backend/.env` that still has a `sqlite:///` or `postgresql` URL must be edited; those are no longer supported.

**Tests:** `PYTHONPATH=backend python -m unittest discover -s tests -v`

## API (interactive docs at `/docs`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | counts, engine version, backtest state |
| POST | `/api/data/import` | JSON `{"rows":[{"number":5,"period_id":"…","timestamp":"…"}]}` oldest first, all-or-nothing |
| POST | `/api/data/import/csv?newest_first=` | raw CSV body (`number` required; `period_id`, `timestamp` optional) |
| GET | `/api/data/stats` | analysis: distributions, randomness tests, data quality |
| GET | `/api/results?limit&offset` | stored results, newest first |
| POST | `/api/results` | add a result → validate → store → resolve previous prediction → update live accuracy → next prediction |
| GET | `/api/prediction/next` | candidates, Big/Small, Color, signal label, per-model tops, ranking scores |
| GET | `/api/prediction/history` | Round · Prediction · Actual · Top-3 hit · Big/Small · Color · Result |
| GET | `/api/backtest` · POST `/api/backtest/run` | stored walk-forward results · re-evaluate on all stored data (202) |
| GET | `/api/model-performance` | live + backtest metrics, baselines, CIs, series, signal |

POST endpoints require header `X-API-Key` when `ADMIN_API_KEY` is set. Period IDs must be text digits (scientific
notation such as `2.03E+16` is rejected), unique, and increasing.

## Retraining / re-evaluating
Models refit automatically every `MODEL_REFIT_EVERY` new results, using only earlier rounds. After importing more
history run `python -m app.scripts.run_backtest` (or the button on the Performance tab); the signal is recomputed from the new evidence.

## Deployment
* Use MongoDB with authentication enabled (Atlas does this for you), and **set `ADMIN_API_KEY`** (writes are otherwise open).
* Run `uvicorn app.main:app --host 0.0.0.0 --port 8000` behind an HTTPS reverse proxy (Caddy/nginx).
  Set `ALLOWED_ORIGINS` to your domain. Run a single worker (`uvicorn` default) — the model cache is per process.
* Do not commit `.env`; it is git-ignored. Live data: implement only an official/licensed API as a new ingestion
  script calling `POST /api/results`; do not scrape around logins, CAPTCHAs or anti-bot controls.

## Known limits
Only 802 rounds and no timestamps/IDs, so only large effects are detectable and chronological order is assumed
(see `data/README.md`). A fair random game has no learnable pattern; this system exists to measure that honestly.
