import { ADMIN_PASSWORD } from './config.js';

export function adminAuth(req, res, next) {
  const pw =
    req.headers['x-admin-password'] ||
    req.body?.adminPassword ||
    req.query?.adminPassword;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
