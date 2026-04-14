let adminPw = "";
let ws = null;
let allTeams = [];
let activeQ = null;
let selectedPreset = null;
let presets = [];
let history = [];
let allUploads = [];
let missions = [];
// ─── LOGIN ────────────────────────────────────────────────────────────────────
document.querySelector("#pw-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const pw = document.querySelector("#pw-input").value;
  const res = await fetch("/api/admin/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    adminPw = pw;
    document.querySelector("#login-screen").style.display = "none";
    document.querySelector("#app").style.display = "block";
    init();
  } else {
    document.querySelector("#login-error").style.display = "block";
  }
}

function addEventListeners() {
  document.querySelector("#login-button").addEventListener("click", doLogin);
  document.querySelector("#reset-button").addEventListener("click", doReset);
  document
    .querySelector("#close-question-button")
    .addEventListener("click", closeQuestion);
  document.querySelector("#q-type").addEventListener("change", toggleOptions);
  document
    .querySelector("#push-preset-button")
    .addEventListener("click", pushPreset);
  document
    .querySelector("#push-custom-button")
    .addEventListener("click", pushCustom);
  document.querySelectorAll(".tabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      switchTab(t.dataset.choice);
    }),
  );
  document.querySelectorAll(".nav-btn").forEach((t) =>
    t.addEventListener("click", (e) => switchPanel(t.dataset.panel, e)),
  );
  // Panel tabs (Vraag / Klassement / Feed)
  document
    .querySelectorAll(".panel-tab[data-panel]")
    .forEach((t) =>
      t.addEventListener("click", (e) => switchPanel(t.dataset.panel, e)),
    );
  ;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  presets = await adminApi("GET", "/api/admin/presets");
  history = await adminApi("GET", "/api/admin/history");
  missions = await fetch("/api/missions").then((r) => r.json()); // ADD THIS
  allUploads = await fetch("/api/uploads").then((r) => r.json()); // ADD THIS
  renderPresets();
  renderHistory();
  connectWS();
  checkSupabase();
}

// Panel tabs (Vraag / Klassement / Feed)
document
  .querySelectorAll(".tab[data-panel]")
  .forEach((t) =>
    t.addEventListener("click", (e) => switchPanel(t.dataset.panel, e)),
  );

function switchPanel(name, e) {
  document
    .querySelectorAll(".panel-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".panel-content")
    .forEach((p) => p.classList.remove("active"));
  if (e) e.currentTarget.classList.add("active");
  document.querySelector(`#panel-${name}`).classList.add("active");
}

function adminApi(method, path, body) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": adminPw,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts).then((r) => r.json());
}

// ─── WS ───────────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    document.querySelector("#ws-dot").className = "dot live";
    document.querySelector("#ws-txt").textContent = "Live";
  };
  ws.onclose = () => {
    document.querySelector("#ws-dot").className = "dot";
    document.querySelector("#ws-txt").textContent = "Offline";
    setTimeout(connectWS, 3000);
  };
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === "init") {
      allTeams = d.teams;
      allUploads = d.uploads || [];
      if (d.question) {
        activeQ = d.question;
        renderActiveQ();
      }
      renderLB();
      renderFeed();
    } else if (d.type === "teams_update") {
      allTeams = d.teams;
      renderLB();
    } else if (d.type === "answer_received") {
      document.querySelector("#answer-count").textContent =
        d.count + " antwoord" + (d.count === 1 ? "" : "en");
      toast(`${d.teamName} heeft geantwoord`, "ok");
    } else if (d.type === "question_closed") {
      activeQ = null;
      renderActiveQ();
      renderResults(d);
      allTeams = d.teams;
      renderLB();
    } else if (d.type === "reset") {
      allTeams = [];
      activeQ = null;
      history = [];
      renderLB();
      renderActiveQ();
      renderHistory();
    } else if (d.type === "new_upload") {
      allUploads.unshift(d.upload);
      renderFeed();
      toast(`${d.teamName} uploadde een bestand!`, "ok");
    }
  };
}

function renderFeed() {
  const el = document.querySelector("#admin-feed-list");
  document.querySelector("#feed-count").textContent = allUploads.length;
  if (!allUploads.length) {
    el.innerHTML =
      '<div style="color:var(--muted);font-size:13px">Nog geen uploads.</div>';
    return;
  }
  el.innerHTML = allUploads
    .map((u) => {
      const mission = missions.find((m) => m.id === u.missionId);
      const isVideo = /\.(mp4|mov|webm)$/i.test(u.filename);
      return `
      <div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface)">
          <div style="width:8px;height:8px;border-radius:50%;background:${u.teamColor};flex-shrink:0"></div>
          <div style="font-weight:600;font-size:13px;flex:1">${esc(u.teamName)}</div>
          <div style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace">${mission ? `#${mission.id} ${esc(mission.title)}` : ""}</div>
          <div style="font-size:11px;color:var(--muted)">${formatTime(u.timestamp)}</div>
        </div>
        <div style="background:#000;text-align:center">
          ${
            isVideo
              ? `<video src="${u.url}" controls playsinline style="max-width:100%;max-height:220px"></video>`
              : `<img src="${u.url}" alt="upload" style="max-width:100%;max-height:220px;object-fit:contain">`
          }
        </div>
      </div>`;
    })
    .join("");
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "Zojuist";
  if (diff < 3600000) return Math.floor(diff / 60000) + " min geleden";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " uur geleden";
  return new Date(ts).toLocaleDateString("nl-BE");
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
function renderLB() {
  const el = document.querySelector("#lb-list");
  document.querySelector("#team-count").textContent =
    allTeams.length + " team" + (allTeams.length === 1 ? "" : "s");
  if (!allTeams.length) {
    el.innerHTML =
      '<div style="color:var(--muted);font-size:13px">Nog geen teams.</div>';
    return;
  }
  const ranks = ["gold", "silver", "bronze"];
  el.innerHTML = allTeams
    .map(
      (t, i) => `
    <div class="lb-row">
      <div class="lb-rank ${ranks[i] || ""}">${i + 1}</div>
      <div class="lb-dot" style="background:${t.color}"></div>
      <div style="flex:1">
        <div class="lb-name">${esc(t.name)}</div>
        <div class="lb-sub">${t.completedMissions.length} opdrachten</div>
      </div>
      <div class="lb-score">${t.score}</div>
      <div class="score-adj">
        <button class="adj-btn" onclick="adjScore('${t.id}',10)" title="+10">+</button>
        <button class="adj-btn" onclick="adjScore('${t.id}',-10)" title="-10">−</button>
      </div>
    </div>`,
    )
    .join("");
}

async function adjScore(teamId, delta) {
  await adminApi("POST", `/api/admin/teams/${teamId}/score`, { delta });
}

// ─── PRESETS ──────────────────────────────────────────────────────────────────
function renderPresets() {
  document.querySelector("#preset-grid").innerHTML = presets
    .map(
      (p, i) => `
    <div class="preset-card" id="pc-${i}" onclick="selectPreset(${i})">
      <div class="preset-type">${p.type === "mcq" ? "4 opties" : "open"}</div>
      <div class="preset-q">${esc(p.question)}</div>
      <div class="preset-pts">+${p.pts} pt</div>
    </div>`,
    )
    .join("");
}

function selectPreset(i) {
  document
    .querySelectorAll(".preset-card")
    .forEach((c) => c.classList.remove("selected"));
  document.querySelector("#pc-" + i).classList.add("selected");
  selectedPreset = i;
  document.querySelector("#push-preset-button").disabled = false;
}

async function pushPreset() {
  if (selectedPreset === null) return;
  if (activeQ) {
    if (!confirm("Er is al een actieve vraag. Toch vervangen?")) return;
  }
  await adminApi("POST", "/api/admin/question", {
    presetIndex: selectedPreset,
  });
  activeQ = presets[selectedPreset];
  renderActiveQ();
  toast("Vraag gepusht!", "ok");
  selectedPreset = null;
  document
    .querySelectorAll(".preset-card")
    .forEach((c) => c.classList.remove("selected"));
  document.querySelector("#push-preset-button").disabled = true;
}

// ─── CUSTOM ───────────────────────────────────────────────────────────────────
function toggleOptions() {
  switch (document.querySelector("#q-type").value) {
    case "mcq":
      document.querySelector("#options-wrap").style.display = "block";
      break;
    case "image":
      document.querySelector("#q-answer").style.display = "none";
      document.querySelector("#options-wrap").style.display = "none";
      break;
    case "open":
      document.querySelector("#q-answer").style.display = "block";
      document.querySelector("#options-wrap").style.display = "none";

      break;
  }
}

async function pushCustom() {
  const type = document.querySelector("#q-type").value;
  const question = document.querySelector("#q-question").value.trim();
  const answer = document.querySelector("#q-answer").value.trim();
  const pts = parseInt(document.querySelector("#q-pts").value) || 20;
  console.log(question, answer, pts);
  if (!question || !answer) return toast("Vul vraag en antwoord in", "err");
  let options = [];
  if (type === "mcq") {
    options = ["opt-a", "opt-b", "opt-c", "opt-d"]
      .map((id) => document.getElementById(id).value.trim())
      .filter(Boolean);
    if (options.length < 2) return toast("Voeg minstens 2 opties in", "err");
  }
  if (type === "image") {
    options = null; // prevent empty array from being sent
  }
  if (activeQ) {
    if (!confirm("Er is al een actieve vraag. Toch vervangen?")) return;
  }
  await adminApi("POST", "/api/admin/question", {
    type,
    question,
    options,
    answer,
    pts,
  });
  renderActiveQ();
  toast("Vraag gepusht!", "ok");
}

// ─── ACTIVE QUESTION ──────────────────────────────────────────────────────────
function renderActiveQ() {
  const sec = document.querySelector("#active-section");
  const disp = document.querySelector("#active-q-display");
  if (!activeQ) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  document.querySelector("#answer-count").textContent = "0 antwoorden";
  const opts = activeQ.options?.length
    ? `<div class="aq-options">${activeQ.options.map((o) => `<div class="aq-opt">${esc(o)}</div>`).join("")}</div>`
    : "";
  disp.innerHTML = `
    <div class="aq-label">Actieve vraag · ${activeQ.type === "mcq" ? "Multiple choice" : "Open"} · +${activeQ.pts} pt</div>
    <div class="aq-question">${esc(activeQ.question)}</div>
    ${opts}`;
}

async function closeQuestion() {
  const res = await adminApi("POST", "/api/admin/question/close");
  if (res.error) return toast(res.error, "err");
  history = await adminApi("GET", "/api/admin/history");
  renderHistory();
  toast("Vraag gesloten, punten toegekend!", "ok");
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────
function renderResults(d) {
  const sec = document.querySelector("#result-section");
  sec.style.display = "block";
  document.querySelector("#result-answer-pill").textContent =
    "Antwoord: " + d.answer;

  document.querySelector("#result-list").innerHTML = d.results.length
    ? d.results
        .map((r) => {
          if (isBase64Image(r.answer)) {
            return `<img src="${r.answer}" alt="Uploaded image" style="max-width:200px;max-height:100px;border-radius:5px">`;
          } else {
            return `
        <div class="result-row ${r.correct ? "correct" : "wrong"}">
          <div class="lb-dot" style="background:${r.teamColor}"></div>
          <div class="result-name">${esc(r.teamName)}</div>
          <div class="result-answer">${esc(r.answer)}</div>
          <div class="result-pts ${r.awarded > 0 ? "pos" : "zero"}">${r.awarded > 0 ? "+" + r.awarded : "✗"}</div>
        </div>`;
          }
        })
        .join("")
    : '<div style="color:var(--muted);font-size:13px">Niemand heeft geantwoord.</div>';
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
function renderHistory() {
  document.querySelector("#hist-count").textContent = history.length;
  document.querySelector("#hist-list").innerHTML = history.length
    ? history
        .map(
          (h) => `
      <div class="hist-item">
        <div class="hist-q">${esc(h.question)}</div>
        <div class="hist-ans">Antwoord: ${esc(h.answer)} · ${h.results?.length || 0} antw.</div>
      </div>`,
        )
        .join("")
    : '<div style="color:var(--muted);font-size:13px">Nog geen gesloten vragen.</div>';
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((t) => t.classList.remove("active"));
  event.target.classList.add("active");
  document.querySelector("#tab-" + name).classList.add("active");
}

// ─── RESET ────────────────────────────────────────────────────────────────────
async function doReset() {
  if (
    !confirm(
      "Alles wissen? Teams, scores, uploads en vragen worden verwijderd.",
    )
  )
    return;
  await adminApi("POST", "/api/reset");
  toast("Alles gereset!", "ok");
}

// ─── SUPABASE CHECK ───────────────────────────────────────────────────────────
async function checkSupabase() {
  const el = document.querySelector("#supabase-status");
  try {
    const res = await fetch("/api/teams");
    el.innerHTML = res.ok
      ? '<span style="color:var(--muted)">Server draait (in-memory modus). Stel SUPABASE_URL + SUPABASE_SERVICE_KEY in als env variabelen voor persistentie.</span>'
      : '<span style="color:var(--red)">Server niet bereikbaar</span>';
  } catch (e) {
    el.innerHTML =
      '<span style="color:var(--red)">Server niet bereikbaar</span>';
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type = "") {
  const t = document.querySelector("#toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => (t.className = `toast ${type}`), 2500);
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", () => {
  addEventListeners();
});
