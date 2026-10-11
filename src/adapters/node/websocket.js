// Serveur WebSocket minimal (RFC 6455) pour Node.js, sans dépendance : poignée de main,
// trames texte (fragmentées ou non), ping/pong, fermeture, taille limitée. Suffisant pour la messagerie.
import { createHash } from 'node:crypto';
import { chatIdentity } from '../../features/support.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 64 * 1024;

function frame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, data]);
}

// Accepte la connexion sur un « upgrade » HTTP et renvoie un objet { send, close, onMessage, onClose }.
export function acceptWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = { open: true, onMessage: () => {}, onClose: () => {} };
  ws.send = (text) => { if (ws.open) socket.write(frame(1, String(text))); };
  ws.close = (code = 1000) => { if (!ws.open) return; ws.open = false; const b = Buffer.alloc(2); b.writeUInt16BE(code); socket.end(frame(8, b)); ws.onClose(); };
  let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), parts = [];
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, opcode = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > MAX) return ws.close(1002);           // les navigateurs masquent toujours leurs trames
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4); const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      buf = buf.subarray(off + 4 + len);
      if (opcode === 8) return ws.close(1000);
      if (opcode === 9) { socket.write(frame(10, data)); continue; }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 0) {
        parts.push(data);
        if (Buffer.concat(parts).length > MAX) return ws.close(1009);
        if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; ws.onMessage(text); }
      }
    }
  });
  const end = () => { if (ws.open) { ws.open = false; ws.onClose(); } };
  socket.on('close', end); socket.on('error', end);
  // Battement de cœur : un ping toutes les 25 s garde la connexion ouverte derrière les proxys.
  const beat = setInterval(() => { if (ws.open) socket.write(frame(9, Buffer.alloc(0))); else clearInterval(beat); }, 25000);
  beat.unref?.();
  return ws;
}

// Branche la messagerie temps réel sur un serveur HTTP Node : identité vérifiée, puis connexion au concentrateur.
export function attachChat(server, env, { trustProxy = true } = {}) {
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/chat/socket') return socket.destroy();
    const proto = trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : 'http';
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    let identity;
    try { identity = await chatIdentity(env, new Request(`${proto}://${req.headers.host || 'localhost'}${req.url}`, { headers })); }
    catch (e) { socket.end(`HTTP/1.1 ${e.status || 401} Refused\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${e.message}`); return; }
    const ws = acceptWebSocket(req, socket, head); if (!ws) return;
    const conn = env.REALTIME.attach(ws, identity);
    ws.onMessage = conn.message; ws.onClose = conn.close;
  });
}
