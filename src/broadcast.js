import { WebSocketServer } from 'ws';
import { getLeaderboard, getUploadsSorted, safeQuestion } from './state.js';

/** @type {WebSocketServer | undefined} */
let wss;

export function setupWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'init',
      teams: getLeaderboard(),
      uploads: getUploadsSorted(),
      question: safeQuestion(),
    }));
  });

  return wss;
}

export function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}
