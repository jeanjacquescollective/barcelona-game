let myTeam = null;
let missions = [];
let allTeams = [];
let allUploads = [];
let ws = null;
let currentUploadMission = null;
let newFeedCount = 0;
let currentView = 'join';

// Quiz state
let activeQuestion = null;
let myAnswer = null;
let quizNotifCount = 0;

const serverPort = `3000`;
const serverUrl = `http://localhost:${serverPort}`; // Adjust if your server runs elsewhere

function setupEventListeners() {
    // Join Team Button
    document.querySelector('#join-team-btn').addEventListener('click', joinTeam);

    // Go to Missions Button
    document.querySelector('#go-to-missions-btn').addEventListener('click', function () {
        showView('missions');
    });

    // Leave Team Button
    document.querySelector('#leave-team-btn').addEventListener('click', leaveTeam);

    // Upload Zone Click
    document.querySelector('#upload-zone').addEventListener('click', function () {
        document.querySelector('#file-input').click();
    });

    // File Input Change
    document.querySelector('#file-input').addEventListener('change', function () {
        previewFile(this);
    });

    // Cancel Upload Button
    document.querySelector('#cancel-upload-btn').addEventListener('click', closeModal);

    // Upload Button
    document.querySelector('#upload-btn').addEventListener('click', doUpload);

    // Navigation Buttons
    document.querySelector('#nav-join').addEventListener('click', function () {
        showView('join');
    });

    document.querySelector('#nav-missions').addEventListener('click', function () {
        showView('missions');
    });

    document.querySelector('#nav-leaderboard').addEventListener('click', function () {
        showView('leaderboard');
    });

    document.querySelector('#nav-feed').addEventListener('click', function () {
        showView('feed');
    });

    document.querySelector('#nav-quiz').addEventListener('click', function () {
        showView('quiz');
    });

}

// Load saved team from localStorage
const saved = localStorage.getItem('bcn_team');
if (saved) { try { myTeam = JSON.parse(saved); } catch (e) { } }

// --- WebSocket ---
function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    console.log(`Connecting to WebSocket at ${proto}://${location.hostname}:${serverPort}`);
    ws = new WebSocket(`${proto}://${location.hostname}:${serverPort}`);

    ws.onopen = () => {
        document.querySelector('#status-dot').className = 'dot live';
        document.querySelector('#status-text').textContent = 'Live';
    };

    ws.onclose = () => {
        document.querySelector('#status-dot').className = 'dot';
        document.querySelector('#status-text').textContent = 'Offline';
        setTimeout(connectWS, 3000);
    };

    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'init') {
            allTeams = data.teams;
            allUploads = data.uploads;
            if (data.question) { activeQuestion = data.question; }
            renderLeaderboard();
            renderFeed();
            renderQuiz();
            // Sync my team data
            if (myTeam) {
                const updated = allTeams.find(t => t.id === myTeam.id);
                if (updated) { myTeam = updated; localStorage.setItem('bcn_team', JSON.stringify(myTeam)); renderMissions(); }
            }
        } else if (data.type === 'teams_update') {
            allTeams = data.teams;
            if (myTeam) {
                const updated = allTeams.find(t => t.id === myTeam.id);
                if (updated) { myTeam = updated; localStorage.setItem('bcn_team', JSON.stringify(myTeam)); renderMissions(); updateTeamBadge(); }
            }
            renderLeaderboard();
        } else if (data.type === 'new_upload') {
            allUploads.unshift(data.upload);
            renderFeed();
            if (currentView !== 'feed') {
                newFeedCount++;
                const notif = document.querySelector('#feed-notif');
                notif.textContent = newFeedCount;
                notif.style.display = 'inline-block';
            }
            if (data.teamName !== (myTeam && myTeam.name)) {
                showToast(`${data.teamName} uploadde een foto!`, 'success');
            }
        } else if (data.type === 'reset') {
            myTeam = null; localStorage.removeItem('bcn_team');
            allTeams = []; allUploads = [];
            activeQuestion = null; myAnswer = null;
            renderAll(); showView('join');
            renderQuiz();
        } else if (data.type === 'new_question') {
            activeQuestion = data.question;
            myAnswer = null;
            renderQuiz();
            // Show notification badge on quiz tab
            if (currentView !== 'quiz') {
                quizNotifCount++;
                const notif = document.querySelector('#quiz-notif');
                notif.style.display = 'inline-block';
            }
            showToast('Nieuwe quizvraag! Ga naar Quiz.', 'success');
        } else if (data.type === 'question_closed') {
            renderQuizResult(data);
        }
    };
}

// --- API ---
async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    return res.json();
}

// --- Init ---
async function init() {
    missions = await api('GET', serverUrl + '/api/missions');
    renderAll();
    connectWS();
    setupEventListeners();
}

function renderAll() {
    updateJoinView();
    renderMissions();
    renderLeaderboard();
    renderFeed();
    renderQuiz();
}

// --- Views ---
function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
    document.getElementById(`nav-${name}`).classList.add('active');
    if (name === 'feed') {
        newFeedCount = 0;
        document.querySelector('#feed-notif').style.display = 'none';
    }
    if (name === 'quiz') {
        quizNotifCount = 0;
        document.querySelector('#quiz-notif').style.display = 'none';
    }
}

// --- Team ---
async function joinTeam() {
    const name = document.querySelector('#team-name-input').value.trim();
    if (!name) return showError('Geef een teamnaam in.');
    const res = await api('POST', serverUrl + '/api/teams', { name });
    if (res.error) return showError(res.error === 'Team name already taken' ? 'Deze naam is al bezet.' : res.error);
    myTeam = res;
    localStorage.setItem('bcn_team', JSON.stringify(myTeam));
    updateJoinView();
    renderMissions();
    showToast('Team aangemaakt!', 'success');
}

function leaveTeam() {
    if (!confirm('Wil je een ander team aanmaken? Je verliest je huidige voortgang niet, maar je koppeling verdwijnt.')) return;
    myTeam = null;
    localStorage.removeItem('bcn_team');
    updateJoinView();
    renderMissions();
}

function updateJoinView() {
    if (myTeam) {
        document.querySelector('#join-form-wrap').style.display = 'none';
        document.querySelector('#team-info-wrap').style.display = 'block';
        updateTeamBadge();
    } else {
        document.querySelector('#join-form-wrap').style.display = 'block';
        document.querySelector('#team-info-wrap').style.display = 'none';
    }
}

function updateTeamBadge() {
    if (!myTeam) return;
    document.querySelector('#team-badge').innerHTML = `
    <div class="team-color-dot" style="background:${myTeam.color}"></div>
    <div>
      <div class="team-badge-name">${myTeam.name}</div>
      <div style="font-size:12px;color:var(--muted);font-family:'DM Mono',monospace">${myTeam.completedMissions.length} opdrachten gedaan</div>
    </div>
    <div class="team-badge-score">${myTeam.score} pt</div>
  `;
}

function showError(msg) {
    const el = document.querySelector('#join-error');
    el.textContent = msg; el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}

// --- Missions ---
function renderMissions() {
    if (!myTeam) {
        document.querySelector('#missions-no-team').style.display = 'block';
        document.querySelector('#missions-content').style.display = 'none';
        return;
    }
    document.querySelector('#missions-no-team').style.display = 'none';
    document.querySelector('#missions-content').style.display = 'block';

    const done = myTeam.completedMissions || [];
    document.querySelector('#missions-progress').textContent = `${done.length} / ${missions.length}`;

    document.querySelector('#missions-list').innerHTML = missions.map(m => {
        const isDone = done.includes(m.id);
        return `
    <div class="mission-card ${isDone ? 'done' : ''}" id="mc-${m.id}">
      <div class="mission-top">
        <div class="mission-num">${isDone ? '✓' : m.id}</div>
        <div style="flex:1">
          <div class="mission-title">${m.title}</div>
          <div class="mission-desc">${m.desc}</div>
          <div class="mission-footer">
            <span class="tag tag-${m.tag}">${m.tag}</span>
            <span class="pts-tag">+${m.pts} PT</span>
          </div>
          <div class="mission-actions">
            ${isDone
                ? `<button class="action-btn undo-btn" onclick="toggleMission(${m.id})">Ongedaan maken</button>`
                : `<button class="action-btn complete-btn" onclick="toggleMission(${m.id})">Voltooid ✓</button>`
            }
            <button class="action-btn" onclick="openUpload(${m.id}, '${m.title.replace(/'/g, "\\'")}', '${m.desc.replace(/'/g, "\\'")}')">📷 Upload</button>
          </div>
        </div>
      </div>
    </div>`;
    }).join('');
}

async function toggleMission(missionId) {
    if (!myTeam) return;
    const res = await api('POST', serverUrl + `/api/teams/${myTeam.id}/missions/${missionId}`);
    if (res.error) return showToast(res.error, 'error');
    myTeam = res;
    localStorage.setItem('bcn_team', JSON.stringify(myTeam));
    renderMissions();
    updateTeamBadge();
    const m = missions.find(m => m.id === missionId);
    const done = myTeam.completedMissions.includes(missionId);
    showToast(done ? `+${m.pts} punten! 🎉` : 'Opdracht ongedaan gemaakt', done ? 'success' : '');
}

// --- Upload ---
function openUpload(missionId, title, desc) {
    currentUploadMission = missionId;
    document.querySelector('#modal-mission-title').textContent = title;
    document.querySelector('#modal-mission-desc').textContent = desc;
    document.querySelector('#upload-preview-img').style.display = 'none';
    document.querySelector('#upload-preview-vid').style.display = 'none';
    document.querySelector('#file-input').value = '';
    document.querySelector('#upload-modal').classList.add('open');
}

function closeModal() {
    document.querySelector('#upload-modal').classList.remove('open');
    currentUploadMission = null;
}

function previewFile(input) {
    const file = input.files[0];
    if (!file) return;
    const img = document.querySelector('#upload-preview-img');
    const vid = document.querySelector('#upload-preview-vid');
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
        img.style.display = 'none';
        vid.src = url; vid.style.display = 'block';
    } else {
        vid.style.display = 'none';
        img.src = url; img.style.display = 'block';
    }
}

async function doUpload() {
    if (!myTeam) return showToast('Geen team gevonden', 'error');
    const file = document.querySelector('#file-input').files[0];
    if (!file) return showToast('Kies eerst een bestand', 'error');

    const btn = document.querySelector('#upload-btn');
    btn.textContent = 'Uploaden...'; btn.disabled = true;

    const fd = new FormData();
    fd.append('file', file);
    fd.append('missionId', currentUploadMission);

    try {
        const res = await fetch(serverUrl + `/api/teams/${myTeam.id}/upload`, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        closeModal();
        showToast('Upload gelukt! 🎉', 'success');
    } catch (e) {
        showToast('Upload mislukt: ' + e.message, 'error');
    } finally {
        btn.textContent = 'Uploaden'; btn.disabled = false;
    }
}

// --- Leaderboard ---
function renderLeaderboard() {
    if (!allTeams.length) {
        document.querySelector('#leaderboard-list').innerHTML = '<div class="lb-empty">Nog geen teams. Maak een team aan om te beginnen!</div>';
        return;
    }
    const rankClass = ['gold', 'silver', 'bronze'];
    document.querySelector('#leaderboard-list').innerHTML = allTeams.map((t, i) => `
    <div class="lb-card ${myTeam && t.id === myTeam.id ? 'me' : ''}">
      <div class="lb-rank ${rankClass[i] || ''}">${i + 1}</div>
      <div class="lb-color" style="background:${t.color}"></div>
      <div style="flex:1">
        <div class="lb-name">${t.name} ${myTeam && t.id === myTeam.id ? '<span style="font-size:11px;color:var(--muted)">(jij)</span>' : ''}</div>
        <div class="lb-missions">${t.completedMissions.length} opdrachten</div>
      </div>
      <div>
        <div class="lb-score">${t.score}</div>
        <div class="lb-score-label">punten</div>
      </div>
    </div>
  `).join('');
}

// --- Feed ---
function renderFeed() {
    if (!allUploads.length) {
        document.querySelector('#feed-list').innerHTML = '<div class="feed-empty">Nog geen uploads. Upload een foto of video bij een opdracht!</div>';
        return;
    }
    document.querySelector('#feed-list').innerHTML = allUploads.map(u => {
        const mission = missions.find(m => m.id === u.missionId);
        const isVideo = /\.(mp4|mov|webm)$/i.test(u.filename);
        const timeAgo = formatTime(u.timestamp);
        return `
    <div class="feed-item">
      <div class="feed-meta">
        <div class="feed-team-dot" style="background:${u.teamColor}"></div>
        <div>
          <div class="feed-team-name">${u.teamName}</div>
          <div class="feed-time">${timeAgo}</div>
        </div>
        <div class="feed-mission">${mission ? `#${mission.id}` : ''}</div>
      </div>
      <div class="feed-media">
        ${isVideo
                ? `<video src="${u.url}" controls playsinline></video>`
                : `<img src="${u.url}" alt="upload" loading="lazy">`
            }
      </div>
      ${mission ? `<div style="padding:10px 14px;font-size:13px;color:var(--muted)">${mission.title}</div>` : ''}
    </div>`;
    }).join('');
}

function formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Zojuist';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min geleden';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' uur geleden';
    return new Date(ts).toLocaleDateString('nl-BE');
}

// --- Toast ---
function showToast(msg, type = '') {
    const t = document.querySelector('#toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.className = `toast ${type}`, 2500);
}

// Close modal on overlay click
document.querySelector('#upload-modal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
});

// Enter key on name input
document.querySelector('#team-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinTeam();
});

document.addEventListener('DOMContentLoaded', init);

// ─── QUIZ ─────────────────────────────────────────────────────────────────────
function renderQuiz() {
    const idle     = document.querySelector('#quiz-idle');
    const active   = document.querySelector('#quiz-active');
    const answered = document.querySelector('#quiz-answered');
    const result   = document.querySelector('#quiz-result');

    // Hide all first
    idle.style.display = 'none';
    active.style.display = 'none';
    answered.style.display = 'none';
    result.style.display = 'none';

    if (!activeQuestion) {
        idle.style.display = 'block';
        return;
    }

    if (myAnswer !== null) {
        answered.style.display = 'block';
        document.querySelector('#quiz-answered-txt').textContent =
            'Je antwoordde: "' + myAnswer + '". Wacht op de uitslag...';
        return;
    }

    // Show active question
    active.style.display = 'block';
    const optClasses = ['quiz-opt-a', 'quiz-opt-b', 'quiz-opt-c', 'quiz-opt-d'];
    const optLabels  = ['A', 'B', 'C', 'D'];
    let optionsHtml = '';

    if (activeQuestion.type === 'mcq' && activeQuestion.options && activeQuestion.options.length) {
        optionsHtml = `
            <div class="quiz-options">
                ${activeQuestion.options.map((opt, i) => `
                    <button class="quiz-opt ${optClasses[i]}" onclick="submitAnswer('${escJs(opt)}')">
                        <span style="opacity:.5;font-size:12px;display:block;margin-bottom:3px">${optLabels[i]}</span>
                        ${escHtml(opt)}
                    </button>
                `).join('')}
            </div>`;
    } else {
        optionsHtml = `
            <div class="quiz-open-wrap">
                <input class="input" id="quiz-open-input" type="text"
                    placeholder="Typ je antwoord..." autocomplete="off"
                    onkeydown="if(event.key==='Enter') submitOpenAnswer()">
            </div>
            <button class="btn" onclick="submitOpenAnswer()" style="width:100%">Antwoord versturen →</button>`;
    }

    document.querySelector('#quiz-question-card').innerHTML = `
        <div class="quiz-card">
            <div class="quiz-label">Live vraag · +${activeQuestion.pts} punten voor het eerste juiste antwoord</div>
            <div class="quiz-question">${escHtml(activeQuestion.question)}</div>
            ${optionsHtml}
            <div class="quiz-pts">${activeQuestion.type === 'mcq' ? 'Kies een antwoord hierboven.' : 'Typ je antwoord en druk op Enter of de knop.'}</div>
        </div>`;
}

function submitOpenAnswer() {
    const input = document.querySelector('#quiz-open-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    submitAnswer(val);
}

async function submitAnswer(answer) {
    if (!myTeam) return showToast('Maak eerst een team aan!', 'error');
    if (myAnswer !== null) return;

    myAnswer = answer;

    const res = await fetch('/api/quiz/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: myTeam.id, answer })
    });
    const data = await res.json();

    if (data.error === 'Already answered') {
        showToast('Je hebt al geantwoord!', 'error');
        return;
    }
    if (data.error) {
        showToast(data.error, 'error');
        myAnswer = null;
        return;
    }

    renderQuiz();
}

function renderQuizResult(data) {
    // Update activeQuestion and myAnswer state
    activeQuestion = null;

    const idle     = document.querySelector('#quiz-idle');
    const active   = document.querySelector('#quiz-active');
    const answered = document.querySelector('#quiz-answered');
    const result   = document.querySelector('#quiz-result');

    idle.style.display = 'none';
    active.style.display = 'none';
    answered.style.display = 'none';
    result.style.display = 'block';

    // Find my result
    const myResult = myTeam ? data.results.find(r => r.teamId === myTeam.id) : null;
    const correct  = myResult && myResult.correct;
    const awarded  = myResult ? myResult.awarded : 0;
    const didAnswer = myAnswer !== null;

    let banner = '';
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
                <div class="result-sub">${awarded === activeQuestion?.pts ? 'Eerste juiste antwoord!' : 'Goed, maar iemand was sneller.'}</div>
            </div>`;
    } else {
        banner = `
            <div class="result-wrong-banner">
                <div class="result-icon">❌</div>
                <div class="result-title" style="color:var(--red)">Fout antwoord</div>
                <div class="result-sub">Je antwoordde: "${escHtml(myAnswer || '')}"</div>
            </div>`;
    }

    // Top 3 correct answerers
    const correct3 = data.results.filter(r => r.correct).slice(0, 3);
    const podium = correct3.length ? `
        <div style="margin-top:12px">
            <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--muted);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase">Correcte antwoorden</div>
            ${correct3.map((r, i) => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface);border-radius:var(--radius-sm);margin-bottom:6px;border:1px solid rgba(39,174,96,.2)">
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--muted2);min-width:20px">${i + 1}</div>
                    <div style="width:8px;height:8px;border-radius:50%;background:${r.teamColor};flex-shrink:0"></div>
                    <div style="flex:1;font-weight:600;font-size:13px">${escHtml(r.teamName)}</div>
                    <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--green)">+${r.awarded}</div>
                </div>`).join('')}
        </div>` : '';

    document.querySelector('#quiz-result-card').innerHTML = `
        <div style="padding-bottom:16px">
            ${banner}
            <div class="result-answer-reveal">
                Correct antwoord: <strong>${escHtml(data.answer)}</strong>
            </div>
            ${podium}
            <button class="btn secondary" onclick="resetQuizView()" style="width:100%;margin-top:14px">Sluiten</button>
        </div>`;

    myAnswer = null;

    // Update scores
    if (data.teams) { allTeams = data.teams; renderLeaderboard(); }
    if (myTeam) {
        const updated = data.teams && data.teams.find(t => t.id === myTeam.id);
        if (updated) { myTeam = updated; localStorage.setItem('bcn_team', JSON.stringify(myTeam)); updateTeamBadge(); }
    }
}

function resetQuizView() {
    document.querySelector('#quiz-result').style.display = 'none';
    document.querySelector('#quiz-idle').style.display = 'block';
}

function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escJs(s) {
    return String(s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
