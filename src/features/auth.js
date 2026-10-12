// Comptes, sessions et création des espaces commerce.
import {
  HttpError, json, str, num, r2, isEmail, slugify, sha256Hex, randomToken, hashPassword, verifyPassword, addDays, today, nowIso,
} from '../core/lib.js';
import { PLATFORM, PLANS, COUNTRIES, BUSINESS_TYPES, defaultSettings } from '../core/catalog.js';
import { bump, logEvent } from '../core/db.js';
import { resolvePlatformAccess } from './platform-rbac.js';

const COOKIE = 'cp_session';
const SESSION_DAYS = 30;
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const isPlatformAdmin = (env, email) =>
  String(env.PLATFORM_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).includes(String(email).toLowerCase());

async function uniqueSlug(db, name) {
  const base = slugify(name);
  for (let i = 1; i < 500; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await db.prepare('SELECT 1 FROM stores WHERE slug = ?').bind(slug).first())) return slug;
  }
  return `${base}-${Date.now()}`;
}

// Crée un commerce complet : paramètres, catégories du modèle, produits d'exemple éventuels.
export async function createStore(db, { name, type, country, phone, email, demo, previousTool }) {
  const t = BUSINESS_TYPES[type] ? type : 'autre';
  const c = COUNTRIES[country] ? country : 'XX';
  // Deux commerces du même nom au même instant : l'adresse de vitrine déjà prise est recalculée.
  let slug, r;
  for (let attempt = 0; ; attempt++) {
    slug = await uniqueSlug(db, name);
    if (attempt >= 2) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      r = await db.prepare(`INSERT INTO stores (slug, name, business_type, country, plan, status, trial_ends_at, last_active_at)
        VALUES (?, ?, ?, ?, 'essai', 'active', ?, ?)`).bind(slug, name, t, c, addDays(today(), PLATFORM.trialDays), nowIso()).run();
      break;
    } catch (e) { if (attempt < 4 && /UNIQUE/i.test(String(e.message)) && /slug/.test(String(e.message))) continue; throw e; }
  }
  const storeId = r.meta.last_row_id;
  const settings = defaultSettings({ name, phone, email, country: c, type: t });
  settings.previous_tool = str(previousTool, 40);
  const stmts = Object.entries(settings).map(([k, v]) =>
    db.prepare('INSERT INTO settings (store_id, key, value) VALUES (?, ?, ?)').bind(storeId, k, v));
  await db.batch(stmts);

  const tpl = BUSINESS_TYPES[t];
  const catIds = [];
  for (let i = 0; i < tpl.categories.length; i++) {
    const cr = await db.prepare('INSERT INTO categories (store_id, name, position) VALUES (?, ?, ?)').bind(storeId, tpl.categories[i], i).run();
    catIds.push(cr.meta.last_row_id);
  }
  if (demo) {
    const tva = num(settings.tva_default, 20);
    const ps = tpl.demo.map(([pname, desc, ci, ttc, unit, stock, min, kind], i) => {
      const ht = Math.round((ttc / (1 + tva / 100)) * 10000) / 10000;
      const tracked = kind === 'service' ? 0 : 1;
      return db.prepare(`INSERT INTO products (store_id, ref, name, description, category_id, price_ht, purchase_price, tva_rate, stock, stock_min, unit, track_stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(storeId, `EX-${String(i + 1).padStart(3, '0')}`, pname, desc, catIds[ci] || null, ht, r2(ht * 0.6), tva, tracked ? stock : 0, tracked ? min : 0, unit, tracked);
    });
    await db.batch(ps);
  }
  return { id: storeId, slug };
}

async function openSession(db, userId, storeId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare('INSERT INTO sessions (id, user_id, store_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, storeId, expires).run();
  return cookie(token, SESSION_DAYS * 86400);
}

export async function signup(db, env, b) {
  const name = str(b.name, 120), email = str(b.email, 160).toLowerCase(), password = String(b.password || '');
  const storeName = str(b.store_name, 120);
  if (!name) throw new HttpError(400, 'Indiquez votre nom.');
  if (!isEmail(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (password.length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  if (!storeName) throw new HttpError(400, 'Indiquez le nom de votre commerce.');
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
    throw new HttpError(409, 'Un compte existe déjà avec cette adresse. Connectez-vous.');
  }
  // Double clic ou deux onglets : l'index unique sur l'e-mail refuse le second compte, avec un message clair.
  let ur;
  try {
    ur = await db.prepare('INSERT INTO users (email, name, password_hash, last_login_at) VALUES (?, ?, ?, ?)')
      .bind(email, name, await hashPassword(password), nowIso()).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'Un compte existe déjà avec cette adresse. Connectez-vous.');
    throw e;
  }
  const userId = ur.meta.last_row_id;
  const store = await createStore(db, {
    name: storeName, type: b.business_type, country: b.country, phone: str(b.phone, 40), email, demo: b.demo !== false, previousTool: b.previous_tool,
  });
  await db.prepare("INSERT INTO memberships (user_id, store_id, role) VALUES (?, ?, 'owner')").bind(userId, store.id).run();
  await logEvent(db, store.id, userId, 'signup', (BUSINESS_TYPES[b.business_type] || BUSINESS_TYPES.autre).label);
  await bump(db, store.id, 'logins');
  return json({ ok: true, slug: store.slug }, 201, { 'set-cookie': await openSession(db, userId, store.id) });
}

// Protection contre les essais de mots de passe en masse :
//   par compte : 5 échecs en 15 minutes → compte bloqué 15 minutes ;
//   par adresse IP : 30 échecs en 15 minutes → adresse bloquée 15 minutes.
// Compteurs atomiques en base (des essais en parallèle ne les contournent pas) ; une réussite remet le compte à zéro.
const LOGIN_LIMITS = { account: 5, ip: 30, windowMin: 15, lockMin: 15 };
const clientIp = (request) => (request?.headers.get('cf-connecting-ip') || request?.headers.get('x-forwarded-for')?.split(',')[0] || '').trim() || 'inconnue';
async function loginLocked(db, keys) {
  const now = new Date().toISOString();
  const r = await db.prepare(`SELECT MAX(locked_until) AS until FROM login_attempts WHERE key IN (${keys.map(() => '?').join(',')}) AND locked_until > ?`).bind(...keys, now).first();
  return r?.until || null;
}
async function loginFailed(db, key, limit) {
  const now = new Date(), start = new Date(now - LOGIN_LIMITS.windowMin * 60000).toISOString();
  const r = await db.prepare(`INSERT INTO login_attempts (key, failures, window_start) VALUES (?, 1, ?)
      ON CONFLICT (key) DO UPDATE SET failures = CASE WHEN login_attempts.window_start < ? THEN 1 ELSE login_attempts.failures + 1 END,
        window_start = CASE WHEN login_attempts.window_start < ? THEN excluded.window_start ELSE login_attempts.window_start END
      RETURNING failures`).bind(key, now.toISOString(), start, start).first();
  if (r.failures >= limit) await db.prepare('UPDATE login_attempts SET locked_until = ? WHERE key = ?').bind(new Date(+now + LOGIN_LIMITS.lockMin * 60000).toISOString(), key).run();
  return r.failures;
}
const lockMessage = (until) => { const min = Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60000)); return `Trop de tentatives de connexion. Réessayez dans ${min} minute${min > 1 ? 's' : ''}, ou demandez un nouveau mot de passe.`; };

export async function login(db, env, b, request) {
  const email = str(b.email, 160).toLowerCase(), password = String(b.password || '');
  const kAccount = `compte:${email}`, kIp = `ip:${clientIp(request)}`;
  const locked = await loginLocked(db, [kAccount, kIp]);
  if (locked) throw new HttpError(429, lockMessage(locked));
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    const [nAccount] = await Promise.all([loginFailed(db, kAccount, LOGIN_LIMITS.account), loginFailed(db, kIp, LOGIN_LIMITS.ip)]);
    await new Promise((r) => setTimeout(r, 400));
    if (nAccount >= LOGIN_LIMITS.account) throw new HttpError(429, lockMessage(new Date(Date.now() + LOGIN_LIMITS.lockMin * 60000).toISOString()));
    throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
  }
  await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(kAccount).run();
  const m = await db.prepare('SELECT store_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1').bind(user.id).first();
  // Accès autorisé si commerce, super-admin env, ou membre de l'équipe plateforme (RBAC console).
  let platformMember = false;
  if (!m && !isPlatformAdmin(env, user.email)) {
    platformMember = !!(await db.prepare('SELECT 1 FROM platform_staff WHERE user_id = ?').bind(user.id).first());
    if (!platformMember) throw new HttpError(403, "Ce compte n'est rattaché à aucun commerce.");
  }
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  if (m) { await bump(db, m.store_id, 'logins'); await logEvent(db, m.store_id, user.id, 'login'); }
  // Ménage des sessions expirées de cet utilisateur.
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(user.id, nowIso()).run();
  return json({ ok: true }, 200, { 'set-cookie': await openSession(db, user.id, m ? m.store_id : null) });
}

export async function logout(db, request) {
  const token = readCookie(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
}

function readCookie(request) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

// Contexte de la requête : utilisateur, commerce et rôle, ou null.
export async function getContext(db, env, request) {
  const token = readCookie(request);
  if (!token) return null;
  const s = await db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').bind(await sha256Hex(token), nowIso()).first();
  if (!s) return null;
  const user = await db.prepare('SELECT id, email, name, must_change_password FROM users WHERE id = ?').bind(s.user_id).first();
  if (!user) return null;
  let store = null, role = null;
  if (s.store_id) {
    const m = await db.prepare('SELECT role FROM memberships WHERE user_id = ? AND store_id = ?').bind(user.id, s.store_id).first();
    if (m) {
      role = m.role;
      store = await db.prepare('SELECT * FROM stores WHERE id = ?').bind(s.store_id).first();
    }
  }
  const platform = await resolvePlatformAccess(db, env, user);
  return {
    user, store, role,
    platformAdmin: platform.platformAdmin,
    platformSuper: platform.platformSuper,
    platformRole: platform.platformRole,
    platformPermissions: platform.platformPermissions,
  };
}

// Le commerce peut-il modifier ses données ? (suspendu ou essai terminé : lecture seule)
export function storeAccess(store) {
  if (!store) return { writable: false, reason: 'Aucun commerce.' };
  if (store.status === 'suspended') return { writable: false, reason: 'Votre espace est suspendu. Contactez le support pour le réactiver.' };
  if (store.plan === 'essai' && store.trial_ends_at && store.trial_ends_at < today()) {
    return { writable: false, reason: "Votre période d'essai est terminée. Choisissez une formule pour continuer à vendre." };
  }
  return { writable: true, reason: '' };
}

export async function touchStore(db, store) {
  const now = nowIso();
  if (!store.last_active_at || store.last_active_at < new Date(Date.now() - 5 * 60000).toISOString().replace('T', ' ').slice(0, 19)) {
    await db.prepare('UPDATE stores SET last_active_at = ? WHERE id = ?').bind(now, store.id).run();
  }
}

export async function me(db, ctx) {
  const store = ctx.store;
  const plan = store ? PLANS[store.plan] || PLANS.essai : null;
  let usage = null;
  if (store) {
    const [p, u] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ?').bind(store.id).first(),
      db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE store_id = ?').bind(store.id).first(),
    ]);
    usage = { products: p.n, users: u.n };
  }
  return {
    platform: { name: PLATFORM.name },
    user: ctx.user, role: ctx.owner ? 'owner' : ctx.role ? 'member' : null, platform_admin: ctx.platformAdmin,
    platform_super: !!ctx.platformSuper,
    platform_role: ctx.platformRole || null,
    platform_permissions: ctx.platformPermissions || [],
    role_name: ctx.roleName || null, permissions: ctx.permissions || [],
    locations: (ctx.locations || []).map((l) => ({ id: l.id, name: l.name, address: l.address, phone: l.phone })),
    all_locations: !!ctx.allLocations, scope: ctx.scope ?? null,
    store: store && {
      id: store.id, slug: store.slug, name: store.name, business_type: store.business_type, country: store.country,
      plan: store.plan, plan_name: plan.name, status: store.status, trial_ends_at: store.trial_ends_at, plan_requested: store.plan_requested,
    },
    limits: plan && { products: plan.products, users: plan.users, locations: plan.locations },
    units: store ? (BUSINESS_TYPES[store.business_type] || BUSINESS_TYPES.autre).units : [],
    usage, access: storeAccess(store),
  };
}

export async function changePassword(db, ctx, b) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.user.id).first();
  const next = String(b.new_password || '');
  if (!(await verifyPassword(String(b.current_password || ''), user.password_hash))) throw new HttpError(400, 'Mot de passe actuel incorrect.');
  if (next.length < 8) throw new HttpError(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').bind(await hashPassword(next), user.id).run();
  return { ok: true };
}
