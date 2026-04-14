
let adminPw = '';
let ws = null;
let allTeams = [];
let activeQ = null;
let selectedPreset = null;
let presets = [];
let history = [];

// ─── LOGIN ────────────────────────────────────────────────────────────────────
document.querySelector('#pw-input').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

async function doLogin() {
  const pw = document.querySelector('#pw-input').value;
  const res = await fetch('/api/admin/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:pw}) });
  if (res.ok) {
    adminPw = pw;
    document.querySelector('#login-screen').style.display = 'none';
    document.querySelector('#app').style.display = 'block';
    init();
  } else {
    document.querySelector('#login-error').style.display = 'block';
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  presets = await adminApi('GET', '/api/admin/presets');
  history = await adminApi('GET', '/api/admin/history');
  renderPresets();
  renderHistory();
  connectWS();
  checkSupabase();
}

function adminApi(method, path, body) {
  const opts = { method, headers: { 'Content-Type':'application/json', 'x-admin-password': adminPw } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts).then(r => r.json());
}

// ─── WS ───────────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { document.querySelector('#ws-dot').className='dot live'; document.querySelector('#ws-txt').textContent='Live'; };
  ws.onclose = () => { document.querySelector('#ws-dot').className='dot'; document.querySelector('#ws-txt').textContent='Offline'; setTimeout(connectWS,3000); };
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === 'init') {
      allTeams = d.teams;
      if (d.question) { activeQ = d.question; renderActiveQ(); }
      renderLB();
    } else if (d.type === 'teams_update') {
      allTeams = d.teams; renderLB();
    } else if (d.type === 'answer_received') {
      document.querySelector('#answer-count').textContent = d.count + ' antwoord' + (d.count===1?'':'en');
      toast(`${d.teamName} heeft geantwoord`, 'ok');
    } else if (d.type === 'question_closed') {
      activeQ = null;
      renderActiveQ();
      renderResults(d);
      allTeams = d.teams; renderLB();
    } else if (d.type === 'reset') {
      allTeams=[]; activeQ=null; history=[];
      renderLB(); renderActiveQ(); renderHistory();
    }
  };
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
function renderLB() {
  const el = document.querySelector('#lb-list');
  document.querySelector('#team-count').textContent = allTeams.length + ' team' + (allTeams.length===1?'':'s');
  if (!allTeams.length) { el.innerHTML='<div style="color:var(--muted);font-size:13px">Nog geen teams.</div>'; return; }
  const ranks = ['gold','silver','bronze'];
  el.innerHTML = allTeams.map((t,i) => `
    <div class="lb-row">
      <div class="lb-rank ${ranks[i]||''}">${i+1}</div>
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
    </div>`).join('');
}

async function adjScore(teamId, delta) {
  await adminApi('POST', `/api/admin/teams/${teamId}/score`, { delta });
}

// ─── PRESETS ──────────────────────────────────────────────────────────────────
function renderPresets() {
  document.querySelector('#preset-grid').innerHTML = presets.map((p,i) => `
    <div class="preset-card" id="pc-${i}" onclick="selectPreset(${i})">
      <div class="preset-type">${p.type === 'mcq' ? '4 opties' : 'open'}</div>
      <div class="preset-q">${esc(p.question)}</div>
      <div class="preset-pts">+${p.pts} pt</div>
    </div>`).join('');
}

function selectPreset(i) {
  document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
  document.querySelector('#pc-'+i).classList.add('selected');
  selectedPreset = i;
  document.querySelector('#push-preset-btn').disabled = false;
}

async function pushPreset() {
  if (selectedPreset === null) return;
  if (activeQ) { if(!confirm('Er is al een actieve vraag. Toch vervangen?')) return; }
  await adminApi('POST', '/api/admin/question', { presetIndex: selectedPreset });
  activeQ = presets[selectedPreset];
  renderActiveQ();
  toast('Vraag gepusht!', 'ok');
  selectedPreset = null;
  document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
  document.querySelector('#push-preset-btn').disabled = true;
}

// ─── CUSTOM ───────────────────────────────────────────────────────────────────
function toggleOptions() {
  const isMcq = document.querySelector('#q-type').value === 'mcq';
  document.querySelector('#options-wrap').style.display = isMcq ? 'block' : 'none';
}

async function pushCustom() {
  const type     = document.querySelector('#q-type').value;
  const question = document.querySelector('#q-question').value.trim();
  const answer   = document.querySelector('#q-answer').value.trim();
  const pts      = parseInt(document.querySelector('#q-pts').value) || 20;
  if (!question || !answer) return toast('Vul vraag en antwoord in', 'err');
  let options = [];
  if (type === 'mcq') {
    options = ['opt-a','opt-b','opt-c','opt-d'].map(id => document.getElementById(id).value.trim()).filter(Boolean);
    if (options.length < 2) return toast('Voeg minstens 2 opties in', 'err');
  }
  if (activeQ) { if(!confirm('Er is al een actieve vraag. Toch vervangen?')) return; }
  await adminApi('POST', '/api/admin/question', { type, question, options, answer, pts });
  renderActiveQ();
  toast('Vraag gepusht!', 'ok');
}

// ─── ACTIVE QUESTION ──────────────────────────────────────────────────────────
function renderActiveQ() {
  const sec = document.querySelector('#active-section');
  const disp = document.querySelector('#active-q-display');
  if (!activeQ) { sec.style.display='none'; return; }
  sec.style.display='block';
  document.querySelector('#answer-count').textContent = '0 antwoorden';
  const opts = activeQ.options?.length
    ? `<div class="aq-options">${activeQ.options.map(o=>`<div class="aq-opt">${esc(o)}</div>`).join('')}</div>` : '';
  disp.innerHTML = `
    <div class="aq-label">Actieve vraag · ${activeQ.type === 'mcq' ? 'Multiple choice' : 'Open'} · +${activeQ.pts} pt</div>
    <div class="aq-question">${esc(activeQ.question)}</div>
    ${opts}`;
}

async function closeQuestion() {
  const res = await adminApi('POST', '/api/admin/question/close');
  if (res.error) return toast(res.error, 'err');
  history = await adminApi('GET', '/api/admin/history');
  renderHistory();
  toast('Vraag gesloten, punten toegekend!', 'ok');
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────
function renderResults(d) {
  const sec = document.querySelector('#result-section');
  sec.style.display = 'block';
  document.querySelector('#result-answer-pill').textContent = 'Antwoord: ' + d.answer;
  document.querySelector('#result-list').innerHTML = d.results.length
    ? d.results.map(r => `
      <div class="result-row ${r.correct?'correct':'wrong'}">
        <div class="lb-dot" style="background:${r.teamColor}"></div>
        <div class="result-name">${esc(r.teamName)}</div>
        <div class="result-answer">${esc(r.answer)}</div>
        <div class="result-pts ${r.awarded>0?'pos':'zero'}">${r.awarded>0?'+'+r.awarded:'✗'}</div>
      </div>`).join('')
    : '<div style="color:var(--muted);font-size:13px">Niemand heeft geantwoord.</div>';
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
function renderHistory() {
  document.querySelector('#hist-count').textContent = history.length;
  document.querySelector('#hist-list').innerHTML = history.length
    ? history.map(h => `
      <div class="hist-item">
        <div class="hist-q">${esc(h.question)}</div>
        <div class="hist-ans">Antwoord: ${esc(h.answer)} · ${h.results?.length||0} antw.</div>
      </div>`).join('')
    : '<div style="color:var(--muted);font-size:13px">Nog geen gesloten vragen.</div>';
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelector('#tab-'+name).classList.add('active');
}

// ─── RESET ────────────────────────────────────────────────────────────────────
async function doReset() {
  if (!confirm('Alles wissen? Teams, scores, uploads en vragen worden verwijderd.')) return;
  await adminApi('POST', '/api/reset');
  toast('Alles gereset!', 'ok');
}

// ─── SUPABASE CHECK ───────────────────────────────────────────────────────────
async function checkSupabase() {
  const el = document.querySelector('#supabase-status');
  try {
    const res = await fetch('/api/teams');
    el.innerHTML = res.ok
      ? '<span style="color:var(--muted)">Server draait (in-memory modus). Stel SUPABASE_URL + SUPABASE_SERVICE_KEY in als env variabelen voor persistentie.</span>'
      : '<span style="color:var(--red)">Server niet bereikbaar</span>';
  } catch(e) { el.innerHTML = '<span style="color:var(--red)">Server niet bereikbaar</span>'; }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type='') {
  const t = document.querySelector('#toast');
  t.textContent = msg; t.className = `toast ${type} show`;
  setTimeout(() => t.className = `toast ${type}`, 2500);
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
