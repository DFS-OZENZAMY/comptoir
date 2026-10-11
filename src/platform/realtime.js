// Temps réel de la messagerie : des connexions WebSocket rangées par canal,
//   « store:<id> » : les membres d'un commerce ;   « support » : l'équipe Comptoir.
// Les messages sont TOUJOURS enregistrés en base d'abord ; le temps réel ne fait que prévenir
// les navigateurs ouverts. Sans temps réel, l'interface se met à jour par interrogation régulière.
//   Cloudflare : Durable Object « ChatHub » (WebSockets en veille, src/adapters/cloudflare.js).
//   Node.js    : concentrateur en mémoire (src/adapters/node/websocket.js).

// Ce qu'un navigateur peut envoyer lui-même : uniquement « en train d'écrire » et « ping ».
// Le serveur décide seul vers qui le relayer, d'après l'identité vérifiée de la connexion.
export function relay(identity, data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'typing') {
    if (identity.role === 'client') return { channels: ['support'], event: { type: 'typing', storeId: identity.storeId, name: identity.name, side: 'client' } };
    const storeId = Number(data.storeId);
    if (identity.role === 'support' && storeId) return { channels: [`store:${storeId}`], event: { type: 'typing', storeId, name: identity.name, side: 'support' } };
  }
  return null;
}
export const channelsOf = (identity) => (identity.role === 'support' ? ['support'] : [`store:${identity.storeId}`]);

// Concentrateur générique (Node.js, tests) : sockets = { send(texte), close() }.
export function memoryHub() {
  const sockets = new Map(); // socket → identité
  const send = (s, e) => { try { s.send(JSON.stringify(e)); } catch { /* connexion fermée */ } };
  const supportCount = () => [...sockets.values()].filter((i) => i.role === 'support').length;
  const presence = () => { const n = supportCount(); for (const [s, i] of sockets) if (i.role === 'client') send(s, { type: 'presence', support: n }); };
  const hub = {
    available: true, events: [],
    attach(socket, identity) {
      sockets.set(socket, identity);
      send(socket, { type: 'hello', support: supportCount() });
      if (identity.role === 'support') presence();
      return {
        message(text) {
          let data; try { data = JSON.parse(text); } catch { return; }
          if (data.type === 'ping') return send(socket, { type: 'pong' });
          const r = relay(identity, data); if (r) hub.publish(r.channels, r.event, socket);
        },
        close() { const was = sockets.get(socket); sockets.delete(socket); if (was?.role === 'support') presence(); },
      };
    },
    async publish(channels, event, except) {
      hub.events.push({ channels, event });
      for (const [s, i] of sockets) if (s !== except && channelsOf(i).some((c) => channels.includes(c))) send(s, event);
    },
    async presence() { return { support: supportCount() }; },
    size: () => sockets.size,
  };
  return hub;
}

// Accès au temps réel depuis l'application, quel que soit l'hébergement.
export function getRealtime(env) {
  if (env.REALTIME) return env.REALTIME;
  if (env.CHAT_HUB) {
    const stub = () => env.CHAT_HUB.get(env.CHAT_HUB.idFromName('hub'));
    return {
      available: true,
      async publish(channels, event) { await stub().fetch('https://hub/publish', { method: 'POST', body: JSON.stringify({ channels, event }) }); },
      async presence() { return (await stub().fetch('https://hub/presence')).json(); },
      // Ouverture d'une connexion : l'identité, vérifiée par l'application, est transmise au Durable Object.
      connect(request, identity) {
        const headers = new Headers(request.headers); headers.set('x-chat-identity', JSON.stringify(identity));
        return stub().fetch(new Request('https://hub/socket', { headers }));
      },
    };
  }
  return { available: false, async publish() {}, async presence() { return { support: 0 }; } };
}
