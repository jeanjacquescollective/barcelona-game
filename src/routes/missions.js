import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const router = Router();

export const MISSIONS = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'missions.json'), 'utf8'),
);

router.get('/missions', (req, res) => res.json(MISSIONS));

export default router;
