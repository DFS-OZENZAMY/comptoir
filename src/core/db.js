// Schéma D1. Toutes les données métier portent un store_id : chaque requête est filtrée par commerce.

const SCHEMA = [
  // Plateforme
  `CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    business_type TEXT DEFAULT 'autre', country TEXT DEFAULT 'FR',
    plan TEXT DEFAULT 'essai', status TEXT DEFAULT 'active', trial_ends_at TEXT, plan_requested TEXT,
    console_notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_active_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, must_change_password INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS memberships (
    user_id INTEGER NOT NULL, store_id INTEGER NOT NULL, role TEXT DEFAULT 'staff',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, store_id))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, store_id INTEGER, expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS daily_stats (
    store_id INTEGER NOT NULL, day TEXT NOT NULL, catalog_views INTEGER DEFAULT 0, logins INTEGER DEFAULT 0,
    tickets INTEGER DEFAULT 0, documents INTEGER DEFAULT 0, sales_amount REAL DEFAULT 0, actions INTEGER DEFAULT 0,
    PRIMARY KEY (store_id, day))`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER, user_id INTEGER, type TEXT, detail TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,

  // Données de chaque commerce
  `CREATE TABLE IF NOT EXISTS settings (store_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (store_id, key))`,
  `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL, position INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, ref TEXT DEFAULT '', barcode TEXT DEFAULT '',
    name TEXT NOT NULL, description TEXT DEFAULT '', category_id INTEGER, price_ht REAL DEFAULT 0, purchase_price REAL DEFAULT 0,
    tva_rate REAL DEFAULT 20, stock REAL DEFAULT 0, stock_min REAL DEFAULT 0, unit TEXT DEFAULT 'pièce',
    visible INTEGER DEFAULT 1, track_stock INTEGER DEFAULT 1, image_v INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS images (product_id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL, mime TEXT, data TEXT)`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, product_id INTEGER, qty REAL, type TEXT, reason TEXT,
    document_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL, company TEXT DEFAULT '',
    email TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, type TEXT NOT NULL, number TEXT NOT NULL, customer_id INTEGER,
    client_name TEXT DEFAULT '', client_email TEXT DEFAULT '', client_phone TEXT DEFAULT '', client_address TEXT DEFAULT '',
    status TEXT, date TEXT, due_date TEXT, notes TEXT DEFAULT '',
    total_ht REAL DEFAULT 0, total_tva REAL DEFAULT 0, total_ttc REAL DEFAULT 0, amount_paid REAL DEFAULT 0,
    source_id INTEGER, source_type TEXT, stock_applied INTEGER DEFAULT 0, paid_at TEXT, origin TEXT DEFAULT 'admin',
    reminders INTEGER DEFAULT 0, last_reminder_at TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_id, number))`,
  `CREATE TABLE IF NOT EXISTS document_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, document_id INTEGER NOT NULL, product_id INTEGER, label TEXT,
    qty REAL DEFAULT 1, unit_price_ht REAL DEFAULT 0, tva_rate REAL DEFAULT 20, position INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, document_id INTEGER NOT NULL, amount REAL NOT NULL,
    method TEXT DEFAULT '', date TEXT, note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,

  // Boutiques (points de vente), stock par boutique et rôles de l'équipe
  `CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL, address TEXT DEFAULT '', phone TEXT DEFAULT '',
    active INTEGER DEFAULT 1, position INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS location_stock (
    store_id INTEGER NOT NULL, location_id INTEGER NOT NULL, product_id INTEGER NOT NULL, qty REAL DEFAULT 0,
    PRIMARY KEY (location_id, product_id))`,
  `CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '',
    permissions TEXT DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS loyalty_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, document_id INTEGER,
    points REAL NOT NULL, reason TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_movements(store_id, customer_id, id)`,
  // Sauvegardes de la plateforme : historique et photos déjà copiées vers la destination de sauvegarde.
  `CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, created_at TEXT, finished_at TEXT, status TEXT, trigger TEXT,
    bytes INTEGER DEFAULT 0, rows INTEGER DEFAULT 0, parts INTEGER DEFAULT 0, encrypted INTEGER DEFAULT 0, verified_at TEXT, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS backup_files (key TEXT PRIMARY KEY, copied_at TEXT)`,
  // Notifications push : un abonnement par appareil, et le journal anti-doublon.
  `CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, prefs TEXT DEFAULT '{}', label TEXT DEFAULT '',
    created_at TEXT, last_success_at TEXT, failures INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_push_store ON push_subscriptions(store_id)`,
  `CREATE TABLE IF NOT EXISTS push_log (key TEXT PRIMARY KEY, sent_at TEXT)`,
  // Connexion : échecs récents par compte et par adresse IP (protection contre les essais en masse).
  `CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, failures INTEGER DEFAULT 0, window_start TEXT, locked_until TEXT)`,
  // Messagerie avec le support : une conversation par commerce, et ses messages.
  `CREATE TABLE IF NOT EXISTS support_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL UNIQUE, status TEXT DEFAULT 'ouverte',
    assigned_to INTEGER, created_at TEXT, updated_at TEXT, last_message_at TEXT, last_preview TEXT DEFAULT '', last_author TEXT,
    unread_store INTEGER DEFAULT 0, unread_support INTEGER DEFAULT 0, store_read_at TEXT, support_read_at TEXT, context TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_support_threads_last ON support_threads(last_message_at)`,
  `CREATE TABLE IF NOT EXISTS support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
    author_id INTEGER, author_name TEXT, author_role TEXT, body TEXT, kind TEXT DEFAULT 'texte', created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_locations_store ON locations(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_location_stock_store ON location_stock(store_id, product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_roles_store ON roles(store_id)`,

  // Monitoring de la plateforme
  `CREATE TABLE IF NOT EXISTS api_stats (
    hour TEXT NOT NULL, route TEXT NOT NULL, requests INTEGER DEFAULT 0, client_errors INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    total_ms REAL DEFAULT 0, max_ms REAL DEFAULT 0, PRIMARY KEY (hour, route))`,
  `CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, method TEXT, route TEXT, path TEXT,
    status INTEGER, message TEXT, store_id INTEGER, user_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS platform_daily (
    day TEXT PRIMARY KEY, stores INTEGER, active_7d INTEGER, active_30d INTEGER, paying INTEGER, trial INTEGER,
    suspended INTEGER, mrr REAL, users INTEGER, products INTEGER, sales INTEGER)`,

  `CREATE INDEX IF NOT EXISTS idx_memberships_store ON memberships(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_store ON events(store_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_store ON categories(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_moves_store ON stock_movements(store_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_store ON documents(store_id, type, date)`,
  `CREATE INDEX IF NOT EXISTS idx_lines_doc ON document_lines(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_doc ON payments(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_store_date ON payments(store_id, date)`,
];

// Évolutions futures du schéma : [version, [requêtes]]. Chaque version ne s'applique qu'une fois.
const MIGRATIONS = [
  [2, [
    'ALTER TABLE memberships ADD COLUMN role_id INTEGER',
    "ALTER TABLE memberships ADD COLUMN locations TEXT DEFAULT ''",
    'ALTER TABLE documents ADD COLUMN location_id INTEGER',
    'ALTER TABLE stock_movements ADD COLUMN location_id INTEGER',
    'CREATE INDEX IF NOT EXISTS idx_documents_location ON documents(store_id, location_id, date)',
  ]],
  [3, [
    'ALTER TABLE customers ADD COLUMN loyalty_points REAL DEFAULT 0',
  ]],
  [4, [
    // Photos : emplacement dans le stockage externe (R2, S3, disque) quand il y en a un.
    'ALTER TABLE images ADD COLUMN storage_key TEXT',
  ]],
  [5, [
    // Mode hors ligne : identifiant de chaque opération faite sur l'appareil, pour qu'un envoi rejoué
    // (connexion coupée pendant la synchronisation) ne soit jamais enregistré deux fois.
    'ALTER TABLE documents ADD COLUMN client_ref TEXT',
    'ALTER TABLE customers ADD COLUMN client_ref TEXT',
    'ALTER TABLE stock_movements ADD COLUMN client_ref TEXT',
    'ALTER TABLE support_messages ADD COLUMN client_ref TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_client_ref ON documents(store_id, client_ref) WHERE client_ref IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_client_ref ON customers(store_id, client_ref) WHERE client_ref IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_client_ref ON stock_movements(store_id, client_ref) WHERE client_ref IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_client_ref ON support_messages(store_id, client_ref) WHERE client_ref IS NOT NULL',
  ]],
  [6, [
    // Produits créés hors ligne : même mécanisme d'identifiant unique pour éviter les doublons.
    'ALTER TABLE products ADD COLUMN client_ref TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_products_client_ref ON products(store_id, client_ref) WHERE client_ref IS NOT NULL',
  ]],
  [7, [
    // RBAC plateforme : rôles et membres de l'équipe Comptoir (console).
    `CREATE TABLE IF NOT EXISTS platform_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '[]', system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS platform_staff (
      user_id INTEGER PRIMARY KEY, role_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, invited_by INTEGER)`,
    'CREATE INDEX IF NOT EXISTS idx_platform_staff_role ON platform_staff(role_id)',
  ]],
  [8, [
    // Ticket et facture numériques : lien secret envoyé au client (WhatsApp, SMS, e-mail).
    'ALTER TABLE documents ADD COLUMN share_token TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_share_token ON documents(share_token) WHERE share_token IS NOT NULL',
  ]],
  [9, [
    // Achats et fournisseurs : fiches fournisseurs, bons de commande, lignes, réceptions (une par livraison).
    `CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, name TEXT NOT NULL,
      contact TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', address TEXT DEFAULT '', lead_days INTEGER DEFAULT 0,
      notes TEXT DEFAULT '', archived INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    'CREATE INDEX IF NOT EXISTS idx_suppliers_store ON suppliers(store_id)',
    'ALTER TABLE products ADD COLUMN supplier_id INTEGER',
    `CREATE TABLE IF NOT EXISTS purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, number TEXT NOT NULL,
      supplier_id INTEGER, location_id INTEGER, status TEXT DEFAULT 'brouillon', expected_date TEXT, notes TEXT DEFAULT '',
      total_ht REAL DEFAULT 0, received_ht REAL DEFAULT 0, remainder_cancelled INTEGER DEFAULT 0, share_token TEXT,
      created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT, received_at TEXT, cancelled_at TEXT)`,
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_number ON purchase_orders(store_id, number)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_share ON purchase_orders(share_token) WHERE share_token IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_purchase_orders_store ON purchase_orders(store_id, status)',
    `CREATE TABLE IF NOT EXISTS purchase_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
      product_id INTEGER, label TEXT NOT NULL, qty REAL NOT NULL, qty_received REAL DEFAULT 0, unit_cost REAL DEFAULT 0, position INTEGER DEFAULT 0)`,
    'CREATE INDEX IF NOT EXISTS idx_purchase_lines_order ON purchase_lines(order_id)',
    `CREATE TABLE IF NOT EXISTS purchase_receptions (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, order_id INTEGER NOT NULL,
      supplier_id INTEGER, location_id INTEGER, total_ht REAL DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    'CREATE INDEX IF NOT EXISTS idx_purchase_receptions_store ON purchase_receptions(store_id, created_at)',
    // Rôles existants : qui gère le stock peut commander et réceptionner ; qui voit les rapports peut consulter les achats.
    `UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'purchases.view') WHERE (permissions LIKE '%"stock.manage"%' OR permissions LIKE '%"reports.view"%') AND permissions NOT LIKE '%"purchases.view"%'`,
    `UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'purchases.manage') WHERE permissions LIKE '%"stock.manage"%' AND permissions NOT LIKE '%"purchases.manage"%'`,
  ]],
];

// Bases déjà initialisées : suivi base par base (un même serveur peut en ouvrir plusieurs).
const ready = new WeakSet();
export async function init(db) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  await db.prepare(`CREATE TABLE IF NOT EXISTS platform_meta (key TEXT PRIMARY KEY, value TEXT)`).run();
  const row = await db.prepare("SELECT value FROM platform_meta WHERE key = 'schema_version'").first();
  let version = row ? Number(row.value) : 1;
  for (const [v, statements] of MIGRATIONS) {
    if (version >= v) continue;
    for (const sql of statements) {
      try { await db.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    }
    version = v;
  }
  await db.prepare("INSERT OR REPLACE INTO platform_meta (key, value) VALUES ('schema_version', ?)").bind(String(version)).run();
  ready.add(db);
}

// Compteurs d'usage par jour (console de la plateforme).
const STAT_FIELDS = ['catalog_views', 'logins', 'tickets', 'documents', 'sales_amount', 'actions'];
export async function bump(db, storeId, field, inc = 1) {
  if (!STAT_FIELDS.includes(field) || !storeId) return;
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO daily_stats (store_id, day, ${field}) VALUES (?, ?, ?)
    ON CONFLICT (store_id, day) DO UPDATE SET ${field} = ${field} + excluded.${field}`).bind(storeId, day, inc).run();
}

export async function logEvent(db, storeId, userId, type, detail = '') {
  await db.prepare('INSERT INTO events (store_id, user_id, type, detail) VALUES (?, ?, ?, ?)')
    .bind(storeId || null, userId || null, type, String(detail).slice(0, 300)).run();
}

// Mesure de chaque appel d'API, agrégée par heure et par fonction.
export async function recordRequest(db, route, status, ms) {
  const hour = new Date().toISOString().slice(0, 13);
  const client = status >= 400 && status < 500 ? 1 : 0, server = status >= 500 ? 1 : 0;
  await db.prepare(`INSERT INTO api_stats (hour, route, requests, client_errors, errors, total_ms, max_ms) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT (hour, route) DO UPDATE SET requests = requests + 1, client_errors = client_errors + excluded.client_errors,
    errors = errors + excluded.errors, total_ms = total_ms + excluded.total_ms, max_ms = MAX(max_ms, excluded.max_ms)`)
    .bind(hour, route, client, server, ms, ms).run();
}

export async function logError(db, info) {
  await db.prepare('INSERT INTO error_log (method, route, path, status, message, store_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(info.method, info.route, String(info.path).slice(0, 200), info.status, String(info.message).slice(0, 1000), info.store_id || null, info.user_id || null).run();
}

export async function setMeta(db, key, value) {
  await db.prepare('INSERT OR REPLACE INTO platform_meta (key, value) VALUES (?, ?)').bind(key, String(value)).run();
}
