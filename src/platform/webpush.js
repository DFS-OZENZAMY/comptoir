// Notifications push du web, en JavaScript standard (Cloudflare Workers, Node.js, Deno, Bun) :
//   signature VAPID (RFC 8292) : le service de notification sait que le message vient de Comptoir ;
//   chiffrement « aes128gcm » (RFC 8291 / RFC 8188) : seul l'appareil destinataire peut lire le contenu.
// Aucune dépendance, aucun service payant : Google, Apple, Mozilla et Microsoft acheminent gratuitement.

const enc = new TextEncoder();
export const b64u = {
  enc: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); },
};
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

// Seuls les vrais services de notification sont acceptés : le serveur n'écrit jamais vers une adresse quelconque.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/i;
export function isPushEndpoint(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.port && PUSH_HOSTS.test(u.hostname); } catch { return false; }
}

/* ------------------------------------------------------------------ */
/* Clés VAPID                                                          */
/* ------------------------------------------------------------------ */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64u.enc(await crypto.subtle.exportKey('raw', kp.publicKey)), privateKey: jwk.d };
}
const jwkFrom = (publicKey, d) => { const p = b64u.dec(publicKey); return { kty: 'EC', crv: 'P-256', x: b64u.enc(p.slice(1, 33)), y: b64u.enc(p.slice(33, 65)), d, ext: true }; };

export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', jwkFrom(publicKey, privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${publicKey}`;
}

/* ------------------------------------------------------------------ */
/* Chiffrement du contenu (RFC 8291)                                   */
/* ------------------------------------------------------------------ */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
// « test » permet d'imposer la clé éphémère et le sel, pour vérifier le calcul sur l'exemple de la RFC.
export async function encryptPayload(payload, p256dh, auth, test = {}) {
  const uaPublic = b64u.dec(p256dh), authSecret = b64u.dec(auth);
  let asPrivate, asPublic;
  if (test.asPublic) {
    asPublic = b64u.dec(test.asPublic);
    asPrivate = await crypto.subtle.importKey('jwk', jwkFrom(test.asPublic, test.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivate = kp.privateKey; asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = test.salt ? b64u.dec(test.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = typeof payload === 'string' ? enc.encode(payload) : payload;
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(data, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // taille d'enregistrement : 4096 octets
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* ------------------------------------------------------------------ */
/* Envoi                                                               */
/* ------------------------------------------------------------------ */
// Renvoie { ok, status, gone } ; « gone » : l'abonnement n'existe plus (appareil désinstallé, permission retirée).
export async function sendWebPush(subscription, message, vapid, { ttl = 86400, urgency = 'normal', topic } = {}) {
  if (!isPushEndpoint(subscription.endpoint)) return { ok: false, status: 0, gone: true };
  const body = await encryptPayload(JSON.stringify(message), subscription.p256dh, subscription.auth);
  if (body.length > 4096) throw new Error('Notification trop longue.');
  const headers = { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(ttl), urgency, authorization: await vapidAuthorization(subscription.endpoint, vapid) };
  if (topic) headers.topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  let res;
  try { res = await fetch(subscription.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) }); }
  catch { return { ok: false, status: 0, gone: false }; }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
}
