const express = require('express');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Optional Supabase ───────────────────────────────────────────────────────
// Set SUPABASE_URL and SUPABASE_SERVICE_KEY in environment to enable persistence.
// Without these, everything runs in-memory (resets on server restart).
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    console.log('✅ Supabase connected');
  } catch (e) {
    console.warn('⚠️  Supabase package not installed, running in-memory. Run: npm install @supabase/supabase-js');
  }
}

// ─── Admin password ──────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'barcelona2025';

// ─── In-memory state ─────────────────────────────────────────────────────────
const teams   = {};
const uploads = {};

// Quiz/minigame state
let activeQuestion = null;  // { id, type, question, options, answer, pts, openedAt, answers:{teamId:{answer,ts}} }
let questionHistory = [];   // past questions with results

// ─── File upload ─────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|mp4|mov|webm/.test(path.extname(file.originalname).toLowerCase());
    cb(null, ok ? null : new Error('Only images/videos'), ok);
  }
});

const TEAM_COLORS = ['#E85D4A','#4A90D9','#27AE60','#9B59B6','#F39C12','#1ABC9C','#E91E8C','#FF6B35'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.body?.adminPassword || req.query?.adminPassword;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── WebSocket helpers ────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function getLeaderboard() {
  return Object.values(teams).sort((a, b) => b.score - a.score);
}

function safeQuestion() {
  if (!activeQuestion) return null;
  // Don't send the answer to clients
  const { answer, ...safe } = activeQuestion;
  return safe;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    teams:    getLeaderboard(),
    uploads:  Object.values(uploads).sort((a, b) => b.timestamp - a.timestamp),
    question: safeQuestion()
  }));
});

// ─── MISSIONS ─────────────────────────────────────────────────────────────────
const MISSIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'missions.json'), 'utf8'));
app.get('/api/missions', (req, res) => res.json(MISSIONS));

// ─── TEAMS ────────────────────────────────────────────────────────────────────
app.get('/api/teams', (req, res) => res.json(getLeaderboard()));

app.post('/api/teams', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (Object.values(teams).find(t => t.name.toLowerCase() === name.trim().toLowerCase()))
    return res.status(400).json({ error: 'Team name already taken' });

  const id    = uuidv4();
  const color = TEAM_COLORS.find(c => !Object.values(teams).map(t => t.color).includes(c))
                || TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];

  const team = { id, name: name.trim(), color, score: 0, completedMissions: [], uploads: [] };
  teams[id]  = team;

  if (supabase) await supabase.from('teams').insert(team).catch(console.error);

  broadcast({ type: 'teams_update', teams: getLeaderboard() });
  res.json(team);
});

app.post('/api/teams/:teamId/missions/:missionId', async (req, res) => {
  const team    = teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const missionId = parseInt(req.params.missionId);
  const mission   = MISSIONS.find(m => m.id === missionId);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  const idx = team.completedMissions.indexOf(missionId);
  if (idx === -1) { team.completedMissions.push(missionId); team.score += mission.pts; }
  else            { team.completedMissions.splice(idx, 1);  team.score -= mission.pts; }

  if (supabase) await supabase.from('teams').update({ score: team.score, completedMissions: team.completedMissions }).eq('id', team.id).catch(console.error);

  broadcast({ type: 'teams_update', teams: getLeaderboard() });
  res.json(team);
});

// ─── UPLOADS ──────────────────────────────────────────────────────────────────
app.get('/api/uploads', (req, res) => res.json(Object.values(uploads).sort((a, b) => b.timestamp - a.timestamp)));

app.post('/api/teams/:teamId/upload', upload.single('file'), async (req, res) => {
  const team = teams[req.params.teamId];
  if (!team)     return res.status(404).json({ error: 'Team not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const record = {
    id: uuidv4(), teamId: req.params.teamId, teamName: team.name, teamColor: team.color,
    missionId: parseInt(req.body.missionId), filename: req.file.filename,
    originalName: req.file.originalname, url: `/uploads/${req.file.filename}`, timestamp: Date.now()
  };
  uploads[record.id] = record;
  team.uploads.push(record.id);

  if (supabase) await supabase.from('uploads').insert(record).catch(console.error);

  broadcast({ type: 'new_upload', upload: record, teamName: team.name });
  res.json(record);
});

// ─── QUIZ / MINIGAMES (admin only) ───────────────────────────────────────────

// Preset questions the admin can choose from
const PRESET_QUESTIONS = [
  // Multiple choice
  { type: 'mcq', question: 'Wat is de officiële taal van Catalonië naast Spaans?', options: ['Catalaans','Valenciaans','Galicisch','Baskisch'], answer: 'Catalaans', pts: 20 },
  { type: 'mcq', question: 'Welk jaar werd de Sagrada Família gestart?', options: ['1882','1900','1865','1920'], answer: '1882', pts: 20 },
  { type: 'mcq', question: 'Welke architect ontwierp de Sagrada Família?', options: ['Antoni Gaudí','Pablo Picasso','Salvador Dalí','Lluís Domènech'], answer: 'Antoni Gaudí', pts: 20 },
  { type: 'mcq', question: 'In welke wijk ligt de Barceloneta?', options: ['Ciutat Vella','Gràcia','Eixample','Sants'], answer: 'Ciutat Vella', pts: 20 },
  { type: 'mcq', question: 'Welke voetbalclub speelt in het Camp Nou?', options: ['FC Barcelona','Espanyol','Atletico','Real Madrid'], answer: 'FC Barcelona', pts: 15 },
  { type: 'mcq', question: 'Hoe heet de beroemde markt op Las Ramblas?', options: ['La Boqueria','El Mercado','La Plaça','La Fira'], answer: 'La Boqueria', pts: 15 },
  { type: 'mcq', question: 'Welke kleur heeft de vlag van Catalonië NIET?', options: ['Groen','Geel','Rood','Blauw'], answer: 'Groen', pts: 20 },
  { type: 'mcq', question: 'Wat betekent "Gràcies" in het Catalaans?', options: ['Dankjewel','Hallo','Tot ziens','Sorry'], answer: 'Dankjewel', pts: 10 },
  // Open questions
  { type: 'open', question: 'Hoeveel meter hoog wordt de Sagrada Família als ze klaar is? (afronden op 10)', answer: '170', pts: 25 },
  { type: 'open', question: 'In welk jaar werd FC Barcelona opgericht?', answer: '1899', pts: 20 },
  { type: 'open', question: 'Hoeveel inwoners heeft Barcelona (afronden op 100.000)?', answer: '1600000', pts: 25 },
];

// Get presets (admin)
app.get('/api/admin/presets', adminAuth, (req, res) => res.json(PRESET_QUESTIONS));

// Push a question (admin)
app.post('/api/admin/question', adminAuth, (req, res) => {
  const { type, question, options, answer, pts, presetIndex } = req.body;

  let q;
  if (presetIndex !== undefined && PRESET_QUESTIONS[presetIndex]) {
    q = { ...PRESET_QUESTIONS[presetIndex] };
  } else {
    if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
    q = { type: type || 'open', question, options: options || [], answer, pts: pts || 20 };
  }

  activeQuestion = { ...q, id: uuidv4(), openedAt: Date.now(), answers: {} };
  broadcast({ type: 'new_question', question: safeQuestion() });
  res.json({ ok: true, question: safeQuestion() });
});

// Close question (admin) — reveal answer + award points
app.post('/api/admin/question/close', adminAuth, (req, res) => {
  if (!activeQuestion) return res.status(400).json({ error: 'No active question' });

  const results = [];
  // Sort answers by timestamp → first correct answer gets full pts, rest get partial
  const sorted = Object.entries(activeQuestion.answers)
    .sort(([, a], [, b]) => a.ts - b.ts);

  let firstCorrect = true;
  sorted.forEach(([teamId, { answer, ts }]) => {
    const team = teams[teamId];
    if (!team) return;
    const correct = answer.trim().toLowerCase() === activeQuestion.answer.trim().toLowerCase();
    let awarded = 0;
    if (correct) {
      awarded = firstCorrect ? activeQuestion.pts : Math.floor(activeQuestion.pts / 2);
      firstCorrect = false;
      team.score += awarded;
    }
    results.push({ teamId, teamName: team.name, teamColor: team.color, answer, correct, awarded, ts });
  });

  const closed = { ...activeQuestion, closedAt: Date.now(), results };
  questionHistory.unshift(closed);
  activeQuestion = null;

  broadcast({ type: 'question_closed', answer: closed.answer, results, teams: getLeaderboard() });
  res.json({ ok: true, results });
});

// Submit answer (player)
app.post('/api/quiz/answer', (req, res) => {
  const { teamId, answer } = req.body;
  if (!activeQuestion) return res.status(400).json({ error: 'No active question' });
  if (!teams[teamId])  return res.status(404).json({ error: 'Team not found' });
  if (activeQuestion.answers[teamId]) return res.status(400).json({ error: 'Already answered' });

  activeQuestion.answers[teamId] = { answer, ts: Date.now() };

  // Tell admin someone answered (without revealing)
  broadcast({ type: 'answer_received', teamName: teams[teamId].name, count: Object.keys(activeQuestion.answers).length });
  res.json({ ok: true });
});

// Admin: adjust score manually
app.post('/api/admin/teams/:teamId/score', adminAuth, (req, res) => {
  const team = teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const delta = parseInt(req.body.delta) || 0;
  team.score = Math.max(0, team.score + delta);
  broadcast({ type: 'teams_update', teams: getLeaderboard() });
  res.json(team);
});

// Admin: get question history
app.get('/api/admin/history', adminAuth, (req, res) => res.json(questionHistory));

// Admin: verify admin password
app.post('/api/admin/auth', (req, res) => {
  const pw = req.body?.password;
  if (pw === ADMIN_PASSWORD) res.json({ ok: true });
  else res.status(401).json({ error: 'Wrong password' });
});

// Reset all
app.post('/api/reset', adminAuth, (req, res) => {
  Object.keys(teams).forEach(k => delete teams[k]);
  Object.keys(uploads).forEach(k => delete uploads[k]);
  activeQuestion = null;
  questionHistory = [];
  try { fs.readdirSync(UPLOADS_DIR).forEach(f => { try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch(e){} }); } catch(e){}
  broadcast({ type: 'reset' });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Barcelona Stadsspel on http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin.html`));
