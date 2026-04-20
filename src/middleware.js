import crypto from 'crypto';
import { ADMIN_PASSWORD, APP_PASSWORD } from './config.js';

function safeEqual(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function appPasswordAuth(req, res, next) {
  if (!APP_PASSWORD) {
    return res.status(500).send('APP_PASSWORD ontbreekt in environment.');
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Barcelona Game"');
    return res.status(401).send('Authenticatie vereist.');
  }

  const base64Part = auth.slice(6);
  const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const providedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (!safeEqual(providedPassword, APP_PASSWORD)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Barcelona Game"');
    return res.status(401).send('Onjuist wachtwoord.');
  }

  next();
}

export function adminAuth(req, res, next) {
  const pw =
    req.headers['x-admin-password'] ||
    req.body?.adminPassword ||
    req.query?.adminPassword;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
