const express = require('express');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

// CORS configuration
app.use(cors({ origin: 'http://127.0.0.1:5500' }));

// In-memory state
const teams = {}; // { teamId: { id, name, color, score, completedMissions, uploads } }
const uploads = {}; // { uploadId: { id, teamId, missionId, filename, originalName, timestamp } }

// Ensure uploads dir exists
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|mp4|mov|webm/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) ||
               allowed.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Only images/videos allowed'));
  }
});

const TEAM_COLORS = ['#E85D4A','#4A90D9','#27AE60','#9B59B6','#F39C12','#1ABC9C','#E91E8C','#FF6B35'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- REST API ---

// Get all teams (leaderboard)
app.get('/api/teams', (req, res) => {
  const sorted = Object.values(teams).sort((a, b) => b.score - a.score);
  res.json(sorted);
});

// Create team
app.post('/api/teams', (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 1) return res.status(400).json({ error: 'Name required' });
  const existing = Object.values(teams).find(t => t.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) return res.status(400).json({ error: 'Team name already taken' });

  const id = uuidv4();
  const usedColors = Object.values(teams).map(t => t.color);
  const color = TEAM_COLORS.find(c => !usedColors.includes(c)) || TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];

  teams[id] = { id, name: name.trim(), color, score: 0, completedMissions: [], uploads: [] };
  broadcast({ type: 'teams_update', teams: getLeaderboard() });
  res.json(teams[id]);
});

// Complete / uncomplete a mission
app.post('/api/teams/:teamId/missions/:missionId', (req, res) => {
  const team = teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const missionId = parseInt(req.params.missionId);
  const mission = MISSIONS.find(m => m.id === missionId);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  const idx = team.completedMissions.indexOf(missionId);
  if (idx === -1) {
    team.completedMissions.push(missionId);
    team.score += mission.pts;
  } else {
    team.completedMissions.splice(idx, 1);
    team.score -= mission.pts;
  }

  broadcast({ type: 'teams_update', teams: getLeaderboard() });
  res.json(team);
});

// Upload photo/video for a mission
app.post('/api/teams/:teamId/upload', upload.single('file'), (req, res) => {
  const team = teams[req.params.teamId];
  console.log('Received upload request for team', req.body);
  console.log('Upload request for team', req.params.teamId, 'file:', req.file);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const missionId = parseInt(req.body.missionId);
  const uploadId = uuidv4();
  const record = {
    id: uploadId,
    teamId: req.params.teamId,
    teamName: team.name,
    teamColor: team.color,
    missionId,
    filename: req.file.filename,
    originalName: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    timestamp: Date.now()
  };

  uploads[uploadId] = record;
  team.uploads.push(uploadId);

  broadcast({ type: 'new_upload', upload: record, teamName: team.name });
  res.json(record);
});

// Get all uploads
app.get('/api/uploads', (req, res) => {
  const all = Object.values(uploads).sort((a, b) => b.timestamp - a.timestamp);
  res.json(all);
});

// Reset all (admin)
app.post('/api/reset', (req, res) => {
  Object.keys(teams).forEach(k => delete teams[k]);
  Object.keys(uploads).forEach(k => delete uploads[k]);
  // Clear upload files
  fs.readdirSync(UPLOADS_DIR).forEach(f => fs.unlinkSync(path.join(UPLOADS_DIR, f)));
  broadcast({ type: 'reset' });
  res.json({ ok: true });
});

// --- WebSocket ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function getLeaderboard() {
  return Object.values(teams).sort((a, b) => b.score - a.score);
}

wss.on('connection', (ws) => {
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'init', teams: getLeaderboard(), uploads: Object.values(uploads).sort((a,b) => b.timestamp - a.timestamp) }));
});

// --- Missions data ---
const MISSIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'missions.json'), 'utf8'));

// Serve missions list
app.get('/api/missions', (req, res) => res.json(MISSIONS));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Barcelona Stadsspel running on port ${PORT}`));
