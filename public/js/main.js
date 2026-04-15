// ─── STATE ────────────────────────────────────────────────────────────────────
let myTeam             = null;
let missions           = [];
let allTeams           = [];
let allUploads         = [];
let currentUploadMission = null;
let newFeedCount       = 0;
let currentView        = "join";

// Quiz state
let activeQuestion  = null;
let myAnswer        = null;
let quizNotifCount  = 0;
let quizImageUploading = false;
let missionUploadingId = null;

// WebSocket handle (managed by makeWS from common.js)
let wsState = null;
const VALID_TABS = new Set(["join", "missions", "leaderboard", "feed", "quiz"]);

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  await getTeam();
  missions = await api("GET", "/api/missions");
  renderAll();
  wsState = makeWS("status-dot", "status-text", handleWsMessage);
  setupEventListeners();
  restoreTabFromUrl();
}

function renderAll() {
  updateJoinView();
  renderMissions();
  renderLeaderboard();
  renderFeed();
  renderQuiz();
}

function getTabFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return VALID_TABS.has(tab) ? tab : null;
}

function setTabInUrl(tab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState({}, "", url);
}

function restoreTabFromUrl() {
  const tab = getTabFromUrl();
  if (tab) {
    showView(tab, false);
  } else {
    setTabInUrl(currentView);
  }
}

// ─── WEBSOCKET HANDLER ────────────────────────────────────────────────────────
function handleWsMessage(data) {
  if (data.type === "init") {
    allTeams   = data.teams;
    allUploads = data.uploads;
    if (data.question) activeQuestion = data.question;
    renderLeaderboard();
    renderFeed();
    renderQuiz();
    if (myTeam) syncMyTeam();

  } else if (data.type === "teams_update") {
    allTeams = data.teams;
    if (myTeam) {
      syncMyTeam();
      updateTeamBadge();
    }
    renderLeaderboard();

  } else if (data.type === "new_upload") {
    allUploads.unshift(data.upload);
    renderFeed();
    if (currentView !== "feed") {
      newFeedCount++;
      const notif = document.querySelector("#feed-notif");
      notif.textContent = newFeedCount;
      notif.style.display = "inline-block";
    }
    if (data.teamName !== (myTeam && myTeam.name)) {
      showToast(`${data.teamName} uploadde een foto!`, "success");
    }

  } else if (data.type === "reset") {
    myTeam        = null;
    allTeams      = [];
    allUploads    = [];
    activeQuestion = null;
    myAnswer      = null;
    quizImageUploading = false;
    localStorage.removeItem("bcn_team");
    renderAll();
    showView("join");

  } else if (data.type === "new_question") {
    activeQuestion = data.question;
    myAnswer       = null;
    quizImageUploading = false;
    renderQuiz();
    if (currentView !== "quiz") {
      quizNotifCount++;
      document.querySelector("#quiz-notif").style.display = "inline-block";
    }
    showToast("Nieuwe quizvraag! Ga naar Quiz.", "success");

  } else if (data.type === "question_closed") {
    renderQuizResult(data);
  }
}

function syncMyTeam() {
  const updated = allTeams.find((t) => t.id === myTeam.id);
  if (updated) {
    myTeam = updated;
    localStorage.setItem("bcn_team", JSON.stringify(myTeam));
    renderMissions();
    updateTeamBadge();
  }
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
function setupEventListeners() {
  document.querySelector("#join-team-btn").addEventListener("click", joinTeam);
  document.querySelector("#go-to-missions-btn").addEventListener("click", () => showView("missions"));
  document.querySelector("#leave-team-btn").addEventListener("click", leaveTeam);
  document.querySelector("#team-name-input").addEventListener("keydown", (e) => { if (e.key === "Enter") joinTeam(); });

  document.querySelector("#nav-join").addEventListener("click",        () => showView("join"));
  document.querySelector("#nav-missions").addEventListener("click",    () => showView("missions"));
  document.querySelector("#nav-leaderboard").addEventListener("click", () => showView("leaderboard"));
  document.querySelector("#nav-feed").addEventListener("click",        () => showView("feed"));
  document.querySelector("#nav-quiz").addEventListener("click",        () => showView("quiz"));
}

// ─── VIEWS ────────────────────────────────────────────────────────────────────
function showView(name, updateUrl = true) {
  if (!VALID_TABS.has(name)) return;
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.getElementById(`nav-${name}`).classList.add("active");

  if (updateUrl) setTabInUrl(name);

  if (name === "feed") {
    newFeedCount = 0;
    document.querySelector("#feed-notif").style.display = "none";
  }
  if (name === "quiz") {
    quizNotifCount = 0;
    document.querySelector("#quiz-notif").style.display = "none";
  }
}

// ─── TEAM ─────────────────────────────────────────────────────────────────────
async function getTeam() {
  const saved = localStorage.getItem("bcn_team");
  if (!saved) return;
  try {
    myTeam = JSON.parse(saved);
    if (!myTeam) return;
    const res = await api("POST", "/api/teams", { name: myTeam.name });
    if (res.error) {
      showError(res.error === "Team name already taken" ? "Deze naam is al bezet." : res.error);
    }
      else {
      myTeam = res;
      localStorage.setItem("bcn_team", JSON.stringify(myTeam));
    }
  } catch (e) {}
}

async function joinTeam() {
  const name = document.querySelector("#team-name-input").value.trim();
  if (!name) return showError("Geef een teamnaam in.");
  const res = await api("POST", "/api/teams", { name });
  if (res.error) return showError(res.error === "Team name already taken" ? "Deze naam is al bezet." : res.error);
  myTeam = res;
  localStorage.setItem("bcn_team", JSON.stringify(myTeam));
  updateJoinView();
  renderMissions();
  showToast("Team aangemaakt!", "success");
}

function leaveTeam() {
  if (!confirm("Wil je een ander team aanmaken? Je verliest je huidige voortgang niet, maar je koppeling verdwijnt.")) return;
  myTeam = null;
  localStorage.removeItem("bcn_team");
  updateJoinView();
  renderMissions();
}

function updateJoinView() {
  if (myTeam) {
    document.querySelector("#join-form-wrap").style.display = "none";
    document.querySelector("#team-info-wrap").style.display = "block";
    updateTeamBadge();
  } else {
    document.querySelector("#join-form-wrap").style.display = "block";
    document.querySelector("#team-info-wrap").style.display = "none";
  }
}

function updateTeamBadge() {
  if (!myTeam) {
    document.querySelector("#team-info-header").style.display = "none";
    return;
  }
  document.querySelector("#team-info-header").style.display = "flex";
  document.querySelector("#team-name-header").textContent = myTeam.name;
  document.querySelector("#team-score-header").textContent = myTeam.score;
  
  document.querySelector("#team-badge").innerHTML = `
    <div class="team-color-dot" style="background:${myTeam.color}"></div>
    <div>
      <div class="team-badge-name">${myTeam.name}</div>
      <div style="font-size:12px;color:var(--muted);font-family:'DM Mono',monospace">${myTeam.completedMissions.length} opdrachten gedaan</div>
    </div>
    <div class="team-badge-score">${myTeam.score} pt</div>
  `;
}

function showError(msg) {
  const el = document.querySelector("#join-error");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 3000);
}

// ─── MISSIONS ─────────────────────────────────────────────────────────────────
function renderMissions() {
  if (!myTeam) {
    document.querySelector("#missions-no-team").style.display = "block";
    document.querySelector("#missions-content").style.display = "none";
    return;
  }
  document.querySelector("#missions-no-team").style.display  = "none";
  document.querySelector("#missions-content").style.display  = "block";

  const done = myTeam.completedMissions || [];
  document.querySelector("#missions-progress").textContent = `${done.length} / ${missions.length}`;

  document.querySelector("#missions-list").innerHTML = missions
    .map((m) => {
      const isDone = done.includes(m.id);
      const isUploading = missionUploadingId === m.id;
      return `
        <div class="mission-card ${isDone ? "done" : ""}" id="mc-${m.id}">
          <div class="mission-top">
            <div class="mission-num">${isDone ? "✓" : m.id}</div>
            <div style="flex:1">
              <div class="mission-title">${m.title}</div>
              <div class="mission-desc">${m.desc}</div>
              <div class="mission-footer">
                <span class="pts-tag">+${m.pts} PT</span>
              </div>
              <div class="mission-actions">
                ${isDone
                  ? `<button class="action-btn undo-btn" onclick="toggleMission(${m.id})">Ongedaan maken</button>`
                  : ""
                }
                <button class="action-btn" onclick="pickMissionUpload(${m.id})" ${isUploading ? "disabled" : ""}>${isUploading ? "Uploaden..." : "📷 Upload"}</button>
              </div>
            </div>
          </div>
        </div>`;
        // removed                 <span class="tag tag-${m.tag}">${m.tag}</span>
    })
    .join("");
}

async function toggleMission(missionId) {
  if (!myTeam) return;
  const res = await api("POST", `/api/teams/${myTeam.id}/missions/${missionId}`);
  if (res.error) return showToast(res.error, "error");
  myTeam = res;
  localStorage.setItem("bcn_team", JSON.stringify(myTeam));
  renderMissions();
  updateTeamBadge();
  const m    = missions.find((m) => m.id === missionId);
  const done = myTeam.completedMissions.includes(missionId);
  showToast(done ? `+${m.pts} punten! 🎉` : "Opdracht ongedaan gemaakt", done ? "success" : "");
  
  // Highlight the mission card when completed
  if (done) {
    setTimeout(() => {
      const card = document.querySelector(`#mc-${missionId}`);
      if (card) {
        card.style.animation = "none";
        setTimeout(() => {
          card.style.animation = "completePulse 0.6s ease-out";
        }, 10);
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 100);
  }
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────
function pickMissionUpload(missionId) {
  if (missionUploadingId !== null) return;
  currentUploadMission = missionId;
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*,video/*";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    doUpload("mission_upload", null, file, missionId);
  });
  picker.click();
}

async function doUpload(activityType = "mission_upload", fileInputSelector = "#file-input", providedFile = null, missionIdOverride = null) {
  if (!myTeam) return showToast("Geen team gevonden", "error");
  const file = providedFile || (fileInputSelector ? document.querySelector(fileInputSelector)?.files?.[0] : null);
  if (!file) return showToast("Kies eerst een bestand", "error");

  const btn = activityType === "quiz_upload"
    ? document.querySelector("#quiz-image-upload-btn")
    : null;

  const fd = new FormData();
  fd.append("file",      file);
  const missionId = missionIdOverride ?? currentUploadMission;
  if (activityType === "mission_upload" && !missionId) return showToast("Geen opdracht geselecteerd", "error");
  fd.append("missionId", missionId || "");
  fd.append("activity",  activityType);

  if (activityType === "mission_upload") {
    missionUploadingId = missionId;
    renderMissions();
  }

  try {
    const res  = await fetch(`/api/teams/${myTeam.id}/upload`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    // Only close modal and toggle mission for mission uploads
    if (activityType === "mission_upload") {
      await toggleMission(missionId);
      currentUploadMission = null;
      showToast("Upload gelukt! 🎉", "success");
    } else if (activityType === "quiz_upload") {
      // Mark the image question as submitted in the quiz UI.
      myAnswer = "Afbeelding ingestuurd";
      quizImageUploading = false;
      showToast("Upload gelukt! 🎉", "success");
      renderQuiz();
    }
  } catch (e) {
    if (activityType === "quiz_upload") {
      quizImageUploading = false;
      renderQuiz();
    }
    showToast("Upload mislukt: " + e.message, "error");
  } finally {
    if (activityType === "mission_upload") {
      missionUploadingId = null;
      renderMissions();
    }
    if (btn) {
      btn.disabled = false;
    }
  }
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
function renderLeaderboard() {
  if (!allTeams.length) {
    document.querySelector("#leaderboard-list").innerHTML =
      '<div class="lb-empty">Nog geen teams. Maak een team aan om te beginnen!</div>';
    return;
  }
  const rankClass = ["gold", "silver", "bronze"];
  document.querySelector("#leaderboard-list").innerHTML = allTeams
    .map((t, i) => `
      <div class="lb-card ${myTeam && t.id === myTeam.id ? "me" : ""}">
        <div class="lb-rank ${rankClass[i] || ""}">${i + 1}</div>
        <div class="lb-color" style="background:${t.color}"></div>
        <div style="flex:1">
          <div class="lb-name">${t.name} ${myTeam && t.id === myTeam.id ? '<span style="font-size:11px;color:var(--muted)">(jij)</span>' : ""}</div>
          <div class="lb-missions">${t.completedMissions.length} opdrachten</div>
        </div>
        <div>
          <div class="lb-score">${t.score}</div>
          <div class="lb-score-label">punten</div>
        </div>
      </div>`)
    .join("");
}

// ─── FEED ─────────────────────────────────────────────────────────────────────
function renderFeed() {
  if (!allUploads.length) {
    document.querySelector("#feed-list").innerHTML =
      '<div class="feed-empty">Nog geen uploads. Upload een foto of video bij een opdracht!</div>';
    return;
  }
  document.querySelector("#feed-list").innerHTML = allUploads
    .map((u) => {
      const mission = missions.find((m) => m.id === u.missionId);
      const isVideo = /\.(mp4|mov|webm)$/i.test(u.filename);
      return `
        <div class="feed-item">
          <div class="feed-meta">
            <div class="feed-team-dot" style="background:${u.teamColor}"></div>
            <div>
              <div class="feed-team-name">${u.teamName}</div>
              <div class="feed-time">${formatTime(u.timestamp)}</div>
            </div>
            <div class="feed-mission">${mission ? `#${mission.id}` : ""}</div>
          </div>
          <div class="feed-media">
            ${isVideo
              ? `<video src="${u.url}" controls playsinline></video>`
              : `<img src="${u.url}" alt="upload" loading="lazy">`}
          </div>
          ${mission ? `<div style="padding:10px 14px;font-size:13px;color:var(--muted)">${mission.title}</div>` : ""}
        </div>`;
    })
    .join("");
}

// ─── QUIZ ─────────────────────────────────────────────────────────────────────
function renderQuiz() {
  const idle     = document.querySelector("#quiz-idle");
  const active   = document.querySelector("#quiz-active");
  const answered = document.querySelector("#quiz-answered");
  const result   = document.querySelector("#quiz-result");

  idle.style.display     = "none";
  active.style.display   = "none";
  answered.style.display = "none";
  result.style.display   = "none";

  if (!activeQuestion) { idle.style.display = "block"; return; }

  if (myAnswer !== null) {
    answered.style.display = "block";
    document.querySelector("#quiz-answered-txt").textContent =
      myAnswer === "Afbeelding ingestuurd"
        ? "Afbeelding succesvol ingestuurd. Wacht op de uitslag..."
        : `Je antwoordde: "${myAnswer}". Wacht op de uitslag...`;
    return;
  }

  active.style.display = "block";
  const optClasses = ["quiz-opt-a", "quiz-opt-b", "quiz-opt-c", "quiz-opt-d"];
  const optLabels  = ["A", "B", "C", "D"];
  let optionsHtml  = "";

  if (activeQuestion.type === "mcq" && activeQuestion.options?.length) {
    optionsHtml = `
      <div class="quiz-options">
        ${activeQuestion.options
          .map((opt, i) => `
            <button class="quiz-opt ${optClasses[i]}" onclick="submitAnswer('${escJs(opt)}')">
              <span style="opacity:.5;font-size:12px;display:block;margin-bottom:3px">${optLabels[i]}</span>
              ${escHtml(opt)}
            </button>`)
          .join("")}
      </div>`;

  } else if (activeQuestion.type === "open") {
    optionsHtml = `
      <div class="quiz-open-wrap">
        <input class="input" id="quiz-open-input" type="text"
          placeholder="Typ je antwoord..." autocomplete="off"
          onkeydown="if(event.key==='Enter') submitOpenAnswer()">
      </div>
      <button class="btn" onclick="submitOpenAnswer()" style="width:100%">Antwoord versturen →</button>`;

  } else if (activeQuestion.type === "image") {
    const uploadLabel = quizImageUploading ? "Uploaden..." : "📷 Upload antwoord";
    optionsHtml = `
      <div class="quiz-image-wrap">
        <img src="${escHtml(activeQuestion.imageUrl)}" alt="Question image"
          style="max-width:100%;border-radius:var(--r-sm);margin-bottom:16px">
        <input id="quiz-file-input" type="file" accept="image/*" style="display:none">
        <button class="btn" id="quiz-image-upload-btn" onclick="document.querySelector('#quiz-file-input').click()"
          style="width:100%" ${quizImageUploading ? "disabled" : ""}>${uploadLabel}</button>
      </div>`;
  }

  document.querySelector("#quiz-question-card").innerHTML = `
    <div class="quiz-card">
      <div class="quiz-label">Live vraag · +${activeQuestion.pts} punten voor het eerste juiste antwoord</div>
      <div class="quiz-question">${escHtml(activeQuestion.question)}</div>
      ${optionsHtml}
      <div class="quiz-pts">${activeQuestion.type === "mcq"
        ? "Kies een antwoord hierboven."
        : "Typ je antwoord en druk op Enter of de knop."}</div>
    </div>`;

  if (activeQuestion.type === "image") {
    document.querySelector("#quiz-file-input").addEventListener("change", submitImageAnswer);
  }
}

function submitOpenAnswer() {
  const input = document.querySelector("#quiz-open-input");
  if (!input) return;
  const val = input.value.trim();
  if (val) submitAnswer(val);
}

function submitImageAnswer() {
  if (quizImageUploading || myAnswer !== null) return;
  const input = document.querySelector("#quiz-file-input");
  const file = input?.files?.[0];
  if (!file) return;
  quizImageUploading = true;
  renderQuiz();
  doUpload("quiz_upload", null, file);
}

async function submitAnswer(answer) {
  if (!myTeam)          return showToast("Maak eerst een team aan!", "error");
  if (myAnswer !== null) return;

  myAnswer = answer;

  const res  = await fetch("/api/quiz/answer", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ teamId: myTeam.id, answer }),
  });
  const data = await res.json();

  if (data.error === "Already answered") { showToast("Je hebt al geantwoord!", "error"); return; }
  if (data.error)                        { showToast(data.error, "error"); myAnswer = null; return; }

  renderQuiz();
}

function renderQuizResult(data) {
  activeQuestion = null;

  const idle     = document.querySelector("#quiz-idle");
  const active   = document.querySelector("#quiz-active");
  const answered = document.querySelector("#quiz-answered");
  const result   = document.querySelector("#quiz-result");

  idle.style.display     = "none";
  active.style.display   = "none";
  answered.style.display = "none";
  result.style.display   = "block";

  const myResult = myTeam ? data.results.find((r) => r.teamId === myTeam.id) : null;
  const correct  = myResult?.correct;
  const awarded  = myResult?.awarded ?? 0;
  const didAnswer = myAnswer !== null;

  let banner = "";
  if (!didAnswer) {
    banner = `
      <div class="result-wrong-banner">
        <div class="result-icon">😴</div>
        <div class="result-title">Niet geantwoord</div>
        <div class="result-sub">Je hebt deze vraag gemist.</div>
      </div>`;
  } else if (correct) {
    banner = `
      <div class="result-correct-banner">
        <div class="result-icon">🎉</div>
        <div class="result-title" style="color:var(--green)">Juist! +${awarded} punten</div>
        <div class="result-sub">${awarded === activeQuestion?.pts ? "Eerste juiste antwoord!" : "Goed, maar iemand was sneller."}</div>
      </div>`;
  } else {
    banner = `
      <div class="result-wrong-banner">
        <div class="result-icon">❌</div>
        <div class="result-title" style="color:var(--red)">Fout antwoord</div>
        <div class="result-sub">Je antwoordde: "${escHtml(myAnswer || "")}"</div>
      </div>`;
  }

  const correct3 = data.results.filter((r) => r.correct).slice(0, 3);
  const podium   = correct3.length
    ? `<div style="margin-top:12px">
        <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--muted);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase">Correcte antwoorden</div>
        ${correct3.map((r, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface);border-radius:var(--r-sm);margin-bottom:6px;border:1px solid rgba(39,174,96,.2)">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--muted2);min-width:20px">${i + 1}</div>
            <div style="width:8px;height:8px;border-radius:50%;background:${r.teamColor};flex-shrink:0"></div>
            <div style="flex:1;font-weight:600;font-size:13px">${escHtml(r.teamName)}</div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--green)">+${r.awarded}</div>
          </div>`).join("")}
      </div>`
    : "";

  document.querySelector("#quiz-result-card").innerHTML = `
    <div style="padding-bottom:16px">
      ${banner}
      <div class="result-answer-reveal">
        Correct antwoord: <strong>${escHtml(data.answer)}</strong>
      </div>
      ${podium}
      <button class="btn secondary" onclick="resetQuizView()" style="width:100%;margin-top:14px">Sluiten</button>
    </div>`;

  myAnswer = null;

  if (data.teams) {
    allTeams = data.teams;
    renderLeaderboard();
  }
  if (myTeam) {
    const updated = data.teams?.find((t) => t.id === myTeam.id);
    if (updated) {
      myTeam = updated;
      localStorage.setItem("bcn_team", JSON.stringify(myTeam));
      updateTeamBadge();
    }
  }
}

function resetQuizView() {
  document.querySelector("#quiz-result").style.display = "none";
  document.querySelector("#quiz-idle").style.display   = "block";
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);
