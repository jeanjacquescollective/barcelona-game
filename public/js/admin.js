// ─── STATE ────────────────────────────────────────────────────────────────────
let adminPw        = "";
let wsState        = null;    // handle returned by makeWS (common.js)
let allTeams       = [];
let activeQ        = null;
let selectedPreset = null;
let presets        = [];
let history        = [];
let allUploads     = [];
let missions       = [];

function setTextForAll(selector, value) {
  document.querySelectorAll(selector).forEach((el) => {
    el.textContent = value;
  });
}

function setHtmlForAll(selector, value) {
  document.querySelectorAll(selector).forEach((el) => {
    el.innerHTML = value;
  });
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
document.querySelector("#pw-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const pw  = document.querySelector("#pw-input").value;
  const res = await fetch("/api/admin/auth", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    adminPw = pw;
    document.querySelector("#login-screen").style.display = "none";
    document.querySelector("#app").style.display          = "block";
    init();
  } else {
    document.querySelector("#login-error").style.display = "block";
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  presets    = await adminApi("GET", "/api/admin/presets");
  history    = await adminApi("GET", "/api/admin/history");
  missions   = await fetch("/api/missions").then((r) => r.json());
  allUploads = await fetch("/api/uploads").then((r) => r.json());
  renderPresets();
  renderHistory();
  // makeWS is provided by common.js
  wsState = makeWS("ws-dot", "ws-txt", handleWsMessage);
  checkSupabase();
}

// ─── WEBSOCKET HANDLER ────────────────────────────────────────────────────────
function handleWsMessage(d) {
  if (d.type === "init") {
    allTeams   = d.teams;
    allUploads = d.uploads || [];
    if (d.question) { activeQ = d.question; renderActiveQ(); }
    renderLB();
    renderFeed();

  } else if (d.type === "teams_update") {
    allTeams = d.teams;
    renderLB();

  } else if (d.type === "answer_received") {
    document.querySelector("#answer-count").textContent =
      d.count + " antwoord" + (d.count === 1 ? "" : "en");
    showToast(`${d.teamName} heeft geantwoord`, "ok");

  } else if (d.type === "question_closed") {
    activeQ  = null;
    renderActiveQ();
    renderResults(d);
    allTeams = d.teams;
    renderLB();

  } else if (d.type === "reset") {
    allTeams = [];
    activeQ  = null;
    history  = [];
    renderLB();
    renderActiveQ();
    renderHistory();

  } else if (d.type === "new_upload") {
    allUploads.unshift(d.upload);
    renderFeed();
    showToast(`${d.teamName} uploadde een bestand!`, "ok");
  }
}

// ─── ADMIN API ────────────────────────────────────────────────────────────────
function adminApi(method, path, body) {
  const opts = {
    method,
    headers: {
      "Content-Type":    "application/json",
      "x-admin-password": adminPw,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts).then((r) => r.json());
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
function addEventListeners() {
  document.querySelector("#login-button").addEventListener("click", doLogin);
  document.querySelector("#reset-button").addEventListener("click", doReset);
  document.querySelector("#close-question-button").addEventListener("click", closeQuestion);
  document.querySelector("#q-type").addEventListener("change", toggleOptions);
  document.querySelector("#push-preset-button").addEventListener("click", pushPreset);
  document.querySelector("#push-custom-button").addEventListener("click", pushCustom);

  document.querySelectorAll(".tabs .tab").forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.choice)),
  );
  document.querySelectorAll(".nav-btn").forEach((t) =>
    t.addEventListener("click", (e) => switchPanel(t.dataset.panel, e)),
  );
  document.querySelectorAll(".panel-tab[data-panel]").forEach((t) =>
    t.addEventListener("click", (e) => switchPanel(t.dataset.panel, e)),
  );
}

// ─── PANEL / TAB SWITCHING ────────────────────────────────────────────────────
function switchPanel(name, e) {
  document.querySelectorAll(".panel-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel-content").forEach((p) => p.classList.remove("active"));
  if (e) e.currentTarget.classList.add("active");
  document.querySelector(`#panel-${name}`).classList.add("active");
}

// Panel tabs registered at top-level too (for tabs not inside .nav-btn)
document.querySelectorAll(".tab[data-panel]").forEach((t) =>
  t.addEventListener("click", (e) => switchPanel(t.dataset.panel, e)),
);

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
  event.target.classList.add("active");
  document.querySelector("#tab-" + name).classList.add("active");
}

// ─── FEED ─────────────────────────────────────────────────────────────────────
function renderFeed() {
  const el = document.querySelector("#admin-feed-list");
  document.querySelector("#feed-count").textContent = allUploads.length;
  setTextForAll("#feed-count-inner", allUploads.length);
  if (!allUploads.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px">Nog geen uploads.</div>';
    return;
  }
  el.innerHTML = allUploads
    .map((u) => {
      const mission = missions.find((m) => m.id === u.missionId);
      const isVideo = /\.(mp4|mov|webm)$/i.test(u.filename);
      return `
        <div style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:10px;overflow:hidden">
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface)">
            <div style="width:8px;height:8px;border-radius:50%;background:${u.teamColor};flex-shrink:0"></div>
            <div style="font-weight:600;font-size:13px;flex:1">${escHtml(u.teamName)}</div>
            <div style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">${mission ? `#${mission.id} ${escHtml(mission.title)}` : ""}</div>
            <div style="font-size:11px;color:var(--muted)">${formatTime(u.timestamp)}</div>
          </div>
          <div style="background:#000;text-align:center">
            ${isVideo
              ? `<video src="${u.url}" controls playsinline style="max-width:100%;max-height:220px"></video>`
              : `<img src="${u.url}" alt="upload" style="max-width:100%;max-height:220px;object-fit:contain">`}
          </div>
        </div>`;
    })
    .join("");
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
function renderLB() {
  const countText = allTeams.length + " team" + (allTeams.length === 1 ? "" : "s");
  setTextForAll("#team-count", countText);
  if (!allTeams.length) {
    setHtmlForAll(
      "#lb-list",
      '<div style="color:var(--muted);font-size:13px">Nog geen teams.</div>',
    );
    return;
  }
  const ranks = ["gold", "silver", "bronze"];
  const markup = allTeams
    .map((t, i) => `
      <div class="lb-row">
        <div class="lb-rank ${ranks[i] || ""}">${i + 1}</div>
        <div class="lb-dot" style="background:${t.color}"></div>
        <div style="flex:1">
          <div class="lb-name">${escHtml(t.name)}</div>
          <div class="lb-sub">${t.completedMissions.length} opdrachten</div>
        </div>
        <div class="lb-score">${t.score}</div>
        <div class="score-adj">
          <button class="adj-btn" onclick="adjScore('${t.id}', 10)"  title="+10">+</button>
          <button class="adj-btn" onclick="adjScore('${t.id}', -10)" title="-10">−</button>
        </div>
      </div>`)
    .join("");
  setHtmlForAll("#lb-list", markup);
}

async function adjScore(teamId, delta) {
  await adminApi("POST", `/api/admin/teams/${teamId}/score`, { delta });
}

// ─── PRESETS ──────────────────────────────────────────────────────────────────
function renderPresets() {
  document.querySelector("#preset-grid").innerHTML = presets
    .map((p, i) => `
      <div class="preset-card" id="pc-${i}" onclick="selectPreset(${i})">
        <div class="preset-type">${p.type === "mcq" ? "4 opties" : "open"}</div>
        <div class="preset-q">${escHtml(p.question)}</div>
        <div class="preset-pts">+${p.pts} pt</div>
      </div>`)
    .join("");
}

function selectPreset(i) {
  document.querySelectorAll(".preset-card").forEach((c) => c.classList.remove("selected"));
  document.querySelector("#pc-" + i).classList.add("selected");
  selectedPreset = i;
  document.querySelector("#push-preset-button").disabled = false;
}

async function pushPreset() {
  if (selectedPreset === null) return;
  if (activeQ && !confirm("Er is al een actieve vraag. Toch vervangen?")) return;
  await adminApi("POST", "/api/admin/question", { presetIndex: selectedPreset });
  activeQ = presets[selectedPreset];
  renderActiveQ();
  showToast("Vraag gepusht!", "ok");
  selectedPreset = null;
  document.querySelectorAll(".preset-card").forEach((c) => c.classList.remove("selected"));
  document.querySelector("#push-preset-button").disabled = true;
}

// ─── CUSTOM QUESTION ──────────────────────────────────────────────────────────
function toggleOptions() {
  const type = document.querySelector("#q-type").value;
  document.querySelector("#options-wrap").style.display = type === "mcq"   ? "block" : "none";
  document.querySelector("#q-answer").style.display    = type === "image"  ? "none"  : "block";
}

async function pushCustom() {
  const type     = document.querySelector("#q-type").value;
  const question = document.querySelector("#q-question").value.trim();
  const answer   = document.querySelector("#q-answer").value.trim();
  const pts      = parseInt(document.querySelector("#q-pts").value) || 20;

  if (!question || !answer) return showToast("Vul vraag en antwoord in", "err");

  let options = [];
  if (type === "mcq") {
    options = ["opt-a", "opt-b", "opt-c", "opt-d"]
      .map((id) => document.getElementById(id).value.trim())
      .filter(Boolean);
    if (options.length < 2) return showToast("Voeg minstens 2 opties in", "err");
  }
  if (type === "image") options = null;

  if (activeQ && !confirm("Er is al een actieve vraag. Toch vervangen?")) return;
  await adminApi("POST", "/api/admin/question", { type, question, options, answer, pts });
  renderActiveQ();
  showToast("Vraag gepusht!", "ok");
}

// ─── ACTIVE QUESTION ──────────────────────────────────────────────────────────
function renderActiveQ() {
  const sec  = document.querySelector("#active-section");
  const disp = document.querySelector("#active-q-display");
  if (!activeQ) { sec.style.display = "none"; return; }
  sec.style.display = "block";
  document.querySelector("#answer-count").textContent = "0 antwoorden";
  const opts = activeQ.options?.length
    ? `<div class="aq-options">${activeQ.options.map((o) => `<div class="aq-opt">${escHtml(o)}</div>`).join("")}</div>`
    : "";
  disp.innerHTML = `
    <div class="aq-label">Actieve vraag · ${activeQ.type === "mcq" ? "Multiple choice" : "Open"} · +${activeQ.pts} pt</div>
    <div class="aq-question">${escHtml(activeQ.question)}</div>
    ${opts}`;
}

async function closeQuestion() {
  const res = await adminApi("POST", "/api/admin/question/close");
  if (res.error) return showToast(res.error, "err");
  history = await adminApi("GET", "/api/admin/history");
  renderHistory();
  showToast("Vraag gesloten, punten toegekend!", "ok");
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────
function isBase64Image(s) {
  return typeof s === "string" && s.startsWith("data:image/");
}

function renderResults(d) {
  const sec = document.querySelector("#result-section");
  sec.style.display = "block";
  document.querySelector("#result-answer-pill").textContent = "Antwoord: " + d.answer;

  document.querySelector("#result-list").innerHTML = d.results.length
    ? d.results
        .map((r) => {
          if (isBase64Image(r.answer)) {
            return `<img src="${r.answer}" alt="Uploaded image" style="max-width:200px;max-height:100px;border-radius:5px">`;
          }
          return `
            <div class="result-row ${r.correct ? "correct" : "wrong"}">
              <div class="lb-dot" style="background:${r.teamColor}"></div>
              <div class="result-name">${escHtml(r.teamName)}</div>
              <div class="result-answer">${escHtml(r.answer)}</div>
              <div class="result-pts ${r.awarded > 0 ? "pos" : "zero"}">${r.awarded > 0 ? "+" + r.awarded : "✗"}</div>
            </div>`;
        })
        .join("")
    : '<div style="color:var(--muted);font-size:13px">Niemand heeft geantwoord.</div>';
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
function renderHistory() {
  setTextForAll("#hist-count", history.length);
  document.querySelector("#hist-list").innerHTML = history.length
    ? history
        .map((h) => `
          <div class="hist-item">
            <div class="hist-q">${escHtml(h.question)}</div>
            <div class="hist-ans">Antwoord: ${escHtml(h.answer)} · ${h.results?.length || 0} antw.</div>
          </div>`)
        .join("")
    : '<div style="color:var(--muted);font-size:13px">Nog geen gesloten vragen.</div>';
}

// ─── RESET ────────────────────────────────────────────────────────────────────
async function doReset() {
  if (!confirm("Alles wissen? Teams, scores, uploads en vragen worden verwijderd.")) return;
  await adminApi("POST", "/api/reset");
  showToast("Alles gereset!", "ok");
}

// ─── SUPABASE STATUS ──────────────────────────────────────────────────────────
async function checkSupabase() {
  try {
    const res = await fetch("/api/system/status");
    if (!res.ok) throw new Error("status request failed");
    const status = await res.json();

    if (!status.envLoaded) {
      setHtmlForAll(
        "#supabase-status",
        '<span style="color:var(--red)">.env is niet ingeladen door de server. Herstart de Node-server nadat dotenv is geïnstalleerd.</span>',
      );
      return;
    }

    if (status.keyType === "publishable") {
      setHtmlForAll(
        "#supabase-status",
        '<span style="color:#B8860B">Supabase sleutel is ingeladen, maar dit lijkt een publishable key. Gebruik hier beter de service role key voor server-side opslag en sync.</span>',
      );
      return;
    }

    if (!status.supabaseEnabled) {
      setHtmlForAll(
        "#supabase-status",
        '<span style="color:var(--muted)">In-memory modus actief. Stel SUPABASE_URL + SUPABASE_SERVICE_KEY in voor persistente opslag.</span>',
      );
      return;
    }

    if (status.realtime?.healthy) {
      setHtmlForAll(
        "#supabase-status",
        '<span style="color:#2E8B57">Supabase actief met Realtime-sync tussen alle teams en server-instanties.</span>',
      );
      return;
    }

    setHtmlForAll(
      "#supabase-status",
      '<span style="color:#B8860B">Supabase actief, maar Realtime is nog niet volledig verbonden. Live events vallen terug op lokale WebSocket-broadcast.</span>',
    );
  } catch (e) {
    setHtmlForAll(
      "#supabase-status",
      '<span style="color:var(--red)">Server niet bereikbaar</span>',
    );
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  addEventListeners();
});
