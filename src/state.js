// Gedeelde in-memory cache — wordt gevuld via Supabase bootstrap + realtime.
export const state = {
  teams: {},
  uploads: {},
  /** @type {null | { id: string, type: string, question: string, options: string[], answer: string, pts: number, openedAt: number, answers: Record<string, { answer: string, ts: number }> }} */
  activeQuestion: null,
  questionHistory: [],
};

export function getLeaderboard() {
  return Object.values(state.teams).sort((a, b) => b.score - a.score);
}

export function getUploadsSorted() {
  return Object.values(state.uploads).sort((a, b) => b.timestamp - a.timestamp);
}

export function safeQuestion() {
  if (!state.activeQuestion) return null;
  const { answer, ...safe } = state.activeQuestion;
  return safe;
}
