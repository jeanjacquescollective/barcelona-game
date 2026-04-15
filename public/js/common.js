/**
 * common.js — shared utilities for both player (index.html) and admin (admin.html)
 *
 * Provides:
 *   showToast(msg, type)          — display a toast notification
 *   escHtml(s)                    — escape HTML special characters
 *   escJs(s)                      — escape for inline JS string literals
 *   formatTime(timestamp)         — human-readable relative time (Dutch)
 *   makeWS(dotId, textId, onMsg)  — create a self-reconnecting WebSocket
 */

// ── TOAST ────────────────────────────────────────────────────────────────────
/**
 * Show the #toast element with a message and an optional type class.
 * Supported types: "success" | "ok" | "error" | "err" | ""
 * The element is dismissed automatically after 2.5 s.
 */
function showToast(msg, type = "") {
  const t = document.querySelector("#toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => (t.className = `toast ${type}`), 2500);
}

// ── HTML / JS ESCAPING ───────────────────────────────────────────────────────
/** Escape characters that are special in HTML. */
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape characters that are special inside a JS string literal. */
function escJs(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

// ── RELATIVE TIME ────────────────────────────────────────────────────────────
/** Return a Dutch human-readable relative timestamp. */
function formatTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)     return "Zojuist";
  if (diff < 3_600_000)  return Math.floor(diff / 60_000)    + " min geleden";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " uur geleden";
  return new Date(ts).toLocaleDateString("nl-BE");
}

// ── WEBSOCKET ────────────────────────────────────────────────────────────────
/**
 * Create a WebSocket that reconnects automatically on close.
 *
 * @param {string}   dotId   - id of the status <div class="dot"> element
 * @param {string}   textId  - id of the status <span> text element
 * @param {Function} onMsg   - callback(parsedData) called on every message
 * @returns {object}         - { ws } — ws is replaced on every reconnect
 */
function makeWS(dotId, textId, onMsg) {
  const state = { ws: null };

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}`);
    state.ws = socket;

    socket.onopen = () => {
      document.getElementById(dotId).className  = "dot live";
      document.getElementById(textId).textContent = "Live";
    };

    socket.onclose = () => {
      document.getElementById(dotId).className  = "dot";
      document.getElementById(textId).textContent = "Offline";
      setTimeout(connect, 3000);
    };

    socket.onmessage = (e) => {
      try { onMsg(JSON.parse(e.data)); }
      catch (err) { console.error("WS parse error", err); }
    };
  }

  connect();
  return state;
}
