"use strict";
/* WinGo Analysis Platform - dashboard. All API text is rendered with textContent (never innerHTML). */
const $ = (s, r = document) => r.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const NAMES = { CumFreq: "Frequency", Recent50: "Recent pattern (50)", Markov1: "Transition (order 1)", Markov2: "Transition (order 2)",
  LogReg: "ML · Logistic regression", RandForest: "ML · Random forest", HistGB: "ML · Gradient boosting", Consensus: "Ensemble (unweighted consensus)" };
const METRICS = [["color", "Colour"], ["bs", "Big/Small"], ["top1", "Number (Top-1)"], ["top3", "Number (Top-3)"]];
const LINE_COLORS = { top1: "#2dd4bf", top3: "#5aa2ff", bs: "#f5b84b", color: "#b58cff" };
const COLOR_DETAIL = ["red+violet", "green", "red", "green", "red", "green+violet", "red", "green", "red", "green"];

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) e[k] = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
const ballClass = n => (n === 0 ? "rv" : n === 5 ? "gv" : [1, 3, 7, 9].includes(n) ? "g" : "r");
const ball = (n, cls = "") => el("span", { class: `ball ${ballClass(n)} ${cls}`.trim(), title: `${n} · ${COLOR_DETAIL[n]} · ${n >= 5 ? "Big" : "Small"}` }, n);
const pct = x => (x == null ? "—" : (100 * x).toFixed(1) + "%");
const pp = x => (x >= 0 ? "+" : "") + (100 * x).toFixed(1);
const clear = e => { e.replaceChildren(); return e; };
const setBody = (card, ...kids) => { const h = card.querySelector("h2"); card.replaceChildren(h, ...kids.flat()); };

let API_KEY = () => $("#key").value.trim();
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.method === "POST" && API_KEY()) headers["X-API-Key"] = API_KEY();
  const r = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await r.json(); } catch (_) { /* non-JSON */ }
  if (!r.ok) {
    const d = body && (body.error || body.detail);
    throw new Error(Array.isArray(d) ? d.map(x => x.msg).join("; ") : d || `HTTP ${r.status}`);
  }
  return body;
}

/* ---------------------------------------------------------------- charts */
function barChart(host, labels, values, { expected = null, fmt = pct, colors = null, max = null } = {}) {
  const W = 600, H = 220, L = 34, B = 26, T = 12, n = values.length;
  const top = max || Math.max(...values, expected || 0) * 1.18 || 1;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  const bw = (W - L) / n, y = v => T + (H - T - B) * (1 - v / top);
  [0, .5, 1].forEach(f => { s.append(svg("line", { x1: L, x2: W, y1: y(top * f), y2: y(top * f), stroke: "#1f2c4d" }), svg("text", { x: 2, y: y(top * f) + 3 }, fmt(top * f))); });
  values.forEach((v, i) => {
    s.append(svg("rect", { x: L + i * bw + bw * .18, y: y(v), width: bw * .64, height: Math.max(0, H - B - y(v)), rx: 4, fill: colors ? colors[i] : "#2dd4bf" }));
    s.append(svg("text", { x: L + i * bw + bw / 2, y: H - 9, "text-anchor": "middle", class: "lbl" }, labels[i]));
    s.append(svg("text", { x: L + i * bw + bw / 2, y: y(v) - 4, "text-anchor": "middle" }, fmt(v)));
  });
  if (expected != null) s.append(svg("line", { x1: L, x2: W, y1: y(expected), y2: y(expected), stroke: "#f5b84b", "stroke-dasharray": "5 4" }));
  clear(host).append(s);
}
function lineChart(host, series, emptyMsg) {
  const pts = series.flatMap(s => s.points);
  if (!pts.length) { clear(host).append(el("p", { class: "muted" }, emptyMsg)); return; }
  const W = 600, H = 230, L = 40, B = 20, T = 10, m = Math.max(0.02, ...pts.map(Math.abs)) * 1.15;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img" });
  const y = v => T + (H - T - B) * (1 - (v + m) / (2 * m));
  [-m, 0, m].forEach(v => s.append(svg("line", { x1: L, x2: W, y1: y(v), y2: y(v), stroke: v === 0 ? "#f5b84b" : "#1f2c4d", "stroke-dasharray": v === 0 ? "5 4" : "" }), svg("text", { x: 2, y: y(v) + 3 }, pp(v))));
  series.forEach(sr => {
    const n = sr.points.length, x = i => L + (W - L) * (n === 1 ? .5 : i / (n - 1));
    s.append(svg("polyline", { fill: "none", stroke: sr.color, "stroke-width": 2, points: sr.points.map((v, i) => `${x(i)},${y(v)}`).join(" ") }));
  });
  clear(host).append(s, el("div", { class: "legend" }, series.map(sr => el("span", {}, el("i", { style: `background:${sr.color}` }), sr.name)), el("span", {}, "y-axis: points above (+) or below (−) the random baseline")));
}

/* ---------------------------------------------------------------- dashboard (colour-first) */
let perfCache = null;
const GROUPS = ["Green", "Red", "Violet"], GROUP_OF = [2, 0, 1, 0, 1, 2, 1, 0, 1, 0];   // same mapping as the backend (index = number)
const GROUP = n => GROUPS[GROUP_OF[n]];
const DOT = n => (n === 0 ? "rv" : n === 5 ? "gv" : GROUP(n).toLowerCase());
const dot = n => el("span", { class: `dot ${DOT(n)}`, title: `${n} · ${COLOR_DETAIL[n]} · ${n >= 5 ? "Big" : "Small"}` });
const groupDot = g => el("span", { class: `dot ${g.toLowerCase()}` });
const pill = (g, text) => el("span", { class: "pill" }, groupDot(g), text || g);
function signalBadge(sig) { return el("span", { class: `sig ${sig.level}` }, sig.label); }
function meter(label, value, cls, note) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, value * 100));
  return el("div", { class: "meter" }, el("div", { class: "mlabel" }, el("span", {}, label), el("b", {}, pct(value))),
    el("div", { class: "track" }, el("i", { class: cls || "", style: `width:${w}%` })), note ? el("div", { class: "bar-note" }, note) : null);
}
function pickFromScores(sc) {
  const t = [0, 0, 0]; sc.forEach((v, n) => { t[GROUP_OF[n]] += v; });
  return GROUPS[t.indexOf(Math.max(...t))];
}

function renderNext(p, perf, stats) {
  const pick = $("#pick"), reality = $("#reality"), models = $("#models");
  if (!p.available) { [pick, reality, models].forEach(c => setBody(c, el("p", { class: "muted" }, p.reason))); return; }
  const sig = p.signal, none = sig.level === "none", bt = perf && perf.backtest, c = bt && bt.consensus.color;
  setBody(pick,
    el("div", { class: "pickrow" }, el("span", { class: `orb ${p.color.toLowerCase()} ${none ? "dim" : ""}` }),
      el("div", {}, el("div", { class: "pickname" }, p.color), el("div", { class: "muted" }, `for round ${p.target_period || "#" + p.target_seq}`),
        el("div", { style: "margin-top:8px" }, signalBadge(sig)))),
    none ? el("div", { class: "nosig" }, el("strong", {}, "No proven edge. "), "On rounds it had not seen, this pick did no better than guessing a colour at random.") : null,
    el("details", {}, el("summary", { class: "muted" }, "Why this label?"),
      el("ul", { class: "muted" }, (sig.reasons.length ? sig.reasons : ["Evidence rules satisfied — see the Accuracy tab."]).map(r => el("li", {}, r)),
        sig.validated_on ? el("li", {}, `Tested on ${sig.validated_on.data_n} rounds (${sig.validated_on.run_at}).`) : null)),
    el("p", { class: "bar-note" }, p.disclaimer));
  const live = perf && perf.live.metrics.color;
  setBody(reality,
    meter("Your target", 0.8, "t"),
    meter(c ? `Measured on ${c.n} unseen rounds` : "Measured", c && c.rate, "", c ? `95% range ${pct(c.lo)} – ${pct(c.hi)}` : "No test yet — open the Accuracy tab and run the walk-forward test."),
    meter("Random guess (always Green or Red)", 0.4, "b", "what you get with no information at all"),
    live && live.n ? meter(`Live picks (${live.n})`, live.rate, "", live.n < 100 ? "fewer than 100 — too few to mean anything" : null) : null,
    c ? el("div", { class: "verdict" }, `${pct(c.rate)} measured. ${c.hi < 0.8 ? "80% is far outside that range. " : ""}${stats && stats.interpretation ? stats.interpretation : ""}`) : null);
  const rows = Object.entries(p.model_scores).map(([k, sc]) => el("tr", {}, el("td", {}, NAMES[k] || k), el("td", {}, pill(pickFromScores(sc))),
    el("td", {}, bt && bt.models[k] ? pct(bt.models[k].color.rate) : "—")));
  rows.push(el("tr", {}, el("td", {}, el("strong", {}, NAMES.Consensus)), el("td", {}, pill(p.color)), el("td", {}, c ? pct(c.rate) : "—")));
  setBody(models, el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Model"), el("th", {}, "Picks"), el("th", {}, "Past accuracy"))), el("tbody", {}, rows))),
    el("p", { class: "bar-note" }, "Past accuracy is on unseen rounds. A random guess scores 40%."));
  if (stats && stats.color_groups) {
    const exp = { Green: 0.4, Red: 0.4, Violet: 0.2 };
    setBody($("#mix"), ...GROUPS.map(g => meter(g, stats.color_groups[g] / stats.n, g.toLowerCase(), `expected ${pct(exp[g])}`)));
  }
}
async function loadDash() {
  try {
    const [p, r, perf, stats] = await Promise.all([api("/api/prediction/next"), api("/api/results?limit=40"), api("/api/model-performance"),
      api("/api/data/stats").catch(() => null)]);
    perfCache = perf; renderNext(p, perf, stats);
    clear($("#strip")).append(...r.results.slice().reverse().map(x => dot(x.number)));
  } catch (e) { $("#pick").append(el("p", { class: "msg err" }, e.message)); }
}

/* ---------------------------------------------------------------- history */
let histOffset = 0; const PAGE = 25;
async function loadHistory(reset) {
  if (reset) { histOffset = 0; clear($("#hist tbody")); }
  const h = await api(`/api/prediction/history?limit=${PAGE}&offset=${histOffset}`); histOffset += h.predictions.length;
  $("#hist tbody").append(...h.predictions.map(r => el("tr", {}, el("td", {}, r.round), el("td", {}, pill(r.color)),
    el("td", {}, r.actual == null ? "—" : pill(GROUP(r.actual), `${GROUP(r.actual)} (${r.actual})`)),
    el("td", {}, r.actual == null ? el("span", { class: "pend" }, "PENDING") : r.color_hit ? el("span", { class: "ok" }, "HIT ✓") : el("span", { class: "no" }, "MISS ✗")))));
  $("#more").style.display = histOffset >= h.total ? "none" : "";
}

/* ---------------------------------------------------------------- performance */
function kpi(label, m) {
  return el("div", { class: "kpi" }, el("span", {}, label), el("b", {}, pct(m.rate)),
    el("i", {}, m.n ? `baseline ${pct(m.baseline)} · 95% CI ${pct(m.lo)}–${pct(m.hi)}` : `baseline ${pct(m.baseline)}`));
}
function verdict(m) {
  const above = ["top1", "top3", "bs", "color"].filter(k => m[k].lo > m[k].baseline);
  return above.length ? el("span", { class: "pend" }, "nominal edge on " + above.join(", ") + " — check corrected p") : el("span", { class: "muted" }, "within noise of baseline");
}
function renderPerf(perf) {
  const live = perf.live;
  setBody($("#perf-live"), el("div", { class: "kpis" }, el("div", { class: "kpi" }, el("span", {}, "Total predictions"), el("b", {}, live.total_predictions), el("i", {}, live.note)),
    METRICS.map(([k, n]) => kpi(n, live.metrics[k]))), el("p", { class: "bar-note" }, `Current signal: ${perf.signal.label}. ${perf.signal.reasons[0] || ""}`));
  const bt = perf.backtest, card = $("#perf-bt");
  if (!bt) { setBody(card, el("p", { class: "muted" }, "No walk-forward validation stored yet."), runBtn()); return; }
  const rows = Object.entries(bt.models).map(([k, m]) => el("tr", {}, el("td", {}, k === "Consensus" ? el("strong", {}, NAMES[k]) : NAMES[k] || k),
    METRICS.map(([mk]) => el("td", {}, `${pct(m[mk].rate)} `, el("span", { class: "muted" }, `[${pct(m[mk].lo)}–${pct(m[mk].hi)}]`))), el("td", {}, m.top1.n), el("td", {}, verdict(m))));
  rows.unshift(el("tr", {}, el("td", {}, el("em", {}, "Random baseline")), METRICS.map(([mk]) => el("td", {}, pct(bt.baselines[mk]))), el("td", {}, "—"), el("td", {}, "reference")));
  setBody(card, el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Model"), METRICS.map(([, n]) => el("th", {}, n + " [95% CI]")), el("th", {}, "Predictions"), el("th", {}, "vs baseline"))), el("tbody", {}, rows))),
    el("p", { class: "bar-note" }, `Backtest on ${bt.data_n} stored rounds · ${bt.n_predictions} predictions · ${bt.K} model×metric tests (used for multiple-testing correction) · run ${bt.created_at}. Color baseline = best constant guess (40%).`), runBtn());
  const names = { top1: "Top-1", top3: "Top-3", bs: "Big/Small", color: "Color" };
  lineChart($("#chart-roll"), METRICS.map(([k]) => ({ name: names[k], color: LINE_COLORS[k], points: (bt.consensus_rolling[k] || []).map(v => v - bt.baselines[k]) })), "Not enough backtest data.");
  lineChart($("#chart-live"), METRICS.map(([k]) => ({ name: names[k], color: LINE_COLORS[k], points: live.series[k].map(p => p.rate - perf.baselines[k]) })), "No live predictions have been resolved yet. Add new results to build this.");
}
function runBtn() {
  const b = el("button", { class: "btn ghost", onclick: async () => {
    b.disabled = true; try { await api("/api/backtest/run", { method: "POST" }); b.textContent = "Running… (1–2 min)"; pollStatus(); } catch (e) { b.disabled = false; alert(e.message); } } }, "Re-run validation on all stored data");
  return b;
}
async function loadPerf() { perfCache = await api("/api/model-performance"); renderPerf(perfCache); }

/* ---------------------------------------------------------------- analysis */
let statsCache = null;
function renderRecentFreq() {
  const a = statsCache; if (!a || !a.recent_frequency) return;
  const w = $("#win").value; barChart($("#chart-recent"), [...Array(10).keys()], a.recent_frequency[w], { expected: 0.1, colors: [...Array(10).keys()].map(barColor) });
}
const barColor = n => (n === 0 ? "#a45bd6" : n === 5 ? "#5cae8f" : [1, 3, 7, 9].includes(n) ? "#22a45d" : "#d63b3b");
async function loadAnalysis() {
  const a = statsCache = await api("/api/data/stats");
  if (!a.counts) { $("#tests").textContent = a.message; return; }
  barChart($("#chart-dist"), [...Array(10).keys()], a.frequency, { expected: 0.1, colors: [...Array(10).keys()].map(barColor) });
  renderRecentFreq();
  const bs = a.big_small; barChart($("#chart-bs"), ["Small (0-4)", "Big (5-9)"], [bs.Small / a.n, bs.Big / a.n], { expected: 0.5, colors: ["#5aa2ff", "#f5b84b"] });
  const cg = a.color_groups; barChart($("#chart-color"), ["Green", "Red", "Violet (0,5)"], [cg.Green / a.n, cg.Red / a.n, cg.Violet / a.n], { expected: null, colors: ["#22a45d", "#d63b3b", "#8b5cf6"] });
  setBody($("#tests").closest(".card"), el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Test"), el("th", {}, "p-value / value"), el("th", {}, "Reading"))),
    el("tbody", {}, Object.values(a.tests).map(t => el("tr", {}, el("td", {}, t.name), el("td", {}, t.p != null ? t.p.toFixed(3) : `${t.value.toFixed(3)} (±${t.band.toFixed(3)})`),
      el("td", {}, t.verdict || (t.within_band ? "consistent with random" : "unusual - verify data"), t.note ? el("div", { class: "muted", style: "font-size:11px" }, t.note) : null)))))),
    el("p", { class: "bar-note" }, a.interpretation), el("div", { id: "tests" }));
  const q = a.data_quality;
  clear($("#dq")).append(el("dl", { class: "kv" }, ...Object.entries({ "Total records": q.total, "Unique period IDs": q.unique_periods ?? "—", "Missing period IDs": q.missing_period ?? "—", "Missing timestamps": q.missing_timestamp ?? "—",
    "Duplicate periods": q.duplicate_periods ?? "—", "Chronological (by period)": q.chronological == null ? "cannot verify (no period IDs)" : q.chronological ? "yes" : "NO", "Longest same-number streak": a.max_same_number_streak }).flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])));
}

/* ---------------------------------------------------------------- add result / import */
let picked = null;
function buildPad() {
  const pad = $("#pad"), submit = el("button", { class: "btn", id: "submit", disabled: true }, "Submit result");
  for (let n = 0; n < 10; n++) pad.append(el("button", { type: "button", "aria-label": `number ${n}`, onclick: () => { picked = n; submit.disabled = false; submit.textContent = `Submit result ${n}`;
    pad.querySelectorAll(".ball").forEach((b, i) => { b.style.outline = i === n ? "3px solid #2dd4bf" : "none"; }); } }, ball(n, "big")));
  pad.after(submit);
  submit.onclick = async () => {
    const msg = $("#addmsg"); msg.className = "msg"; msg.textContent = "";
    const body = { number: picked }; if ($("#period").value.trim()) body.period_id = $("#period").value.trim(); if ($("#ts").value) body.timestamp = $("#ts").value;
    submit.disabled = true;
    try {
      const r = await api("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const o = r.resolved_prediction && r.resolved_prediction.outcome;
      msg.className = "msg good";
      msg.textContent = `Saved as round #${r.result.seq}. ` + (o ? `Previous pick ${r.resolved_prediction.color} vs actual ${GROUP(o.actual)} (${o.actual}): ${o.color_hit ? "hit" : "miss"}.` : "No pending pick to compare.");
      picked = null; $("#period").value = ""; submit.textContent = "Submit result"; pad.querySelectorAll(".ball").forEach(b => { b.style.outline = "none"; });
      loadStatus(); loadDash();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; submit.disabled = false; }
  };
  $("#dopaste").onclick = async () => {
    const msg = $("#pastemsg"); msg.className = "msg"; msg.textContent = "";
    const text = $("#paste").value;
    if (!text.trim()) { msg.className = "msg err"; msg.textContent = "Paste at least one round first."; return; }
    try {
      const r = await api(`/api/data/import/paste?newest_first=${$("#pnewest").checked}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: text });
      msg.className = "msg good"; msg.textContent = `Imported ${r.imported} rounds (total ${r.total}). Re-run the test on the Accuracy tab to include them.`;
      $("#paste").value = ""; loadStatus(); loadDash();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
  };
  $("#doimport").onclick = async () => {
    const f = $("#csv").files[0], msg = $("#impmsg"); msg.className = "msg"; msg.textContent = "";
    if (!f) { msg.className = "msg err"; msg.textContent = "Choose a CSV file first."; return; }
    try {
      const r = await api(`/api/data/import/csv?newest_first=${$("#newest").checked}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text() });
      msg.className = "msg good"; msg.textContent = `Imported ${r.imported} rows (total ${r.total}). Re-run validation from the Performance tab.`; loadStatus(); loadDash();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
  };
}

/* ---------------------------------------------------------------- shell */
async function loadStatus() {
  try {
    const s = await api("/api/status"), b = s.backtest;
    $("#status").textContent = `${s.results} rounds · engine v${s.engine_version} · validation: ${b.status}${b.status === "running" ? ` ${b.progress}/${b.total}` : ""}`;
    return b.status;
  } catch (e) { $("#status").textContent = "API unreachable"; }
}
async function pollStatus() {
  const st = await loadStatus();
  if (st === "running") setTimeout(pollStatus, 4000); else { loadPerf(); loadDash(); }
}
function init() {
  $("#tabs").addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b === t));
    document.querySelectorAll(".tab").forEach(s => s.classList.toggle("on", s.id === "tab-" + t.dataset.tab));
    ({ history: () => loadHistory(true), perf: loadPerf, analysis: loadAnalysis })[t.dataset.tab]?.();
  });
  $("#more").onclick = () => loadHistory(false);
  $("#win").onchange = renderRecentFreq;
  buildPad(); pollStatus(); loadDash();
}
if (typeof document !== "undefined" && document.getElementById) init();
