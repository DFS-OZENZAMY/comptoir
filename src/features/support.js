// Messagerie entre les commerçants et le support Comptoir.
// Une conversation par commerce (partagée par son équipe), enregistrée en base, diffusée en temps réel
// (src/platform/realtime.js) et relayée par notification push quand personne ne la regarde.
import { HttpError, json, str } from '../core/lib.js';
import { init } from '../core/db.js';
import { getContext } from './auth.js';
import { getRealtime } from '../platform/realtime.js';
import { notifyStore, notifyPlatform } from './push.js';

const now = () => new Date().toISOString();
const clean = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Support';
const preview = (s) => clean(s).replace(/\s+/g, ' ').slice(0, 140);

function shapeMessage(m) {
  return { id: m.id, thread_id: m.thread_id, author_id: m.author_id, author_role: m.author_role, author_name: m.author_name, body: m.body, kind: m.kind, created_at: m.created_at };
}
function shapeThread(t) {
  return { id: t.id, store_id: t.store_id, status: t.status, assigned_to: t.assigned_to, assigned_name: t.assigned_name || null,
    last_message_at: t.last_message_at, last_preview: t.last_preview, last_author: t.last_author,
    unread_store: t.unread_store, unread_support: t.unread_support, store_read_at: t.store_read_at, support_read_at: t.support_read_at };
}

async function threadOf(db, storeId, create = false) {
  let t = await db.prepare('SELECT * FROM support_threads WHERE store_id = ?').bind(storeId).first();
  if (!t && create) {
    await db.prepare("INSERT OR IGNORE INTO support_threads (store_id, status, created_at, updated_at) VALUES (?, 'ouverte', ?, ?)").bind(storeId, now(), now()).run();
    t = await db.prepare('SELECT * FROM support_threads WHERE store_id = ?').bind(storeId).first();
  }
  return t;
}

// Ajoute un message, met à jour la conversation et prévient tout le monde.
async function post(env, later, thread, { role, authorId, authorName, body, kind = 'texte', context, clientRef = null, at: when = null }) {
  const db = env.DB; const at = when || now();
  const r = await db.prepare('INSERT INTO support_messages (thread_id, store_id, author_id, author_name, author_role, body, kind, created_at, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(thread.id, thread.store_id, authorId || null, authorName, role, body, kind, at, clientRef).first();
  const counts = role === 'client' ? 'unread_support = unread_support + 1, store_read_at = ?' : role === 'support' ? 'unread_store = unread_store + 1, support_read_at = ?' : 'updated_at = ?';
  await db.prepare(`UPDATE support_threads SET ${counts}, last_message_at = ?, last_preview = ?, last_author = ?, updated_at = ?${role === 'client' ? ", status = 'ouverte'" : ''}${context ? ', context = ?' : ''} WHERE id = ?`)
    .bind(at, at, kind === 'texte' ? preview(body) : thread.last_preview, role, at, ...(context ? [JSON.stringify(context)] : []), thread.id).run();
  const fresh = await db.prepare('SELECT t.*, u.name AS assigned_name FROM support_threads t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?').bind(thread.id).first();
  const event = { type: 'message', message: shapeMessage(r), thread: shapeThread(fresh) };
  const rt = getRealtime(env);
  later(rt.publish([`store:${thread.store_id}`, 'support'], event));
  return { message: shapeMessage(r), thread: fresh };
}

/* ------------------------------------------------------------------ */
/* Côté commerçant : /api/store/support/…                              */
/* ------------------------------------------------------------------ */
export async function storeSupportRoutes(ctx, id, m, body) {
  const { db, env } = ctx; const sid = ctx.store.id; const later = ctx.later || ((p) => p);
  if (!id && m === 'GET') {
    const t = await db.prepare('SELECT t.*, u.name AS assigned_name FROM support_threads t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.store_id = ?').bind(sid).first();
    const messages = t ? (await db.prepare('SELECT * FROM support_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 200').bind(t.id).all()).results.reverse().map(shapeMessage) : [];
    const rt = getRealtime(env);
    return json({ thread: t ? shapeThread(t) : null, messages, realtime: !!rt.available, support_online: (await rt.presence().catch(() => ({ support: 0 }))).support });
  }
  if (id === 'messages' && m === 'POST') return json(await postClientMessage(ctx, await body()), 201);
  if (id === 'read' && m === 'POST') {
    const t = await threadOf(db, sid);
    if (t && t.unread_store) {
      const at = now();
      await db.prepare('UPDATE support_threads SET unread_store = 0, store_read_at = ? WHERE id = ?').bind(at, t.id).run();
      later(getRealtime(env).publish(['support'], { type: 'read', side: 'client', thread_id: t.id, storeId: sid, at }));
    }
    return json({ ok: true });
  }
  throw new HttpError(404, 'Route inconnue.');
}

// Message du commerçant (envoyé en direct, ou plus tard par la synchronisation du mode hors ligne).
export async function postClientMessage(ctx, b) {
  const { db, env } = ctx; const sid = ctx.store.id; const later = ctx.later || ((p) => p);
  const text = clean(b.body);
  if (!text) throw new HttpError(400, 'Écrivez votre message.');
  if (text.length > 4000) throw new HttpError(400, 'Message trop long (4 000 caractères au plus).');
  const ref = typeof b.client_ref === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.client_ref) ? b.client_ref : null;
  if (ref) { const ex = await db.prepare('SELECT * FROM support_messages WHERE store_id = ? AND client_ref = ?').bind(sid, ref).first(); if (ex) return { ...shapeMessage(ex), duplicate: true }; }
  const t0 = Date.parse(b.occurred_at); const at = Number.isFinite(t0) && t0 < Date.now() + 300000 && t0 > Date.now() - 30 * 86400000 ? new Date(t0).toISOString() : null;
  const thread = await threadOf(db, sid, true);
  const context = { page: str(b.context?.page, 120), title: str(b.context?.title, 80), device: str(ctx.request.headers.get('user-agent'), 200) };
  const r = await post(env, later, thread, { role: 'client', authorId: ctx.user.id, authorName: ctx.user.name, body: text, context, clientRef: ref, at });
  // L'équipe support est prévenue de CHAQUE message, en priorité haute (écran verrouillé compris).
  // Une notification par conversation : la nouvelle remplace la précédente, avec le nombre de non-lus.
  const n = r.thread.unread_support;
  later(notifyPlatform(env, { kind: 'chat', title: n > 1 ? `${ctx.store.name} · ${n} nouveaux messages` : ctx.store.name, body: `${firstName(ctx.user.name)} : ${preview(text).slice(0, 140)}`,
    url: `/console/#/messagerie/${thread.id}`, tag: `chat-${thread.id}` }, { category: 'messages', urgency: 'high', topic: `chat${thread.id}`, ttl: 86400 }));
  return r.message;
}

/* ------------------------------------------------------------------ */
/* Côté support (console) : /api/console/support/…                     */
/* ------------------------------------------------------------------ */
export async function consoleSupportRoutes(ctx, parts, m) {
  const { db, env } = ctx; const later = ctx.later || ((p) => p);
  const [res, id, action] = parts;
  const body = async () => { try { return await ctx.request.json(); } catch { return {}; } };
  if (res === 'summary' && m === 'GET') {
    const r = await db.prepare("SELECT SUM(CASE WHEN unread_support > 0 THEN 1 ELSE 0 END) AS unread, SUM(CASE WHEN status = 'ouverte' THEN 1 ELSE 0 END) AS open FROM support_threads WHERE last_message_at IS NOT NULL").first();
    return json({ unread: r.unread || 0, open: r.open || 0 });
  }
  if (res !== 'threads') throw new HttpError(404, 'Route inconnue.');
  if (!id && m === 'GET') {
    const url = new URL(ctx.request.url); const filter = url.searchParams.get('filtre') || 'ouvertes'; const q = str(url.searchParams.get('q'), 80).toLowerCase();
    const where = ['t.last_message_at IS NOT NULL'];
    if (filter === 'ouvertes') where.push("t.status = 'ouverte'"); else if (filter === 'non-lues') where.push('t.unread_support > 0'); else if (filter === 'resolues') where.push("t.status = 'résolue'"); else if (filter === 'miennes') where.push(`t.assigned_to = ${Number(ctx.user.id)}`);
    const args = [];
    if (q) { where.push('(LOWER(s.name) LIKE ? OR LOWER(t.last_preview) LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const rows = (await db.prepare(`SELECT t.*, s.name AS store_name, s.plan, s.country, u.name AS assigned_name FROM support_threads t
        JOIN stores s ON s.id = t.store_id LEFT JOIN users u ON u.id = t.assigned_to WHERE ${where.join(' AND ')} ORDER BY t.unread_support > 0 DESC, t.last_message_at DESC LIMIT 200`).bind(...args).all()).results;
    const counts = await db.prepare("SELECT SUM(CASE WHEN status = 'ouverte' THEN 1 ELSE 0 END) AS ouvertes, SUM(CASE WHEN unread_support > 0 THEN 1 ELSE 0 END) AS non_lues, SUM(CASE WHEN status = 'résolue' THEN 1 ELSE 0 END) AS resolues, SUM(CASE WHEN assigned_to = ? THEN 1 ELSE 0 END) AS miennes FROM support_threads WHERE last_message_at IS NOT NULL").bind(ctx.user.id).first();
    return json({ threads: rows.map((t) => ({ ...shapeThread(t), store_name: t.store_name, plan: t.plan, country: t.country })), counts, me: ctx.user.id });
  }
  const t = await db.prepare('SELECT t.*, u.name AS assigned_name FROM support_threads t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?').bind(Number(id)).first();
  if (!t) throw new HttpError(404, 'Conversation introuvable.');
  if (!action && m === 'GET') {
    const messages = (await db.prepare('SELECT * FROM support_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 300').bind(t.id).all()).results.reverse().map(shapeMessage);
    const store = await db.prepare(`SELECT s.id, s.name, s.slug, s.plan, s.country, s.business_type, s.status, s.created_at, s.trial_ends_at, s.last_active_at,
        (SELECT u.name FROM memberships mm JOIN users u ON u.id = mm.user_id WHERE mm.store_id = s.id AND mm.role = 'owner' LIMIT 1) AS owner_name,
        (SELECT u.email FROM memberships mm JOIN users u ON u.id = mm.user_id WHERE mm.store_id = s.id AND mm.role = 'owner' LIMIT 1) AS owner_email,
        (SELECT COUNT(*) FROM memberships mm WHERE mm.store_id = s.id) AS members,
        (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS products
        FROM stores s WHERE s.id = ?`).bind(t.store_id).first();
    let context = null; try { context = JSON.parse(t.context || 'null'); } catch { /* ancien format */ }
    return json({ thread: shapeThread(t), messages, store, context });
  }
  if (action === 'messages' && m === 'POST') {
    const text = clean((await body()).body);
    if (!text) throw new HttpError(400, 'Écrivez votre réponse.');
    if (text.length > 4000) throw new HttpError(400, 'Message trop long (4 000 caractères au plus).');
    // Première réponse : l'agent prend la conversation en charge.
    if (!t.assigned_to) {
      await db.prepare('UPDATE support_threads SET assigned_to = ? WHERE id = ?').bind(ctx.user.id, t.id).run();
      await post(env, later, t, { role: 'systeme', authorName: 'Comptoir', body: `${firstName(ctx.user.name)} a pris en charge la conversation`, kind: 'evenement' });
    }
    const r = await post(env, later, t, { role: 'support', authorId: ctx.user.id, authorName: firstName(ctx.user.name), body: text });
    await db.prepare('UPDATE support_threads SET unread_support = 0 WHERE id = ?').bind(t.id).run();
    // Le commerçant est prévenu de chaque réponse, en priorité haute, même application fermée.
    const n = r.thread.unread_store;
    later(notifyStore(env, t.store_id, 'support', { kind: 'chat', title: n > 1 ? `Support Comptoir · ${n} nouveaux messages` : 'Support Comptoir', body: `${firstName(ctx.user.name)} : ${preview(text).slice(0, 140)}`,
      url: '/app/#/support', tag: 'support-chat' }, { urgency: 'high', topic: 'support', ttl: 86400 }));
    return json(r.message, 201);
  }
  if (action === 'read' && m === 'POST') {
    const at = now();
    await db.prepare('UPDATE support_threads SET unread_support = 0, support_read_at = ? WHERE id = ?').bind(at, t.id).run();
    later(getRealtime(env).publish([`store:${t.store_id}`, 'support'], { type: 'read', side: 'support', thread_id: t.id, storeId: t.store_id, at }));
    return json({ ok: true });
  }
  if (!action && m === 'PUT') {
    const b = await body(); const events = [];
    if (b.status && ['ouverte', 'résolue'].includes(b.status) && b.status !== t.status) {
      await db.prepare('UPDATE support_threads SET status = ?, updated_at = ? WHERE id = ?').bind(b.status, now(), t.id).run();
      events.push(b.status === 'résolue' ? `${firstName(ctx.user.name)} a marqué la conversation comme résolue` : `${firstName(ctx.user.name)} a rouvert la conversation`);
    }
    if ('assigned_to' in b) {
      const to = b.assigned_to === 'moi' ? ctx.user.id : null;
      if (to !== t.assigned_to) { await db.prepare('UPDATE support_threads SET assigned_to = ? WHERE id = ?').bind(to, t.id).run(); events.push(to ? `${firstName(ctx.user.name)} a pris en charge la conversation` : `${firstName(ctx.user.name)} a libéré la conversation`); }
    }
    for (const e of events) await post(env, later, t, { role: 'systeme', authorName: 'Comptoir', body: e, kind: 'evenement' });
    const fresh = await db.prepare('SELECT t.*, u.name AS assigned_name FROM support_threads t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?').bind(t.id).first();
    return json({ thread: shapeThread(fresh) });
  }
  throw new HttpError(404, 'Route inconnue.');
}

/* ------------------------------------------------------------------ */
/* Connexion temps réel : identité vérifiée côté serveur               */
/* ------------------------------------------------------------------ */
// « ?as=support » : réservé aux administrateurs de la plateforme. Sinon : membre d'un commerce.
export async function chatIdentity(env, request) {
  await init(env.DB);
  const ctx = await getContext(env.DB, env, request);
  if (!ctx?.user) throw new HttpError(401, 'Connectez-vous pour utiliser la messagerie.');
  const asSupport = new URL(request.url).searchParams.get('as') === 'support';
  if (asSupport) {
    if (!ctx.platformAdmin) throw new HttpError(403, 'Réservé à l’équipe Comptoir.');
    return { role: 'support', userId: ctx.user.id, name: firstName(ctx.user.name) };
  }
  if (!ctx.store) throw new HttpError(403, 'Aucun commerce associé à ce compte.');
  return { role: 'client', userId: ctx.user.id, name: firstName(ctx.user.name), storeId: ctx.store.id };
}
