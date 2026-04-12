let myTeam = null;
let missions = [];
let allTeams = [];
let allUploads = [];
let ws = null;
let currentUploadMission = null;
let newFeedCount = 0;
let currentView = 'join';

const serverPort = `3000`;
const serverUrl = `http://localhost:${serverPort}`; // Adjust if your server runs elsewhere

function setupEventListeners() {
    // Join Team Button
    document.getElementById('join-team-btn').addEventListener('click', joinTeam);

    // Go to Missions Button
    document.getElementById('go-to-missions-btn').addEventListener('click', function () {
        showView('missions');
    });

    // Leave Team Button
    document.getElementById('leave-team-btn').addEventListener('click', leaveTeam);

    // Upload Zone Click
    document.getElementById('upload-zone').addEventListener('click', function () {
        document.getElementById('file-input').click();
    });

    // File Input Change
    document.getElementById('file-input').addEventListener('change', function () {
        previewFile(this);
    });

    // Cancel Upload Button
    document.getElementById('cancel-upload-btn').addEventListener('click', closeModal);

    // Upload Button
    document.getElementById('upload-btn').addEventListener('click', doUpload);

    // Navigation Buttons
    document.getElementById('nav-join').addEventListener('click', function () {
        showView('join');
    });

    document.getElementById('nav-missions').addEventListener('click', function () {
        showView('missions');
    });

    document.getElementById('nav-leaderboard').addEventListener('click', function () {
        showView('leaderboard');
    });

    document.getElementById('nav-feed').addEventListener('click', function () {
        showView('feed');
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
        document.getElementById('status-dot').className = 'dot live';
        document.getElementById('status-text').textContent = 'Live';
    };

    ws.onclose = () => {
        document.getElementById('status-dot').className = 'dot';
        document.getElementById('status-text').textContent = 'Offline';
        setTimeout(connectWS, 3000);
    };

    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'init') {
            allTeams = data.teams;
            allUploads = data.uploads;
            renderLeaderboard();
            renderFeed();
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
                const notif = document.getElementById('feed-notif');
                notif.textContent = newFeedCount;
                notif.style.display = 'inline-block';
            }
            if (data.teamName !== (myTeam && myTeam.name)) {
                showToast(`${data.teamName} uploadde een foto!`, 'success');
            }
        } else if (data.type === 'reset') {
            myTeam = null; localStorage.removeItem('bcn_team');
            allTeams = []; allUploads = [];
            renderAll(); showView('join');
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
        document.getElementById('feed-notif').style.display = 'none';
    }
}

// --- Team ---
async function joinTeam() {
    const name = document.getElementById('team-name-input').value.trim();
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
        document.getElementById('join-form-wrap').style.display = 'none';
        document.getElementById('team-info-wrap').style.display = 'block';
        updateTeamBadge();
    } else {
        document.getElementById('join-form-wrap').style.display = 'block';
        document.getElementById('team-info-wrap').style.display = 'none';
    }
}

function updateTeamBadge() {
    if (!myTeam) return;
    document.getElementById('team-badge').innerHTML = `
    <div class="team-color-dot" style="background:${myTeam.color}"></div>
    <div>
      <div class="team-badge-name">${myTeam.name}</div>
      <div style="font-size:12px;color:var(--muted);font-family:'DM Mono',monospace">${myTeam.completedMissions.length} opdrachten gedaan</div>
    </div>
    <div class="team-badge-score">${myTeam.score} pt</div>
  `;
}

function showError(msg) {
    const el = document.getElementById('join-error');
    el.textContent = msg; el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}

// --- Missions ---
function renderMissions() {
    if (!myTeam) {
        document.getElementById('missions-no-team').style.display = 'block';
        document.getElementById('missions-content').style.display = 'none';
        return;
    }
    document.getElementById('missions-no-team').style.display = 'none';
    document.getElementById('missions-content').style.display = 'block';

    const done = myTeam.completedMissions || [];
    document.getElementById('missions-progress').textContent = `${done.length} / ${missions.length}`;

    document.getElementById('missions-list').innerHTML = missions.map(m => {
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
    document.getElementById('modal-mission-title').textContent = title;
    document.getElementById('modal-mission-desc').textContent = desc;
    document.getElementById('upload-preview-img').style.display = 'none';
    document.getElementById('upload-preview-vid').style.display = 'none';
    document.getElementById('file-input').value = '';
    document.getElementById('upload-modal').classList.add('open');
}

function closeModal() {
    document.getElementById('upload-modal').classList.remove('open');
    currentUploadMission = null;
}

function previewFile(input) {
    const file = input.files[0];
    if (!file) return;
    const img = document.getElementById('upload-preview-img');
    const vid = document.getElementById('upload-preview-vid');
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
    const file = document.getElementById('file-input').files[0];
    if (!file) return showToast('Kies eerst een bestand', 'error');

    const btn = document.getElementById('upload-btn');
    btn.textContent = 'Uploaden...'; btn.disabled = true;

    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('missionId', currentUploadMission);
    console.log('Uploading file for mission', currentUploadMission, file);

    try {
        const res = await fetch(serverUrl + `/api/teams/${myTeam.id}/upload`, { method: 'POST', body: fd, headers: {} });
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
        document.getElementById('leaderboard-list').innerHTML = '<div class="lb-empty">Nog geen teams. Maak een team aan om te beginnen!</div>';
        return;
    }
    const rankClass = ['gold', 'silver', 'bronze'];
    document.getElementById('leaderboard-list').innerHTML = allTeams.map((t, i) => `
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
        document.getElementById('feed-list').innerHTML = '<div class="feed-empty">Nog geen uploads. Upload een foto of video bij een opdracht!</div>';
        return;
    }
    document.getElementById('feed-list').innerHTML = allUploads.map(u => {
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
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.className = `toast ${type}`, 2500);
}

// Close modal on overlay click
document.getElementById('upload-modal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
});

// Enter key on name input
document.getElementById('team-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinTeam();
});

document.addEventListener('DOMContentLoaded', init);
