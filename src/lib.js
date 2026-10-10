// Outils partagés : réponses HTTP, validation, dates, cryptographie.

export const enc = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
export const today = () => new Date().toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
export const addDays = (date, days) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
export const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');

export async function readBody(request) {
  try { return (await request.json()) || {}; } catch { throw new HttpError(400, 'Requête invalide.'); }
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'boutique';
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256Hex(text) { return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mot de passe temporaire lisible (sans caractères ambigus), par exemple « Kp7r-x2Mq-9vTz ».
export function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(12));
  return [...a].map((n) => chars[n % chars.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}

export function timingSafe(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// PBKDF2-SHA256, 100 000 itérations (maximum accepté par les Workers).
const ITER = 100000;
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, ITER);
  return `pbkdf2$${ITER}$${toB64(salt)}$${toB64(bits)}`;
}
export async function verifyPassword(password, stored) {
  const [algo, iter, salt, hash] = String(stored || '').split('$');
  if (algo !== 'pbkdf2' || !salt || !hash) return false;
  const bits = await pbkdf2(password, fromB64(salt), Number(iter));
  return timingSafe(toB64(bits), hash);
}
