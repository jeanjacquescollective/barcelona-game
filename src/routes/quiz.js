import { Router } from 'express';
import { state } from '../state.js';
import { broadcast } from '../broadcast.js';

const router = Router();

// Speler stuurt een antwoord in
router.post('/quiz/answer', (req, res) => {
  const { teamId, answer } = req.body;
  if (!state.activeQuestion) return res.status(400).json({ error: 'No active question' });
  if (!state.teams[teamId]) return res.status(404).json({ error: 'Team not found' });
  if (state.activeQuestion.answers[teamId]) return res.status(400).json({ error: 'Already answered' });

  state.activeQuestion.answers[teamId] = { answer, ts: Date.now() };

  broadcast({
    type: 'answer_received',
    teamName: state.teams[teamId].name,
    count: Object.keys(state.activeQuestion.answers).length,
  });

  res.json({ ok: true });
});

export default router;
