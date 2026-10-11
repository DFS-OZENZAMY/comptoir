// Mode hors ligne de l'espace commerçant : données gardées sur l'appareil et file d'attente des opérations.
// Script partagé par l'application (page) et le service worker (synchronisation même application fermée).
//   « outbox » : opérations faites hors ligne (ventes, clients, produits, mouvements de stock, messages au support),
//                rejouées dans l'ordre par POST /api/store/sync dès que la connexion revient ;
//   « cache »  : dernière copie de chaque donnée consultée, affichée quand le réseau manque.
// Chaque opération porte un identifiant unique : le serveur ne l'enregistre jamais deux fois.
(function (root) {
  'use strict';
  const DB_NAME = 'comptoir-hors-ligne', DB_VERSION = 1, BATCH = 25;
  let dbp = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('comptoir-sync') : null;

  function open() {
    return (dbp ||= new Promise((ok, ko) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'ref' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'key' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { dbp = null; ko(r.error); };
    }));
  }
  const done = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  async function store(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }
  const uuid = () => (root.crypto?.randomUUID ? root.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/-/g, '');
  const announce = (detail) => { try { channel?.postMessage(detail); } catch { /* fermé */ } };

  const api = {
    uuid,
    // Ajoute une opération à la file (statut « pending »).
    async add(op) {
      const full = { ref: op.ref || uuid(), at: new Date().toISOString(), status: 'pending', tries: 0, seq: Date.now() + Math.random() / 10, ...op };
      await done((await store('outbox', 'readwrite')).put(full));
      announce({ type: 'queued', ref: full.ref });
      return full;
    },
    async all() { return (await done((await store('outbox')).getAll())).sort((a, b) => a.seq - b.seq); },
    async put(op) { await done((await store('outbox', 'readwrite')).put(op)); announce({ type: 'changed' }); },
    async remove(ref) { await done((await store('outbox', 'readwrite')).delete(ref)); announce({ type: 'changed' }); },
    async counts() { const all = await api.all(); return { pending: all.filter((o) => o.status === 'pending').length, failed: all.filter((o) => o.status === 'failed').length }; },

    // Dernière copie connue des lectures (clé : boutique|adresse).
    async cacheGet(key) { try { return await done((await store('cache')).get(key)); } catch { return null; } },
    async cacheSet(key, data) { try { await done((await store('cache', 'readwrite')).put({ key, data, t: Date.now() })); } catch { /* espace plein : sans gravité */ } },
    async clearCache() { try { await done((await store('cache', 'readwrite')).clear()); } catch { /* rien à effacer */ } },

    // Envoie les opérations en attente. Un seul envoi à la fois sur l'appareil (application et service worker).
    async flush() {
      const run = () => api._flush();
      if (root.navigator?.locks?.request) return root.navigator.locks.request('comptoir-sync', run);
      return run();
    },
    async _flush() {
      const summary = { sent: 0, failed: 0, offline: false, auth: false, byType: {} };
      for (;;) {
        const pending = (await api.all()).filter((o) => o.status === 'pending').slice(0, BATCH);
        if (!pending.length) break;
        let res;
        try {
          res = await fetch('/api/store/sync', {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ops: pending.map((o) => ({ ref: o.ref, type: o.type, body: o.body, at: o.at, location_id: o.location_id || null, store_id: o.store_id || null })) }),
          });
        } catch { summary.offline = true; break; }
        if (res.status === 401) { summary.auth = true; break; }
        if (!res.ok || res.headers.get('x-comptoir-offline')) { summary.offline = res.status >= 500 || !!res.headers.get('x-comptoir-offline'); summary.error = res.status; break; }
        const { results = [] } = await res.json().catch(() => ({}));
        let progressed = false, stop = false;
        for (const r of results) {
          const op = pending.find((o) => o.ref === r.ref); if (!op) continue;
          if (r.status === 'ok') {
            await done((await store('outbox', 'readwrite')).delete(op.ref));
            summary.sent++; summary.byType[op.type] = (summary.byType[op.type] || 0) + 1; progressed = true;
            announce({ type: 'synced', op: { ref: op.ref, type: op.type }, result: r.result });
          } else if (r.status === 'error') {
            await done((await store('outbox', 'readwrite')).put({ ...op, status: 'failed', error: r.error, code: r.code, tries: op.tries + 1 }));
            summary.failed++; progressed = true;
          } else if (r.status === 'later') {
            await done((await store('outbox', 'readwrite')).put({ ...op, status: 'later' }));   // autre commerce : gardée de côté
            progressed = true;
          } else { stop = true; break; }                                                       // panne du serveur : on réessaiera
        }
        if (stop || !progressed) break;
      }
      announce({ type: 'flushed', summary });
      return summary;
    },
  };
  root.ComptoirOutbox = api;
})(typeof self !== 'undefined' ? self : this);
