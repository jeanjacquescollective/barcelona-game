import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { state, getLeaderboard } from '../state.js';
import { TEAM_COLORS } from '../config.js';
import { saveTeam } from '../supabase.js';
import { MISSIONS } from './missions.js';

const router = Router();

router.get('/teams', (req, res) => res.json(getLeaderboard()));

router.post('/teams', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (Object.values(state.teams).find((t) => t.name.toLowerCase() === name.trim().toLowerCase()))
    return res.status(400).json({ error: 'Team name already taken' });

  const id = uuidv4();
  const color =
    TEAM_COLORS.find((c) => !Object.values(state.teams).map((t) => t.color).includes(c)) ||
    TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)];

  const team = { id, name: name.trim(), color, score: 0, completedMissions: [], uploads: [] };
  state.teams[id] = team;

  try {
    await saveTeam(team);
  } catch (e) {
    console.error('Failed to persist team:', e.message || e);
    return res.status(500).json({ error: 'Team opslaan mislukt' });
  }

  res.json(team);
});

router.post('/teams/:teamId/missions/:missionId', async (req, res) => {
  const team = state.teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const missionId = parseInt(req.params.missionId);
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  const idx = team.completedMissions.indexOf(missionId);
  if (idx === -1) {
    team.completedMissions.push(missionId);
    team.score += mission.pts;
  } else {
    team.completedMissions.splice(idx, 1);
    team.score -= mission.pts;
  }

  try {
    await saveTeam(team);
  } catch (e) {
    console.error('Failed to persist mission update:', e.message || e);
    return res.status(500).json({ error: 'Missie-update opslaan mislukt' });
  }

  res.json(team);
});

export default router;
