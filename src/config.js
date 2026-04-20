import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bcn5';
export const APP_PASSWORD = process.env.APP_PASSWORD || '';

export const TEAM_COLORS = [
  '#E85D4A', '#4A90D9', '#27AE60', '#9B59B6',
  '#F39C12', '#1ABC9C', '#E91E8C', '#FF6B35',
];

// Absolute paden vanuit de package-root
export const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
export const DATA_DIR    = path.join(__dirname, '..', 'data');
