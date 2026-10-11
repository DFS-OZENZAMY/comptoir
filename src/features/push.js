// Notifications push : abonnements par appareil, choix des destinataires selon leurs droits,
// alertes en temps réel (stock), résumé du matin (paiements, stock, abonnement), alertes de plateforme.
import { HttpError, json, str, today, addDays } from '../core/lib.js';
import { generateVapidKeys, sendWebPush, isPushEndpoint } from '../platform/webpush.js';
import { isPlatformAdmin } from './auth.js';
import { getSettings, computeAlerts } from './store.js';

// Catégories proposées, et qui peut les recevoir.
export const CATEGORIES = {
  stock: { label: 'Stock bas et ruptures', detail: 'dès qu’un produit passe sous son seuil', perms: ['alerts.view', 'stock.manage'] },
  paiements: { label: 'Factures en retard et échéances', detail: 'chaque matin', perms: ['alerts.view', 'payments.manage'] },
  abonnement: { label: 'Essai et abonnement', detail: 'fin d’essai, formule', perms: ['billing.manage'] },
  support: { label: 'Messages du support', detail: 'réponses de l’équipe Comptoir', all: true },
  messages: { label: 'Messages des commerçants', detail: 'chaque nouveau message, en direct', admin: true },
  plateforme: { label: 'Plateforme (administrateur)', detail: 'inscriptions, demandes de formule, sauvegardes', admin: true },
};
const DEFAULT_PREFS = { stock: true, paiements: true, abonnement: true, support: true, messages: true, plateforme: true };

/* ------------------------------------------------------------------ */
/* Clés VAPID : fournies par l'environnement, sinon créées une fois    */
/* et gardées en base (elles suivent donc les sauvegardes).            */
/* ------------------------------------------------------------------ */
const vapidCache = new WeakMap();
export async function getVapid(env) {
  if (vapidCache.has(env)) return vapidCache.get(env);
  let keys;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) keys = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  else {
    const row = await env.DB.prepare("SELECT value FROM platform_meta WHERE key = 'vapid'").first();
    if (row) keys = JSON.parse(row.value);
    else {
      await env.DB.prepare("INSERT OR IGNORE INTO platform_meta (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(await generateVapidKeys())).run();
      keys = JSON.parse((await env.DB.prepare("SELECT value FROM platform_meta WHERE key = 'vapid'").first()).value);
    }
  }
  const admin = String(env.PLATFORM_ADMIN_EMAILS || '').split(',').map((x) => x.trim()).find(Boolean);
  const v = { ...keys, subject: env.VAPID_SUBJECT || (admin ? `mailto:${admin}` : env.APP_URL || 'mailto:contact@comptoir.app') };
  vapidCache.set(env, v);
  return v;
}

const parsePrefs = (s) => { try { return { ...DEFAULT_PREFS, ...JSON.parse(s || '{}') }; } catch { return { ...DEFAULT_PREFS }; } };
const deviceName = (ua = '') => {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Appareil';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return nav ? `${os}, ${nav}` : os;
};
// Catégories auxquelles un membre a droit (depuis la console : seulement celles de l'équipe Comptoir).
function allowedCategories(ctx) {
  if (ctx.consoleMode) return Object.entries(CATEGORIES).filter(([, c]) => c.admin).map(([k]) => k);
  return Object.entries(CATEGORIES).filter(([, c]) => (c.admin ? ctx.platformAdmin : c.all || c.perms.some((p) => ctx.permissions.includes(p)))).map(([k]) => k);
}

/* ------------------------------------------------------------------ */
/* Routes : /api/store/push/…                                          */
/* ------------------------------------------------------------------ */
export async function pushRoutes(ctx, id, m, body) {
  const { db, env } = ctx; const sid = ctx.store?.id || 0; const uid = ctx.user.id;
  if (id === 'key' && m === 'GET') {
    const allowed = allowedCategories(ctx);
    return json({ publicKey: (await getVapid(env)).publicKey, categories: allowed.map((k) => ({ key: k, label: CATEGORIES[k].label, detail: CATEGORIES[k].detail })) });
  }
  if (id === 'subscriptions') {
    if (m === 'GET') {
      // Les appareils de la personne connectée, avec leurs préférences.
      const rows = (await db.prepare(`SELECT id, endpoint, label, prefs, created_at, last_success_at FROM push_subscriptions WHERE user_id = ?${ctx.consoleMode ? '' : ' AND store_id = ?'} ORDER BY created_at DESC`).bind(uid, ...(ctx.consoleMode ? [] : [sid])).all()).results;
      return json(rows.map((r) => ({ id: r.id, endpoint: r.endpoint, label: r.label, prefs: parsePrefs(r.prefs), created_at: r.created_at, last_success_at: r.last_success_at })));
    }
    const b = await body();
    const endpoint = str(b.endpoint || b.subscription?.endpoint, 1000);
    if (m === 'POST') {
      const keys = b.subscription?.keys || b.keys || {};
      if (!isPushEndpoint(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth || '')) throw new HttpError(400, 'Abonnement aux notifications invalide.');
      const allowed = allowedCategories(ctx);
      const prefs = Object.fromEntries(allowed.map((k) => [k, b.prefs?.[k] !== false]));
      // Un appareil n'appartient qu'à une personne à la fois : il change de propriétaire s'il est réutilisé.
      await db.prepare(`INSERT INTO push_subscriptions (store_id, user_id, endpoint, p256dh, auth, prefs, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE SET store_id = excluded.store_id, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, prefs = excluded.prefs, label = excluded.label, failures = 0`)
        .bind(sid, uid, endpoint, keys.p256dh, keys.auth, JSON.stringify(prefs), deviceName(ctx.request.headers.get('user-agent') || ''), new Date().toISOString()).run();
      return json({ ok: true, prefs }, 201);
    }
    if (m === 'PUT') {
      const row = await db.prepare('SELECT prefs FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, uid).first();
      if (!row) throw new HttpError(404, 'Cet appareil ne reçoit pas de notifications.');
      const allowed = allowedCategories(ctx);
      const prefs = { ...parsePrefs(row.prefs), ...Object.fromEntries(Object.entries(b.prefs || {}).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, !!v])) };
      await db.prepare('UPDATE push_subscriptions SET prefs = ? WHERE endpoint = ? AND user_id = ?').bind(JSON.stringify(prefs), endpoint, uid).run();
      return json({ ok: true, prefs });
    }
    if (m === 'DELETE') {
      await db.prepare('DELETE FROM push_subscriptions WHERE (endpoint = ? OR id = ?) AND user_id = ?').bind(endpoint, Number(b.id) || 0, uid).run();
      return json({ ok: true });
    }
  }
  if (id === 'test' && m === 'POST') {
    const b = await body();
    const sub = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(str(b.endpoint, 1000), uid).first();
    if (!sub) throw new HttpError(404, 'Activez d’abord les notifications sur cet appareil.');
    const r = await deliver(env, [sub], { title: 'Comptoir', body: 'Les notifications fonctionnent sur cet appareil.', url: ctx.consoleMode ? '/console/#/messagerie' : '/app/#/notifications', tag: 'test' }, { urgency: 'high' });
    if (!r.sent) throw new HttpError(502, 'Le service de notification n’a pas accepté le message. Réessayez dans un instant.');
    return json({ ok: true });
  }
  throw new HttpError(404, 'Route inconnue.');
}

/* ------------------------------------------------------------------ */
/* Envoi                                                               */
/* ------------------------------------------------------------------ */
async function deliver(env, subs, message, opts) {
  if (!subs.length) return { sent: 0 };
  const vapid = await getVapid(env);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    const r = await sendWebPush(s, message, vapid, opts).catch(() => ({ ok: false, gone: false }));
    if (r.ok) { sent++; await env.DB.prepare('UPDATE push_subscriptions SET last_success_at = ?, failures = 0 WHERE id = ?').bind(new Date().toISOString(), s.id).run(); }
    else if (r.gone) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();       // appareil désinstallé ou permission retirée
    else await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').bind(s.id).run();
  }));
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE failures >= 20').run();
  return { sent };
}

// Une même alerte au plus une fois : la clé est enregistrée, un second envoi est ignoré.
async function once(env, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO push_log (key, sent_at) VALUES (?, ?)').bind(key, new Date().toISOString()).run();
  return r.meta?.changes > 0;
}

// Destinataires d'un commerce pour une catégorie : droits du rôle, boutiques autorisées, préférences de l'appareil.
async function storeRecipients(env, storeId, category, locationId = null) {
  const cat = CATEGORIES[category];
  const rows = (await env.DB.prepare(`SELECT p.*, m.role, m.locations, r.permissions FROM push_subscriptions p
      JOIN memberships m ON m.user_id = p.user_id AND m.store_id = p.store_id
      LEFT JOIN roles r ON r.id = m.role_id AND r.store_id = m.store_id
      WHERE p.store_id = ?`).bind(storeId).all()).results;
  return rows.filter((s) => {
    if (!parsePrefs(s.prefs)[category]) return false;
    if (s.role === 'owner' || cat.all) return true;
    let perms = []; try { perms = JSON.parse(s.permissions || '[]'); } catch { /* rôle sans droits */ }
    if (!cat.perms.some((p) => perms.includes(p))) return false;
    let locs = []; try { locs = JSON.parse(s.locations || '[]').map(Number).filter(Boolean); } catch { /* toutes */ }
    return !locationId || !locs.length || locs.includes(Number(locationId));
  });
}

// urgency « high » : le téléphone est réveillé tout de suite (écran verrouillé compris).
// topic : un téléphone resté hors ligne ne reçoit que la dernière notification de ce sujet.
export async function notifyStore(env, storeId, category, message, { dedupe, locationId, urgency, topic, ttl } = {}) {
  if (dedupe && !(await once(env, dedupe))) return { sent: 0, skipped: 'déjà envoyée' };
  return deliver(env, await storeRecipients(env, storeId, category, locationId), message, { urgency, topic, ttl });
}

export async function notifyPlatform(env, message, { dedupe, category = 'plateforme', urgency, topic, ttl } = {}) {
  if (!env.PLATFORM_ADMIN_EMAILS) return { sent: 0 };
  if (dedupe && !(await once(env, dedupe))) return { sent: 0, skipped: 'déjà envoyée' };
  const rows = (await env.DB.prepare('SELECT p.*, u.email FROM push_subscriptions p JOIN users u ON u.id = p.user_id').all()).results;
  return deliver(env, rows.filter((s) => isPlatformAdmin(env, s.email) && parsePrefs(s.prefs)[category]), message, { urgency, topic, ttl });
}

/* ------------------------------------------------------------------ */
/* Alertes                                                             */
/* ------------------------------------------------------------------ */
// « 4 pièces », « 2 sacs », mais « 1,5 kg », « 3 m » : l'unité s'accorde, sauf les abréviations.
const unitLabel = (unit, n) => {
  const u = String(unit || '').trim();
  return n >= 2 && /^[a-zàâäéèêëîïôöûüç]{3,}$/i.test(u) && !/[sxz]$/i.test(u) && !/^(kg|ml|cl|cm|mm)$/i.test(u) ? `${u}${/au$|eu$/i.test(u) ? 'x' : 's'}` : u;
};

// Après une vente, une sortie ou un transfert : produits passés sous leur seuil ou en rupture.
export async function stockAlerts(env, storeId, productIds, locationId = null) {
  const ids = [...new Set(productIds.map(Number).filter(Boolean))].slice(0, 100);
  if (!ids.length) return;
  const has = await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE store_id = ? LIMIT 1').bind(storeId).first();
  if (!has) return;
  const rows = (await env.DB.prepare(`SELECT id, name, stock, stock_min, unit FROM products WHERE store_id = ? AND track_stock = 1
      AND stock <= stock_min AND (stock_min > 0 OR stock <= 0) AND id IN (${ids.map(() => '?').join(',')})`).bind(storeId, ...ids).all()).results;
  for (const p of rows) {
    const out = p.stock <= 0;
    const fmt = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
    await notifyStore(env, storeId, 'stock', {
      title: out ? `Rupture : ${p.name}` : `Stock bas : ${p.name}`,
      body: out ? 'Plus aucun en stock. Pensez à commander.' : `Il en reste ${fmt(p.stock)} ${unitLabel(p.unit, p.stock)} (seuil : ${fmt(p.stock_min)}).`.replace(/\s+\(/, ' ('),
      url: '/app/#/alertes', tag: `stock-${p.id}`,
    }, { dedupe: `stock:${storeId}:${p.id}:${out ? 'rupture' : 'bas'}:${today()}`, locationId });
  }
}

// Résumé du matin : paiements, stock, fin d'essai. Uniquement pour les commerces qui ont des appareils abonnés.
export async function dailyPushes(env) {
  const db = env.DB; const t = today();
  const stores = (await db.prepare(`SELECT DISTINCT s.id, s.plan, s.trial_ends_at FROM stores s JOIN push_subscriptions p ON p.store_id = s.id WHERE s.status = 'active'`).all()).results;
  let sent = 0;
  for (const s of stores) {
    try {
      const settings = await getSettings(db, s.id);
      const a = await computeAlerts(db, s.id, settings);
      const cur = settings.currency || '€';
      const money = (n) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)} ${cur}`;
      if (a.overdue.length || a.due_soon.length) {
        const parts = [];
        if (a.overdue.length) parts.push(`${a.overdue.length} facture${a.overdue.length > 1 ? 's' : ''} en retard (${money(a.totals.overdue_amount)})`);
        if (a.due_soon.length) parts.push(`${a.due_soon.length} échéance${a.due_soon.length > 1 ? 's' : ''} proche${a.due_soon.length > 1 ? 's' : ''}`);
        sent += (await notifyStore(env, s.id, 'paiements', { title: 'Paiements à suivre', body: parts.join(', ') + '.', url: '/app/#/alertes', tag: 'paiements' }, { dedupe: `paiements:${s.id}:${t}` })).sent || 0;
      }
      const stockCount = a.out_of_stock.length + a.low_stock.length;
      if (stockCount) {
        const body = [a.out_of_stock.length ? `${a.out_of_stock.length} rupture${a.out_of_stock.length > 1 ? 's' : ''}` : '', a.low_stock.length ? `${a.low_stock.length} stock${a.low_stock.length > 1 ? 's' : ''} bas` : ''].filter(Boolean).join(', ');
        sent += (await notifyStore(env, s.id, 'stock', { title: 'À réapprovisionner', body: `${body}. La liste est prête à envoyer au fournisseur.`, url: '/app/#/alertes', tag: 'stock-resume' }, { dedupe: `stock-resume:${s.id}:${t}` })).sent || 0;
      }
      if (s.plan === 'essai' && s.trial_ends_at && s.trial_ends_at >= t && s.trial_ends_at <= addDays(t, 3)) {
        const days = Math.round((Date.parse(s.trial_ends_at) - Date.parse(t)) / 86400000);
        sent += (await notifyStore(env, s.id, 'abonnement', { title: 'Votre essai se termine bientôt', body: days ? `Plus que ${days} jour${days > 1 ? 's' : ''} : choisissez une formule pour continuer sans interruption.` : 'Dernier jour : choisissez une formule pour continuer sans interruption.', url: '/app/#/abonnement', tag: 'essai' }, { dedupe: `essai:${s.id}:${t}` })).sent || 0;
      }
    } catch (e) { console.error('Notifications du matin', s.id, e.message); }
  }
  await db.prepare('DELETE FROM push_log WHERE sent_at < ?').bind(addDays(t, -30)).run();
  return { stores: stores.length, sent };
}
