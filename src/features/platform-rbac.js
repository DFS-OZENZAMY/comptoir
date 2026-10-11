// RBAC de la plateforme (console) : rôles, permissions, équipe.
// Modèle enterprise : permissions granulaires, rôles système seedés, super-admin via PLATFORM_ADMIN_EMAILS.
import { HttpError, str, num, hashPassword, tempPassword } from '../core/lib.js';
import {
  PLATFORM_PERMISSIONS, PLATFORM_PERMISSION_KEYS, DEFAULT_PLATFORM_ROLES,
} from '../core/catalog.js';
import { logEvent } from '../core/db.js';

// Même règle que auth.js (évite un import circulaire auth ↔ platform-rbac).
const isPlatformAdmin = (env, email) =>
  String(env.PLATFORM_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).includes(String(email).toLowerCase());

const parsePerms = (v) => {
  try {
    const x = JSON.parse(v || '[]');
    return Array.isArray(x) ? x.filter((k) => PLATFORM_PERMISSION_KEYS.includes(k)) : [];
  } catch { return []; }
};

const seeded = new WeakSet();

/** Crée les rôles système s'ils n'existent pas encore. */
export async function ensurePlatformRoles(db) {
  if (seeded.has(db)) return;
  for (const r of DEFAULT_PLATFORM_ROLES) {
    const ex = await db.prepare('SELECT id FROM platform_roles WHERE name = ?').bind(r.name).first();
    if (ex) continue;
    await db.prepare(
      'INSERT INTO platform_roles (name, description, permissions, system) VALUES (?, ?, ?, 1)',
    ).bind(r.name, r.description, JSON.stringify(r.permissions)).run();
  }
  seeded.add(db);
}

/**
 * Résout l'accès console d'un utilisateur.
 * - Super-admin (PLATFORM_ADMIN_EMAILS) : toutes les permissions, rôle « Propriétaire ».
 * - Membre platform_staff : permissions de son rôle.
 * - Sinon : pas d'accès.
 */
export async function resolvePlatformAccess(db, env, user) {
  await ensurePlatformRoles(db);
  const superAdmin = isPlatformAdmin(env, user.email);
  if (superAdmin) {
    return {
      platformAdmin: true,
      platformSuper: true,
      platformRole: { id: null, name: 'Propriétaire', system: true },
      platformPermissions: [...PLATFORM_PERMISSION_KEYS],
    };
  }
  const row = await db.prepare(
    `SELECT s.role_id, r.name, r.permissions, r.system
     FROM platform_staff s JOIN platform_roles r ON r.id = s.role_id
     WHERE s.user_id = ?`,
  ).bind(user.id).first();
  if (!row) {
    return { platformAdmin: false, platformSuper: false, platformRole: null, platformPermissions: [] };
  }
  const perms = parsePerms(row.permissions);
  return {
    platformAdmin: perms.length > 0,
    platformSuper: false,
    platformRole: { id: row.role_id, name: row.name, system: !!row.system },
    platformPermissions: perms,
  };
}

/** Vérifie une permission plateforme sur le contexte (à appeler dans les routes console). */
export function platformNeed(ctx, key) {
  if (ctx.platformSuper) return;
  if (!(ctx.platformPermissions || []).includes(key)) {
    throw new HttpError(403, 'Vous n’avez pas la permission d’effectuer cette action.');
  }
}

export function platformCan(ctx, key) {
  return !!(ctx.platformSuper || (ctx.platformPermissions || []).includes(key));
}

/* ------------------------------------------------------------------ */
/* Catalogue des permissions et rôles (API)                            */
/* ------------------------------------------------------------------ */

export async function listPlatformPermissions() {
  return PLATFORM_PERMISSIONS;
}

export async function listPlatformRoles(db) {
  await ensurePlatformRoles(db);
  const rows = (await db.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM platform_staff s WHERE s.role_id = r.id) AS members
     FROM platform_roles r ORDER BY r.system DESC, r.name`,
  ).all()).results;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    system: !!r.system,
    permissions: parsePerms(r.permissions),
    members: r.members,
  }));
}

export async function createPlatformRole(ctx, b) {
  platformNeed(ctx, 'platform.roles.manage');
  const { db } = ctx;
  const name = str(b.name, 60);
  if (!name) throw new HttpError(400, 'Donnez un nom au rôle.');
  if (await db.prepare('SELECT 1 FROM platform_roles WHERE name = ?').bind(name).first()) {
    throw new HttpError(409, 'Un rôle porte déjà ce nom.');
  }
  const perms = [...new Set((Array.isArray(b.permissions) ? b.permissions : []).filter((k) => PLATFORM_PERMISSION_KEYS.includes(k)))];
  if (!perms.length) throw new HttpError(400, 'Choisissez au moins une permission.');
  const r = await db.prepare(
    'INSERT INTO platform_roles (name, description, permissions, system) VALUES (?, ?, ?, 0)',
  ).bind(name, str(b.description, 300), JSON.stringify(perms)).run();
  await logEvent(db, null, ctx.user.id, 'platform_role', `Rôle créé : ${name}`);
  return { id: r.meta.last_row_id };
}

export async function updatePlatformRole(ctx, id, b) {
  platformNeed(ctx, 'platform.roles.manage');
  const { db } = ctx;
  const role = await db.prepare('SELECT * FROM platform_roles WHERE id = ?').bind(num(id)).first();
  if (!role) throw new HttpError(404, 'Rôle introuvable.');
  if (role.system) throw new HttpError(403, 'Les rôles système ne peuvent pas être renommés ni vidés. Dupliquez-les pour en créer un personnalisé.');
  const name = str(b.name, 60) || role.name;
  const perms = [...new Set((Array.isArray(b.permissions) ? b.permissions : parsePerms(role.permissions)).filter((k) => PLATFORM_PERMISSION_KEYS.includes(k)))];
  if (!perms.length) throw new HttpError(400, 'Choisissez au moins une permission.');
  if (name !== role.name && await db.prepare('SELECT 1 FROM platform_roles WHERE name = ? AND id != ?').bind(name, role.id).first()) {
    throw new HttpError(409, 'Un rôle porte déjà ce nom.');
  }
  await db.prepare('UPDATE platform_roles SET name = ?, description = ?, permissions = ? WHERE id = ?')
    .bind(name, str(b.description, 300), JSON.stringify(perms), role.id).run();
  await logEvent(db, null, ctx.user.id, 'platform_role', `Rôle modifié : ${name}`);
  return { ok: true };
}

export async function deletePlatformRole(ctx, id) {
  platformNeed(ctx, 'platform.roles.manage');
  const { db } = ctx;
  const role = await db.prepare('SELECT * FROM platform_roles WHERE id = ?').bind(num(id)).first();
  if (!role) throw new HttpError(404, 'Rôle introuvable.');
  if (role.system) throw new HttpError(403, 'Un rôle système ne peut pas être supprimé.');
  const used = await db.prepare('SELECT COUNT(*) AS n FROM platform_staff WHERE role_id = ?').bind(role.id).first();
  if (used.n) throw new HttpError(409, `Ce rôle est encore attribué à ${used.n} membre${used.n > 1 ? 's' : ''}. Réaffectez-les d’abord.`);
  await db.prepare('DELETE FROM platform_roles WHERE id = ?').bind(role.id).run();
  await logEvent(db, null, ctx.user.id, 'platform_role', `Rôle supprimé : ${role.name}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Équipe plateforme                                                   */
/* ------------------------------------------------------------------ */

export async function listPlatformStaff(db, env) {
  await ensurePlatformRoles(db);
  const rows = (await db.prepare(
    `SELECT u.id, u.name, u.email, u.created_at, u.last_login_at,
            s.role_id, s.created_at AS joined_at, r.name AS role_name, r.system AS role_system
     FROM platform_staff s
     JOIN users u ON u.id = s.user_id
     JOIN platform_roles r ON r.id = s.role_id
     ORDER BY u.name`,
  ).all()).results;

  // Super-admins déclarés dans l'env, même s'ils ne sont pas en platform_staff.
  const adminEmails = String(env.PLATFORM_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const seen = new Set(rows.map((r) => r.email.toLowerCase()));
  const supers = [];
  for (const email of adminEmails) {
    if (seen.has(email)) continue;
    const u = await db.prepare('SELECT id, name, email, created_at, last_login_at FROM users WHERE lower(email) = ?').bind(email).first();
    if (u) {
      supers.push({
        id: u.id, name: u.name, email: u.email, created_at: u.created_at, last_login_at: u.last_login_at,
        role_id: null, role_name: 'Propriétaire', role_system: 1, joined_at: null, super: true,
      });
    } else {
      supers.push({
        id: null, name: email, email, created_at: null, last_login_at: null,
        role_id: null, role_name: 'Propriétaire', role_system: 1, joined_at: null, super: true, pending: true,
      });
    }
  }
  const staff = rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, created_at: r.created_at, last_login_at: r.last_login_at,
    role_id: r.role_id, role_name: r.role_name, role_system: !!r.role_system, joined_at: r.joined_at,
    super: adminEmails.includes(r.email.toLowerCase()),
  }));
  return [...supers, ...staff];
}

export async function addPlatformStaff(ctx, b) {
  platformNeed(ctx, 'platform.staff.manage');
  const { db, env } = ctx;
  const email = str(b.email, 160).toLowerCase();
  const name = str(b.name, 80);
  const roleId = num(b.role_id);
  if (!email || !email.includes('@')) throw new HttpError(400, 'Indiquez une adresse e-mail valide.');
  if (!roleId) throw new HttpError(400, 'Choisissez un rôle.');
  const role = await db.prepare('SELECT id, name FROM platform_roles WHERE id = ?').bind(roleId).first();
  if (!role) throw new HttpError(404, 'Rôle introuvable.');

  let user = await db.prepare('SELECT id, email, name FROM users WHERE lower(email) = ?').bind(email).first();
  let temp = null;
  if (!user) {
    if (!name) throw new HttpError(400, 'Indiquez le nom du nouveau membre.');
    temp = tempPassword();
    const r = await db.prepare(
      'INSERT INTO users (email, name, password_hash, must_change_password) VALUES (?, ?, ?, 1)',
    ).bind(email, name, await hashPassword(temp)).run();
    user = { id: r.meta.last_row_id, email, name };
  }
  if (await db.prepare('SELECT 1 FROM platform_staff WHERE user_id = ?').bind(user.id).first()) {
    throw new HttpError(409, 'Cette personne fait déjà partie de l’équipe plateforme.');
  }
  // Ne pas « rétrograder » un super-admin env en l'ajoutant comme staff sans rôle Propriétaire — autorisé mais signalé.
  await db.prepare('INSERT INTO platform_staff (user_id, role_id, invited_by) VALUES (?, ?, ?)')
    .bind(user.id, role.id, ctx.user.id).run();
  await logEvent(db, null, ctx.user.id, 'platform_staff', `Ajout : ${user.email} → ${role.name}`);
  return { ok: true, user_id: user.id, email: user.email, temp_password: temp };
}

export async function updatePlatformStaff(ctx, userId, b) {
  platformNeed(ctx, 'platform.staff.manage');
  const { db } = ctx;
  const uid = num(userId);
  if (uid === ctx.user.id && !ctx.platformSuper) {
    throw new HttpError(403, 'Vous ne pouvez pas modifier votre propre rôle. Demandez à un propriétaire.');
  }
  const staff = await db.prepare('SELECT * FROM platform_staff WHERE user_id = ?').bind(uid).first();
  if (!staff) throw new HttpError(404, 'Membre introuvable dans l’équipe plateforme.');
  const roleId = num(b.role_id);
  if (!roleId) throw new HttpError(400, 'Choisissez un rôle.');
  const role = await db.prepare('SELECT id, name FROM platform_roles WHERE id = ?').bind(roleId).first();
  if (!role) throw new HttpError(404, 'Rôle introuvable.');
  await db.prepare('UPDATE platform_staff SET role_id = ? WHERE user_id = ?').bind(role.id, uid).run();
  await logEvent(db, null, ctx.user.id, 'platform_staff', `Rôle changé (user ${uid}) → ${role.name}`);
  return { ok: true };
}

export async function removePlatformStaff(ctx, userId) {
  platformNeed(ctx, 'platform.staff.manage');
  const { db, env } = ctx;
  const uid = num(userId);
  if (uid === ctx.user.id) throw new HttpError(403, 'Vous ne pouvez pas vous retirer vous-même.');
  const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(uid).first();
  if (!user) throw new HttpError(404, 'Utilisateur introuvable.');
  if (isPlatformAdmin(env, user.email)) {
    throw new HttpError(403, 'Ce compte est propriétaire (PLATFORM_ADMIN_EMAILS). Retirez-le de la configuration serveur pour lui retirer l’accès.');
  }
  const staff = await db.prepare('SELECT 1 FROM platform_staff WHERE user_id = ?').bind(uid).first();
  if (!staff) throw new HttpError(404, 'Membre introuvable dans l’équipe plateforme.');
  await db.prepare('DELETE FROM platform_staff WHERE user_id = ?').bind(uid).run();
  await logEvent(db, null, ctx.user.id, 'platform_staff', `Retrait : ${user.email}`);
  return { ok: true };
}

/** Mapping route console → permission requise (lecture). Les écritures sont vérifiées dans le handler. */
export const CONSOLE_ROUTE_PERM = {
  overview: 'platform.overview',
  todo: 'platform.todo',
  activity: 'platform.activity',
  revenue: 'platform.revenue',
  events: 'platform.events',
  stores: 'platform.stores.view',
  export: 'platform.stores.export',
  support: 'platform.support.view',
  users: 'platform.users.view',
  system: 'platform.system.view',
  backups: 'platform.system.backups',
  push: 'platform.support.view',
  plans: 'platform.stores.view',
  staff: 'platform.staff.view',
  roles: 'platform.staff.view',
  permissions: 'platform.staff.view',
  me: null, // toujours autorisé si accès console
};
