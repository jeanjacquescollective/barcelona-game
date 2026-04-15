// dotenv
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { state, getLeaderboard } from './state.js';
import { TEAM_COLORS } from './config.js';
import { broadcast } from './broadcast.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL en SUPABASE_SERVICE_KEY zijn verplicht in .env');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);
console.log('✅ Supabase connected');

export const realtimeState = {
  teamsReady: false,
  uploadsReady: false,
  lastStatus: 'connecting',
  lastError: null,
};

// ─── Normalisatie ─────────────────────────────────────────────────────────────

export function normalizeTeam(raw) {
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

export function normalizeUpload(raw) {
  if (!raw || !raw.id || !raw.teamId || !raw.filename) return null;
  return {
    id: raw.id,
    teamId: raw.teamId,
    teamName: raw.teamName || 'Onbekend team',
    teamColor: raw.teamColor || '#666',
    missionId: Number(raw.missionId),
    activity: raw.activity || 'mission_upload',
    filename: raw.filename,
    originalName: raw.originalName || raw.filename,
    url: raw.url || `/uploads/${raw.filename}`,
    timestamp: Number(raw.timestamp) || Date.now(),
  };
}

// ─── Cache helpers (intern) ────────────────────────────────────────────────────

function applyTeam(payload) {
  const team = normalizeTeam(payload);
  if (!team) return null;
  state.teams[team.id] = team;
  return team;
}

function applyUpload(payload) {
  const record = normalizeUpload(payload);
  if (!record) return null;
  state.uploads[record.id] = record;
  return record;
}

// ─── Persistentie ─────────────────────────────────────────────────────────────

export async function saveTeam(team) {
  const payload = normalizeTeam(team);
  if (!payload) return;
  const { error } = await supabase
    .from('teams')
    .upsert(
      { id: payload.id, payload, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
  if (error) throw error;
}

export async function saveUpload(record) {
  const payload = normalizeUpload(record);
  if (!payload) return;
  const { error } = await supabase
    .from('uploads')
    .upsert(
      { id: payload.id, payload, created_at: new Date(payload.timestamp).toISOString() },
      { onConflict: 'id' },
    );
  if (error) throw error;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function bootstrap() {
  const [teamsResult, uploadsResult] = await Promise.all([
    supabase.from('teams').select('id,payload'),
    supabase.from('uploads').select('id,payload'),
  ]);

  if (teamsResult.error) throw teamsResult.error;
  if (uploadsResult.error) throw uploadsResult.error;

  Object.keys(state.teams).forEach((k) => delete state.teams[k]);
  Object.keys(state.uploads).forEach((k) => delete state.uploads[k]);

  (teamsResult.data || []).forEach((row) => applyTeam(row.payload));
  (uploadsResult.data || []).forEach((row) => applyUpload(row.payload));

  console.log(`📦 Geladen: ${Object.keys(state.teams).length} teams, ${Object.keys(state.uploads).length} uploads`);
}

// ─── Realtime sync ────────────────────────────────────────────────────────────

export function startRealtimeSync() {
  supabase
    .channel(`teams-${process.pid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, (evt) => {
      const row = evt.eventType === 'DELETE' ? evt.old : evt.new;
      if (!row) return;

      if (evt.eventType === 'DELETE') {
        const id = row.id || row.payload?.id;
        if (id && state.teams[id]) {
          delete state.teams[id];
          broadcast({ type: 'teams_update', teams: getLeaderboard() });
        }
        return;
      }

      const changed = applyTeam(row.payload);
      if (changed) broadcast({ type: 'teams_update', teams: getLeaderboard() });
    })
    .subscribe((status) => {
      realtimeState.teamsReady = status === 'SUBSCRIBED';
      realtimeState.lastStatus = status;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        realtimeState.lastError = `teams channel ${status}`;
      if (status === 'SUBSCRIBED')
        console.log('🔄 Realtime: teams subscribed');
    });

  supabase
    .channel(`uploads-${process.pid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'uploads' }, (evt) => {
      const row = evt.eventType === 'DELETE' ? evt.old : evt.new;
      if (!row) return;

      if (evt.eventType === 'DELETE') {
        const id = row.id || row.payload?.id;
        if (id && state.uploads[id]) delete state.uploads[id];
        return;
      }

      const changed = applyUpload(row.payload);
      if (changed && evt.eventType === 'INSERT') {
        const team = state.teams[changed.teamId];
        if (team && !team.uploads.includes(changed.id)) team.uploads.push(changed.id);
        broadcast({
          type: 'new_upload',
          upload: changed,
          teamName: changed.teamName,
          activity: changed.activity,
        });
      }
    })
    .subscribe((status) => {
      realtimeState.uploadsReady = status === 'SUBSCRIBED';
      realtimeState.lastStatus = status;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        realtimeState.lastError = `uploads channel ${status}`;
      if (status === 'SUBSCRIBED')
        console.log('🔄 Realtime: uploads subscribed');
    });
}
