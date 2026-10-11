// Adaptateur Cloudflare Workers : la plateforme fournit déjà tout ce que l'application attend
// (env.DB = D1, env.ASSETS = fichiers du site, env.FILES = R2 facultatif, ctx.waitUntil, tâche planifiée).
import { relay, channelsOf } from '../platform/realtime.js';
export { default } from '../app.js';

// Concentrateur de la messagerie : un seul Durable Object (« hub ») tient toutes les connexions.
// API de mise en veille : une connexion inactive ne coûte rien ; l'objet se réveille à chaque message.
// L'identité de chaque connexion est fixée par l'application (vérifiée côté serveur), jamais par le navigateur.
export class ChatHub {
  constructor(state) {
    this.state = state;
    // Les « ping » de maintien de connexion reçoivent leur réponse sans réveiller l'objet : quasi gratuit.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }
  send(ws, event) { try { ws.send(JSON.stringify(event)); } catch { /* connexion fermée */ } }
  supportCount() { return this.state.getWebSockets('support').length; }
  presence() { const n = this.supportCount(); for (const ws of this.state.getWebSockets('client')) this.send(ws, { type: 'presence', support: n }); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/publish') {
      const { channels, event } = await request.json();
      for (const c of channels) for (const ws of this.state.getWebSockets(c)) this.send(ws, event);
      return new Response('ok');
    }
    if (url.pathname === '/presence') return Response.json({ support: this.supportCount() });
    if (url.pathname === '/socket' && request.headers.get('upgrade') === 'websocket') {
      const identity = JSON.parse(request.headers.get('x-chat-identity') || 'null');
      if (!identity) return new Response('Identité manquante', { status: 400 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], [...channelsOf(identity), identity.role]);
      pair[1].serializeAttachment(identity);
      this.send(pair[1], { type: 'hello', support: this.supportCount() });
      if (identity.role === 'support') this.presence();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('Introuvable', { status: 404 });
  }
  webSocketMessage(ws, message) {
    let data; try { data = JSON.parse(message); } catch { return; }
    if (data.type === 'ping') return this.send(ws, { type: 'pong' });
    const r = relay(ws.deserializeAttachment(), data);
    if (r) for (const c of r.channels) for (const other of this.state.getWebSockets(c)) if (other !== ws) this.send(other, r.event);
  }
  webSocketClose(ws) { if (ws.deserializeAttachment()?.role === 'support') queueMicrotask(() => this.presence()); }
  webSocketError(ws) { this.webSocketClose(ws); }
}
