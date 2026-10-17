"""Orchestrates: validate -> store -> resolve previous prediction -> update live accuracy -> predict next.

No betting/deposit/withdrawal/auto-bet functionality exists anywhere in this project; this service only
records data, produces statistical candidates and measures how they perform.
"""
import threading
from typing import Optional
import numpy as np
from app.backtesting.walk_forward import run_walk_forward
from app.database.base import Repository
from app.prediction.engine import PredictionEngine
from app.prediction.signal import evaluate_signal
from app.services import analysis
from app.services.data_service import clean_rows, parse_csv, parse_paste
from app.services.errors import ServiceError, ValidationFailure
from app.utils.constants import BASELINES, METRICS, color_group_of, size_of, COLOR_NAMES
from app.utils.stats import rate_stats

DISCLAIMER = ("Model-generated statistical candidates, not predictions of a guaranteed outcome. Walk-forward validation on "
              "historical data has shown no reliable advantage over random guessing. Nothing here places bets.")


class PredictorService:
    def __init__(self, repo: Repository, engine: PredictionEngine, min_history: int = 100, min_validation_n: int = 300):
        self.repo, self.engine = repo, engine
        self.min_history, self.min_validation_n = min_history, min_validation_n
        self.lock = threading.RLock()
        self.backtest_state = {"status": "idle", "progress": 0, "total": 0, "error": None}

    # ------------------------------------------------------------ helpers
    def _numbers(self) -> np.ndarray:
        return np.array(self.repo.get_numbers(), dtype=int)

    def live_metrics(self) -> dict:
        outs = [o["outcome"] for o in self.repo.all_outcomes()]
        keys = {"top1": "top1_hit", "top3": "top3_hit", "bs": "bs_hit", "color": "color_hit"}
        return {m: rate_stats([o[keys[m]] for o in outs], BASELINES[m]) for m in METRICS}

    def _validation(self) -> Optional[dict]:
        bt = self.repo.latest_backtest()
        if not bt:
            return None
        s = bt["summary"]
        return {"metrics": s["consensus"], "K": s["K"], "data_n": s["data_n"], "run_at": s["created_at"]}

    def current_signal(self) -> dict:
        v = self._validation()
        sig = evaluate_signal(v, self.live_metrics(), min_n=self.min_validation_n)
        sig["validated_on"] = None if not v else {"data_n": v["data_n"], "run_at": v["run_at"]}
        return sig

    # ------------------------------------------------------------ data flow
    def _store(self, items: list) -> list:
        last = self.repo.last_result()
        cleaned = clean_rows(items, last["period_id"] if last else None, self.repo.has_period)
        return self.repo.add_results(cleaned)

    def _resolve(self, row: dict) -> Optional[dict]:
        pred = self.repo.get_prediction_by_target(row["seq"])
        if not pred or pred["status"] != "pending":
            self.repo.expire_pending_except(row["seq"] + 1)
            return None
        a = row["number"]
        outcome = {"actual": a, "top1_hit": pred["top1"] == a, "top3_hit": a in pred["top3"],
                   "bs_hit": pred["size"] == size_of(a), "color_hit": pred["color"] == COLOR_NAMES[color_group_of(a)]}
        self.repo.resolve_prediction(pred["id"], outcome)          # resolve first ...
        self.repo.expire_pending_except(row["seq"] + 1)            # ... then void anything stale
        live = self.live_metrics()
        self.repo.save_snapshot({"n": live["top1"]["n"], **{k: live[k]["rate"] for k in METRICS}})
        return {**pred, "status": "resolved", "outcome": outcome}

    def _next_prediction(self) -> Optional[dict]:
        last = self.repo.last_result()
        if not last or last["seq"] < self.min_history:
            return None
        target = last["seq"] + 1
        existing = self.repo.get_prediction_by_target(target)
        if existing and existing["status"] == "pending":
            return existing
        p = self.engine.predict(self._numbers())
        lp = last["period_id"]
        pred = {**p, "target_seq": target, "target_period": str(int(lp) + 1) if lp and lp.isdigit() else None,
                "signal": self.current_signal()}
        self.repo.save_prediction(pred)
        return self.repo.get_prediction_by_target(target)

    def add_result(self, number, period_id=None, timestamp=None) -> dict:
        with self.lock:
            row = self._store([{"number": number, "period_id": period_id, "timestamp": timestamp}])[0]
            resolved = self._resolve(row)
            nxt = self._next_prediction()
            return {"result": row, "resolved_prediction": resolved, "next_prediction": self._public(nxt),
                    "live_performance": self.live_metrics()}

    def import_rows(self, rows: list) -> dict:
        if not rows:
            raise ValidationFailure("nothing to import: no rows provided")
        with self.lock:
            stored = self._store(rows)
            if not stored:
                raise ValidationFailure("nothing to import: no valid rows provided")
            self._resolve(stored[0])                       # a pending prediction can only target the first new round
            self.repo.expire_pending_except(stored[-1]["seq"] + 1)
            nxt = self._next_prediction()
            return {"imported": len(stored), "total": self.repo.last_result()["seq"], "next_prediction": self._public(nxt)}

    def import_csv(self, text: str, newest_first: bool = False) -> dict:
        return self.import_rows(parse_csv(text, newest_first))

    def import_paste(self, text: str, newest_first: bool = False) -> dict:
        return self.import_rows(parse_paste(text, newest_first))

    # ------------------------------------------------------------ reads
    @staticmethod
    def _public(p: Optional[dict]) -> Optional[dict]:
        if p is None:
            return None
        return {**p, "disclaimer": DISCLAIMER}

    def next_prediction(self) -> dict:
        with self.lock:
            p = self._next_prediction()
        last = self.repo.last_result()
        if p is None:
            return {"available": False, "reason": f"Need at least {self.min_history} results (have {last['seq'] if last else 0}).",
                    "disclaimer": DISCLAIMER}
        return {"available": True, "latest_result": last, **self._public(p)}

    def results(self, limit=50, offset=0) -> dict:
        rows, total = self.repo.list_results(limit, offset)
        return {"total": total, "results": rows}

    def history(self, limit=50, offset=0) -> dict:
        rows, total = self.repo.list_predictions(limit, offset)
        return {"total": total, "predictions": [self._history_row(r) for r in rows]}

    @staticmethod
    def _history_row(r: dict) -> dict:
        o = r.get("outcome")
        result = "PENDING" if not o else ("HIT (Top-1)" if o["top1_hit"] else "Top-3 hit" if o["top3_hit"] else "MISS")
        return {"target_seq": r["target_seq"], "round": r["target_period"] or f"#{r['target_seq']}", "created_at": r["created_at"],
                "prediction": r["top1"], "top3": r["top3"], "size": r["size"], "color": r["color"],
                "signal": (r.get("signal") or {}).get("label"), "actual": o["actual"] if o else None,
                "top3_hit": o["top3_hit"] if o else None, "bs_hit": o["bs_hit"] if o else None,
                "color_hit": o["color_hit"] if o else None, "result": result}

    def data_stats(self) -> dict:
        return analysis.analyze(self._numbers(), self.repo.get_meta())

    def performance(self) -> dict:
        outs = self.repo.all_outcomes()
        live = self.live_metrics()
        keys = {"top1": "top1_hit", "top3": "top3_hit", "bs": "bs_hit", "color": "color_hit"}
        series = {m: [] for m in METRICS}
        for m in METRICS:
            cum = np.cumsum([float(o["outcome"][keys[m]]) for o in outs]) if outs else np.array([])
            step = max(1, len(cum) // 200)
            series[m] = [{"n": i + 1, "rate": float(cum[i] / (i + 1))} for i in range(0, len(cum), step)]
        bt = self.repo.latest_backtest()
        return {"disclaimer": DISCLAIMER, "baselines": BASELINES, "signal": self.current_signal(),
                "live": {"total_predictions": live["top1"]["n"], "metrics": live, "series": series,
                         "note": "Live = predictions made before the actual result arrived. Needs 100+ to mean anything."},
                "backtest": None if not bt else {"id": bt["id"], **bt["summary"]}}

    def backtest_results(self) -> dict:
        bt = self.repo.latest_backtest(with_rows=True)
        return {"state": self.backtest_state, "backtest": bt}

    # ------------------------------------------------------------ backtest (re-evaluation on all stored data)
    def run_backtest(self, use_ml: bool = True) -> dict:
        with self.lock:
            if self.backtest_state["status"] == "running":
                raise ServiceError("a backtest is already running")
            seq = self._numbers()
            self.backtest_state = {"status": "running", "progress": 0, "total": max(0, len(seq) - self.min_history), "error": None}
        try:
            def prog(i, t): self.backtest_state.update(progress=i, total=t)
            res = run_walk_forward(seq, start=self.min_history, refit_every=self.engine.refit_every, use_ml=use_ml, progress=prog)
            self.repo.save_backtest(res["summary"], res["rows"])
            self.backtest_state = {"status": "done", "progress": len(seq), "total": len(seq), "error": None}
            with self.lock:                                   # refresh the signal on the pending prediction
                last = self.repo.last_result()
                if last:
                    self.repo.expire_pending_except(-1)
                    self._next_prediction()
            return res["summary"]
        except Exception as e:                                # noqa: BLE001 - reported through state
            self.backtest_state = {"status": "error", "progress": 0, "total": 0, "error": str(e)}
            raise
