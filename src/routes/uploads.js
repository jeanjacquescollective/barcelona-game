import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { state, getUploadsSorted } from '../state.js';
import { saveTeam, saveUpload } from '../supabase.js';
import { upload } from '../upload.js';

const router = Router();

router.get('/uploads', (req, res) => res.json(getUploadsSorted()));

router.post('/teams/:teamId/upload', upload.single('file'), async (req, res) => {
  const team = state.teams[req.params.teamId];
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

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

  state.uploads[record.id] = record;
  team.uploads.push(record.id);

  try {
    await Promise.all([saveUpload(record), saveTeam(team)]);
  } catch (e) {
    console.error('Failed to persist upload:', e.message || e);
    return res.status(500).json({ error: 'Upload opslaan mislukt' });
  }

  // Supabase realtime stuurt new_upload naar alle clients via de uploads-channel
  res.json(record);
});

export default router;
