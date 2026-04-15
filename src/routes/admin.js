import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { state, getLeaderboard, safeQuestion } from '../state.js';
import { ADMIN_PASSWORD, UPLOADS_DIR, DATA_DIR } from '../config.js';
import { supabase, realtimeState, saveTeam } from '../supabase.js';
import { broadcast } from '../broadcast.js';
import { adminAuth } from '../middleware.js';

const router = Router();

const PRESET_QUESTIONS = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'questions.json'), 'utf8'),
);

// ─── Systeem status ───────────────────────────────────────────────────────────

router.get('/system/status', (req, res) => {
  res.json({
    mode: realtimeState.teamsReady && realtimeState.uploadsReady ? 'supabase-realtime' : 'supabase',
    supabaseEnabled: true,
    envLoaded: true,
    keyType: process.env.SUPABASE_SERVICE_KEY?.startsWith('sb_publishable_') ? 'publishable' : 'service',
    realtime: {
      teamsReady: realtimeState.teamsReady,
      uploadsReady: realtimeState.uploadsReady,
      healthy: realtimeState.teamsReady && realtimeState.uploadsReady,
      lastStatus: realtimeState.lastStatus,
      lastError: realtimeState.lastError,
    },
    counts: {
      teams: Object.keys(state.teams).length,
      uploads: Object.keys(state.uploads).length,
    },
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.post('/admin/auth', (req, res) => {
  const pw = req.body?.password;
  if (pw === ADMIN_PASSWORD) res.json({ ok: true });
  else res.status(401).json({ error: 'Wrong password' });
});

// ─── Vragen ───────────────────────────────────────────────────────────────────

router.get('/admin/presets', adminAuth, (req, res) => res.json(PRESET_QUESTIONS));

router.post('/admin/question', adminAuth, (req, res) => {
  const { type, question, options, answer, pts, presetIndex } = req.body;

  let q;
  if (presetIndex !== undefined && PRESET_QUESTIONS[presetIndex]) {
    q = { ...PRESET_QUESTIONS[presetIndex] };
  } else {
    if (!question || !answer)
      return res.status(400).json({ error: 'question and answer required' });
    q = { type: type || 'open', question, options: options || [], answer, pts: pts || 20 };
  }

  state.activeQuestion = { ...q, id: uuidv4(), openedAt: Date.now(), answers: {} };
  broadcast({ type: 'new_question', question: safeQuestion() });
  res.json({ ok: true, question: safeQuestion() });
});

router.post('/admin/question/close', adminAuth, async (req, res) => {
  if (!state.activeQuestion) return res.status(400).json({ error: 'No active question' });

  const sorted = Object.entries(state.activeQuestion.answers).sort(([, a], [, b]) => a.ts - b.ts);

  let firstCorrect = true;
  const persistOps = [];
  const results = [];

  sorted.forEach(([teamId, { answer, ts }]) => {
    const team = state.teams[teamId];
    if (!team) return;
    const correct =
      String(answer).trim().toLowerCase() ===
      String(state.activeQuestion.answer).trim().toLowerCase();
    let awarded = 0;
    if (correct) {
      awarded = firstCorrect ? state.activeQuestion.pts : Math.floor(state.activeQuestion.pts / 2);
      firstCorrect = false;
      team.score += awarded;
      persistOps.push(saveTeam(team));
    }
    results.push({ teamId, teamName: team.name, teamColor: team.color, answer, correct, awarded, ts });
  });

  const closed = { ...state.activeQuestion, closedAt: Date.now(), results };
  state.questionHistory.unshift(closed);
  state.activeQuestion = null;

  if (persistOps.length) {
    try {
      await Promise.all(persistOps);
    } catch (e) {
      console.error('Failed to persist quiz score:', e.message || e);
      return res.status(500).json({ error: 'Quiz-resultaten opslaan mislukt' });
    }
  }

  broadcast({ type: 'question_closed', answer: closed.answer, results, teams: getLeaderboard() });
  res.json({ ok: true, results });
});

router.get('/admin/history', adminAuth, (req, res) => res.json(state.questionHistory));

// ─── Score aanpassen ──────────────────────────────────────────────────────────

router.post('/admin/teams/:teamId/score', adminAuth, async (req, res) => {
  const team = state.teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const delta = parseInt(req.body.delta) || 0;
  team.score = Math.max(0, team.score + delta);

  try {
    await saveTeam(team);
  } catch (e) {
    console.error('Failed to persist score adjustment:', e.message || e);
    return res.status(500).json({ error: 'Score-update opslaan mislukt' });
  }

  return res.json(team);
});

// ─── Alles resetten ───────────────────────────────────────────────────────────

router.post('/reset', adminAuth, async (req, res) => {
  Object.keys(state.teams).forEach((k) => delete state.teams[k]);
  Object.keys(state.uploads).forEach((k) => delete state.uploads[k]);
  state.activeQuestion = null;
  state.questionHistory = [];

  try {
    const [teamsDelete, uploadsDelete] = await Promise.all([
      supabase.from('teams').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      supabase.from('uploads').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    ]);
    if (teamsDelete.error) throw teamsDelete.error;
    if (uploadsDelete.error) throw uploadsDelete.error;
  } catch (e) {
    console.error('Failed to reset Supabase data:', e.message || e);
  }

  try {
    fs.readdirSync(UPLOADS_DIR).forEach((f) => {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch (_) {}
    });
  } catch (_) {}

  broadcast({ type: 'reset' });
  res.json({ ok: true });
});

export default router;
