require("dotenv").config();

const express = require("express");
const { WebSocketServer } = require("ws");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const http = require("http");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Optional Supabase ───────────────────────────────────────────────────────
// Set SUPABASE_URL and SUPABASE_SERVICE_KEY in environment to enable persistence.
// Without these, everything runs in-memory (resets on server restart).
let supabase = null;
const realtimeState = {
  teamsChannelReady: false,
  uploadsChannelReady: false,
  lastStatus: "disabled",
  lastError: null,
  envLoaded: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
  keyType: process.env.SUPABASE_SERVICE_KEY?.startsWith("sb_publishable_")
    ? "publishable"
    : process.env.SUPABASE_SERVICE_KEY
      ? "service"
      : "missing",
};
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  try {
    const { createClient } = require("@supabase/supabase-js");
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );
    console.log("✅ Supabase connected");
  } catch (e) {
    console.warn(
      "⚠️  Supabase package not installed, running in-memory. Run: npm install @supabase/supabase-js",
    );
  }
}

// ─── Admin password ──────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bcn5";

// ─── In-memory state ─────────────────────────────────────────────────────────
const teams = {};
const uploads = {};

// Quiz/minigame state
let activeQuestion = null; // { id, type, question, options, answer, pts, openedAt, answers:{teamId:{answer,ts}} }
let questionHistory = []; // past questions with results

// ─── File upload ─────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) =>
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  // fileFilter: async (req, file) => {
  //   const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  //   const allowed = ["jpeg", "jpg", "png", "gif", "mp4", "mov", "webm"];
  //   if (!allowed.includes(ext))
  //     throw new Error(`File type .${ext} not allowed`);
  // },
});

const TEAM_COLORS = [
  "#E85D4A",
  "#4A90D9",
  "#27AE60",
  "#9B59B6",
  "#F39C12",
  "#1ABC9C",
  "#E91E8C",
  "#FF6B35",
];

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const pw =
    req.headers["x-admin-password"] ||
    req.body?.adminPassword ||
    req.query?.adminPassword;
  if (pw !== ADMIN_PASSWORD)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ─── WebSocket helpers ────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}

function isRealtimeHealthy() {
  return realtimeState.teamsChannelReady && realtimeState.uploadsChannelReady;
}

function shouldBroadcastDirectly() {
  return !supabase || !isRealtimeHealthy();
}

function getLeaderboard() {
  return Object.values(teams).sort((a, b) => b.score - a.score);
}

function getUploadsSorted() {
  return Object.values(uploads).sort((a, b) => b.timestamp - a.timestamp);
}

function normalizeTeam(raw) {
  if (!raw || !raw.id || !raw.name) return null;
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color || TEAM_COLORS[0],
    score: Number(raw.score) || 0,
    completedMissions: Array.isArray(raw.completedMissions)
      ? raw.completedMissions.map((m) => Number(m))
      : [],
    uploads: Array.isArray(raw.uploads) ? raw.uploads : [],
  };
}

function normalizeUpload(raw) {
  if (!raw || !raw.id || !raw.teamId || !raw.filename) return null;
  return {
    id: raw.id,
    teamId: raw.teamId,
    teamName: raw.teamName || "Onbekend team",
    teamColor: raw.teamColor || "#666",
    missionId: Number(raw.missionId),
    activity: raw.activity || "mission_upload",
    filename: raw.filename,
    originalName: raw.originalName || raw.filename,
    url: raw.url || `/uploads/${raw.filename}`,
    timestamp: Number(raw.timestamp) || Date.now(),
  };
}

async function saveTeamToSupabase(team) {
  if (!supabase) return;
  const payload = normalizeTeam(team);
  if (!payload) return;
  const { error } = await supabase
    .from("teams")
    .upsert(
      {
        id: payload.id,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (error) throw error;
}

async function saveUploadToSupabase(record) {
  if (!supabase) return;
  const payload = normalizeUpload(record);
  if (!payload) return;
  const { error } = await supabase.from("uploads").upsert(
    {
      id: payload.id,
      payload,
      created_at: new Date(payload.timestamp).toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

function applyTeamPayload(payload) {
  const team = normalizeTeam(payload);
  if (!team) return null;
  teams[team.id] = team;
  return team;
}

function applyUploadPayload(payload) {
  const record = normalizeUpload(payload);
  if (!record) return null;
  uploads[record.id] = record;
  return record;
}

async function bootstrapFromSupabase() {
  if (!supabase) return;
  const [teamsResult, uploadsResult] = await Promise.all([
    supabase.from("teams").select("id,payload"),
    supabase.from("uploads").select("id,payload"),
  ]);

  if (teamsResult.error) throw teamsResult.error;
  if (uploadsResult.error) throw uploadsResult.error;

  Object.keys(teams).forEach((k) => delete teams[k]);
  Object.keys(uploads).forEach((k) => delete uploads[k]);

  (teamsResult.data || []).forEach((row) => applyTeamPayload(row.payload));
  (uploadsResult.data || []).forEach((row) => applyUploadPayload(row.payload));

  console.log(
    `📦 Loaded from Supabase: ${Object.keys(teams).length} teams, ${Object.keys(uploads).length} uploads`,
  );
}

function startRealtimeSync() {
  if (!supabase) return;

  const teamsChannel = supabase
    .channel(`teams-sync-${process.pid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "teams" },
      (evt) => {
        const row = evt.eventType === "DELETE" ? evt.old : evt.new;
        if (!row) return;

        if (evt.eventType === "DELETE") {
          const id = row.id || row.payload?.id;
          if (id && teams[id]) {
            delete teams[id];
            broadcast({ type: "teams_update", teams: getLeaderboard() });
          }
          return;
        }

        const changed = applyTeamPayload(row.payload);
        if (changed) {
          broadcast({ type: "teams_update", teams: getLeaderboard() });
        }
      },
    )
    .subscribe((status) => {
      realtimeState.teamsChannelReady = status === "SUBSCRIBED";
      realtimeState.lastStatus = status;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        realtimeState.lastError = `teams channel ${status}`;
      }
      if (status === "SUBSCRIBED") {
        console.log("🔄 Supabase realtime: teams subscribed");
      }
    });

  const uploadsChannel = supabase
    .channel(`uploads-sync-${process.pid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "uploads" },
      (evt) => {
        const row = evt.eventType === "DELETE" ? evt.old : evt.new;
        if (!row) return;

        if (evt.eventType === "DELETE") {
          const id = row.id || row.payload?.id;
          if (id && uploads[id]) delete uploads[id];
          return;
        }

        const changed = applyUploadPayload(row.payload);
        if (changed && evt.eventType === "INSERT") {
          const team = teams[changed.teamId];
          if (team && !team.uploads.includes(changed.id)) team.uploads.push(changed.id);
          broadcast({
            type: "new_upload",
            upload: changed,
            teamName: changed.teamName,
            activity: changed.activity,
          });
        }
      },
    )
    .subscribe((status) => {
      realtimeState.uploadsChannelReady = status === "SUBSCRIBED";
      realtimeState.lastStatus = status;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        realtimeState.lastError = `uploads channel ${status}`;
      }
      if (status === "SUBSCRIBED") {
        console.log("🔄 Supabase realtime: uploads subscribed");
      }
    });

  return { teamsChannel, uploadsChannel };
}

function safeQuestion() {
  if (!activeQuestion) return null;
  // Don't send the answer to clients
  const { answer, ...safe } = activeQuestion;
  return safe;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "init",
      teams: getLeaderboard(),
      uploads: getUploadsSorted(),
      question: safeQuestion(),
    }),
  );
});

// ─── MISSIONS ─────────────────────────────────────────────────────────────────
const MISSIONS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "missions.json"), "utf8"),
);
app.get("/api/missions", (req, res) => res.json(MISSIONS));

// ─── TEAMS ────────────────────────────────────────────────────────────────────
app.get("/api/teams", (req, res) => res.json(getLeaderboard()));

app.get("/api/system/status", (req, res) => {
  res.json({
    mode: supabase
      ? isRealtimeHealthy()
        ? "supabase-realtime"
        : "supabase"
      : "in-memory",
    supabaseEnabled: Boolean(supabase),
    envLoaded: realtimeState.envLoaded,
    keyType: realtimeState.keyType,
    realtime: {
      teamsChannelReady: realtimeState.teamsChannelReady,
      uploadsChannelReady: realtimeState.uploadsChannelReady,
      healthy: isRealtimeHealthy(),
      lastStatus: realtimeState.lastStatus,
      lastError: realtimeState.lastError,
    },
    counts: {
      teams: Object.keys(teams).length,
      uploads: Object.keys(uploads).length,
    },
  });
});

app.post("/api/teams", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });
  if (
    Object.values(teams).find(
      (t) => t.name.toLowerCase() === name.trim().toLowerCase(),
    )
  )
    return res.status(400).json({ error: "Team name already taken" });

  const id = uuidv4();
  const color =
    TEAM_COLORS.find(
      (c) =>
        !Object.values(teams)
          .map((t) => t.color)
          .includes(c),
    ) || TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];

  const team = {
    id,
    name: name.trim(),
    color,
    score: 0,
    completedMissions: [],
    uploads: [],
  };
  teams[id] = team;

  if (supabase) {
    try {
      await saveTeamToSupabase(team);
    } catch (e) {
      console.error("Failed to persist team:", e.message || e);
      return res.status(500).json({ error: "Team opslaan mislukt" });
    }
  }

  if (shouldBroadcastDirectly()) {
    broadcast({ type: "teams_update", teams: getLeaderboard() });
  }
  res.json(team);
});

app.post("/api/teams/:teamId/missions/:missionId", async (req, res) => {
  const team = teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: "Team not found" });
  const missionId = parseInt(req.params.missionId);
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const idx = team.completedMissions.indexOf(missionId);
  if (idx === -1) {
    team.completedMissions.push(missionId);
    team.score += mission.pts;
  } else {
    team.completedMissions.splice(idx, 1);
    team.score -= mission.pts;
  }

  if (supabase) {
    try {
      await saveTeamToSupabase(team);
    } catch (e) {
      console.error("Failed to persist mission update:", e.message || e);
      return res.status(500).json({ error: "Missie-update opslaan mislukt" });
    }
  }

  if (shouldBroadcastDirectly()) {
    broadcast({ type: "teams_update", teams: getLeaderboard() });
  }
  res.json(team);
});

// ─── UPLOADS ──────────────────────────────────────────────────────────────────
app.get("/api/uploads", (req, res) =>
  res.json(getUploadsSorted()),
);

app.post(
  "/api/teams/:teamId/upload",
  upload.single("file"),
  async (req, res) => {
    const team = teams[req.params.teamId];
    if (!team) return res.status(404).json({ error: "Team not found" });
    if (!req.file) return res.status(400).json({ error: "No file" });
    console.log(`Received upload from team ${team.name}:`, req.file.originalname);
    const record = {
      id: uuidv4(),
      teamId: req.params.teamId,
      teamName: team.name,
      teamColor: team.color,
      missionId: parseInt(req.body.missionId),
      activity: req.body.activity,
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      timestamp: Date.now(),
    };

    uploads[record.id] = record;
    team.uploads.push(record.id);

    if (supabase) {
      try {
        await Promise.all([saveUploadToSupabase(record), saveTeamToSupabase(team)]);
      } catch (e) {
        console.error("Failed to persist upload:", e.message || e);
        return res.status(500).json({ error: "Upload opslaan mislukt" });
      }
    }

    if (shouldBroadcastDirectly()) {
      broadcast({
        type: "new_upload",
        upload: record,
        teamName: team.name,
        activity: req.body.activity,
      });
    }
    res.json(record);
  },
);

// ─── QUIZ / MINIGAMES (admin only) ───────────────────────────────────────────

// Preset questions the admin can choose from
const PRESET_QUESTIONS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "questions.json"), "utf8"),
);

// Get presets (admin)
app.get("/api/admin/presets", adminAuth, (req, res) =>
  res.json(PRESET_QUESTIONS),
);

// Push a question (admin)
app.post("/api/admin/question", adminAuth, (req, res) => {
  const { type, question, options, answer, pts, presetIndex } = req.body;
  console.log("Pushing question:", req.body);
  let q;
  if (presetIndex !== undefined && PRESET_QUESTIONS[presetIndex]) {
    q = { ...PRESET_QUESTIONS[presetIndex] };
  } else {
    if (!question || !answer)
      return res.status(400).json({ error: "question and answer required" });
    q = {
      type: type || "open",
      question,
      options: options || [],
      answer,
      pts: pts || 20,
    };
  }

  activeQuestion = { ...q, id: uuidv4(), openedAt: Date.now(), answers: {} };
  broadcast({ type: "new_question", question: safeQuestion() });
  res.json({ ok: true, question: safeQuestion() });
});

// Close question (admin) — reveal answer + award points
app.post("/api/admin/question/close", adminAuth, async (req, res) => {
  if (!activeQuestion)
    return res.status(400).json({ error: "No active question" });

  const results = [];
  // Sort answers by timestamp → first correct answer gets full pts, rest get partial
  const sorted = Object.entries(activeQuestion.answers).sort(
    ([, a], [, b]) => a.ts - b.ts,
  );

  let firstCorrect = true;
  const persistOps = [];
  sorted.forEach(([teamId, { answer, ts }]) => {
    const team = teams[teamId];
    if (!team) return;
    const correct =
      String(answer).trim().toLowerCase() ===
      String(activeQuestion.answer).trim().toLowerCase();
    let awarded = 0;
    if (correct) {
      awarded = firstCorrect
        ? activeQuestion.pts
        : Math.floor(activeQuestion.pts / 2);
      firstCorrect = false;
      team.score += awarded;
      if (supabase) {
        // Persist each changed team score; realtime will fan out updates.
        persistOps.push(saveTeamToSupabase(team));
      }
    }
    results.push({
      teamId,
      teamName: team.name,
      teamColor: team.color,
      answer,
      correct,
      awarded,
      ts,
    });
  });

  const closed = { ...activeQuestion, closedAt: Date.now(), results };
  questionHistory.unshift(closed);
  activeQuestion = null;

  if (persistOps.length) {
    try {
      await Promise.all(persistOps);
    } catch (e) {
      console.error("Failed to persist quiz score:", e.message || e);
      return res.status(500).json({ error: "Quiz-resultaten opslaan mislukt" });
    }
  }

  broadcast({
    type: "question_closed",
    answer: closed.answer,
    results,
    teams: getLeaderboard(),
  });
  res.json({ ok: true, results });
});

// Submit answer (player)
app.post("/api/quiz/answer", (req, res) => {
  const { teamId, answer } = req.body;
  if (!activeQuestion)
    return res.status(400).json({ error: "No active question" });
  if (!teams[teamId]) return res.status(404).json({ error: "Team not found" });
  if (activeQuestion.answers[teamId])
    return res.status(400).json({ error: "Already answered" });

  activeQuestion.answers[teamId] = { answer, ts: Date.now() };

  // Tell admin someone answered (without revealing)
  broadcast({
    type: "answer_received",
    teamName: teams[teamId].name,
    count: Object.keys(activeQuestion.answers).length,
  });
  res.json({ ok: true });
});

// Admin: adjust score manually
app.post("/api/admin/teams/:teamId/score", adminAuth, async (req, res) => {
  const team = teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: "Team not found" });
  const delta = parseInt(req.body.delta) || 0;
  team.score = Math.max(0, team.score + delta);

  if (supabase) {
    try {
      await saveTeamToSupabase(team);
    } catch (e) {
      console.error("Failed to persist score adjustment:", e.message || e);
      return res.status(500).json({ error: "Score-update opslaan mislukt" });
    }
  }
  if (shouldBroadcastDirectly()) {
    broadcast({ type: "teams_update", teams: getLeaderboard() });
  }
  return res.json(team);
});

// Admin: get question history
app.get("/api/admin/history", adminAuth, (req, res) =>
  res.json(questionHistory),
);

// Admin: verify admin password
app.post("/api/admin/auth", (req, res) => {
  const pw = req.body?.password;
  if (pw === ADMIN_PASSWORD) res.json({ ok: true });
  else res.status(401).json({ error: "Wrong password" });
});

// Reset all
app.post("/api/reset", adminAuth, async (req, res) => {
  Object.keys(teams).forEach((k) => delete teams[k]);
  Object.keys(uploads).forEach((k) => delete uploads[k]);
  activeQuestion = null;
  questionHistory = [];

  if (supabase) {
    try {
      const [teamsDelete, uploadsDelete] = await Promise.all([
        supabase
          .from("teams")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000"),
        supabase
          .from("uploads")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000"),
      ]);
      if (teamsDelete.error) throw teamsDelete.error;
      if (uploadsDelete.error) throw uploadsDelete.error;
    } catch (e) {
      console.error("Failed to reset Supabase data:", e.message || e);
    }
  }

  try {
    fs.readdirSync(UPLOADS_DIR).forEach((f) => {
      try {
        fs.unlinkSync(path.join(UPLOADS_DIR, f));
      } catch (e) {}
    });
  } catch (e) {}
  broadcast({ type: "reset" });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

async function start() {
  if (supabase) {
    try {
      await bootstrapFromSupabase();
      startRealtimeSync();
    } catch (e) {
      realtimeState.lastError = e.message || String(e);
      console.error(
        "⚠️  Supabase bootstrap failed, continuing with in-memory cache:",
        e.message || e,
      );
    }
  }

  server.listen(PORT, () =>
    console.log(
      `🚀 Barcelona Stadsspel on http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin.html`,
    ),
  );
}

start();
