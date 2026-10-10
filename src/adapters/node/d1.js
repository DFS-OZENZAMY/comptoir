// Bases de données au format D1 pour Node.js : l'application appelle partout la même interface
// (prepare → bind → first / all / run, et batch), quelle que soit la base réelle.
//   SQLite local : node:sqlite (intégré à Node 22, aucune dépendance).
//   libSQL / Turso : @libsql/client (même SQL que SQLite, base partagée entre plusieurs serveurs).
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const returnsRows = (sql) => /^\s*(select|with|pragma|values)\b/i.test(sql) || /\breturning\b/i.test(sql);

class Statement {
  constructor(engine, sql, params = []) { this.engine = engine; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.engine, this.sql, params.map(norm)); }
  async all() { return this.engine.exec(this.sql, this.params); }
  async run() { return this.engine.exec(this.sql, this.params); }
  async first(col) { const r = (await this.engine.exec(this.sql, this.params)).results[0]; return r === undefined ? null : col ? r[col] ?? null : r; }
  async raw() { return (await this.engine.exec(this.sql, this.params)).results.map((r) => Object.values(r)); }
}

export function sqliteD1(path) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  const execSync = (sql, params) => {
    const s = stmt(sql);
    if (returnsRows(sql)) { const rows = s.all(...params).map((r) => ({ ...r })); return { success: true, results: rows, meta: { changes: 0, last_row_id: 0, rows_read: rows.length } }; }
    const r = s.run(...params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const engine = { exec: async (sql, params) => execSync(sql, params) };
  return {
    kind: 'sqlite',
    prepare: (sql) => new Statement(engine, sql),
    // Toutes les instructions d'un lot réussissent ou aucune (comme D1).
    async batch(list) {
      db.exec('BEGIN');
      try { const out = list.map((s) => execSync(s.sql, s.params)); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
    close: () => db.close(),
  };
}

export async function libsqlD1(url, authToken) {
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url, authToken });
  const shape = (r) => ({
    success: true,
    results: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, typeof row[i] === 'bigint' ? Number(row[i]) : row[i]]))),
    meta: { changes: r.rowsAffected, last_row_id: r.lastInsertRowid === undefined ? 0 : Number(r.lastInsertRowid) },
  });
  const engine = { exec: async (sql, args) => shape(await client.execute({ sql, args })) };
  return {
    kind: 'libsql',
    prepare: (sql) => new Statement(engine, sql),
    async batch(list) { return (await client.batch(list.map((s) => ({ sql: s.sql, args: s.params })), 'write')).map(shape); },
    async exec(sql) { await client.executeMultiple(sql); return { count: 1 }; },
    close: () => client.close(),
  };
}

// DATABASE_URL : « file:./data/comptoir.db » (défaut), « :memory: », « libsql://… » ou « https://…turso.io ».
export async function openDatabase(url = 'file:./data/comptoir.db', authToken) {
  if (/^(libsql|wss?|https?):/.test(url)) return libsqlD1(url, authToken);
  const path = url === ':memory:' ? ':memory:' : url.replace(/^file:/, '');
  if (path !== ':memory:') {
    const { mkdirSync } = process.getBuiltinModule('node:fs'); const { dirname } = process.getBuiltinModule('node:path');
    mkdirSync(dirname(path), { recursive: true });
  }
  return sqliteD1(path);
}
