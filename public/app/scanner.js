// Lecture des codes-barres avec la caméra du téléphone, de la tablette ou de l'ordinateur.
// Lecteur natif du navigateur quand il existe (Chrome Android, Edge, Chrome macOS) ; sinon ZXing en WebAssembly
// (iPhone, Firefox), servi par Comptoir depuis /vendor/barcode/ et gardé par le service worker : marche hors ligne.
//   ComptoirScanner.open({ title, continuous, onCode(code) → { ok, message, actionLabel?, action? } })
(() => {
  'use strict';
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix'];
  const VENDOR = '/vendor/barcode/';
  let detectorPromise = null;

  // Lecteur : natif s'il gère les codes-barres de commerce, sinon ZXing (chargé une seule fois).
  function detector() {
    return (detectorPromise ||= (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const wanted = FORMATS.filter((f) => supported.includes(f));
          if (wanted.includes('ean_13')) return new window.BarcodeDetector({ formats: wanted });
        } catch { /* lecteur natif indisponible : ZXing */ }
      }
      if (!window.BarcodeDetectionAPI) {
        await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = VENDOR + 'barcode-detector.js'; s.onload = ok; s.onerror = () => ko(new Error('Lecteur de codes-barres introuvable.')); document.head.append(s); });
      }
      const api = window.BarcodeDetectionAPI;
      api.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? VENDOR + path : prefix + path) }, fireImmediately: true });
      return new api.BarcodeDetector({ formats: FORMATS });
    })().catch((e) => { detectorPromise = null; throw e; }));
  }

  // Bip court (le son du scanner de caisse) et vibration.
  let audio;
  function beep(ok = true) {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = ok ? 1760 : 330; o.type = 'square'; g.gain.value = 0.05;
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.07 : 0.18));
    } catch { /* son indisponible */ }
    try { navigator.vibrate?.(ok ? 40 : [60, 40, 60]); } catch { /* vibration indisponible */ }
  }

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function open({ title = 'Scanner un code-barres', continuous = false, hint, onCode }) {
    if (document.getElementById('scanner')) return;
    const el = document.createElement('div');
    el.id = 'scanner'; el.className = 'scanner'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title);
    el.innerHTML = `
      <video playsinline muted autoplay aria-hidden="true"></video>
      <div class="scan-top"><strong>${esc(title)}</strong><button type="button" class="scan-x" aria-label="Fermer le scanner">✕</button></div>
      <div class="scan-frame" aria-hidden="true"><i></i></div>
      <div class="scan-bottom">
        <p class="scan-status" aria-live="polite">${esc(hint || 'Placez le code-barres dans le cadre')}</p>
        <div class="scan-result" hidden></div>
        <form class="scan-manual" hidden><input inputmode="numeric" autocomplete="off" placeholder="Saisir le code" aria-label="Code-barres"><button class="btn btn-primary" type="submit">Valider</button></form>
        <div class="scan-actions">
          <button type="button" class="scan-btn" data-act="torch" hidden>Lampe</button>
          <button type="button" class="scan-btn" data-act="manual">Saisir le code</button>
          ${continuous ? '<button type="button" class="scan-btn primary" data-act="done">Terminer <span class="scan-count"></span></button>' : ''}
        </div>
      </div>`;
    document.body.append(el);
    document.body.classList.add('scanning');
    const video = el.querySelector('video'), status = el.querySelector('.scan-status'), result = el.querySelector('.scan-result');
    let stream = null, closed = false, timer = null, last = { code: '', at: 0 }, count = 0, paused = false;

    // Fermeture : caméra éteinte, étape d'historique retirée. « then » s'exécute une fois ce retour terminé,
    // pour qu'une fenêtre ouverte ensuite (« Créer ce produit ») ne soit pas refermée par ce retour.
    const close = (then) => {
      if (closed) return; closed = true;
      clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop());
      el.remove(); document.body.classList.remove('scanning');
      window.removeEventListener('popstate', onPop);
      if (history.state && history.state.scanner) {
        if (then) window.addEventListener('popstate', () => setTimeout(then, 0), { once: true });
        history.back();
      } else if (then) then();
    };
    const onPop = () => { if (!(history.state && history.state.scanner)) close(); };
    history.pushState({ scanner: true }, ''); window.addEventListener('popstate', onPop);
    el.querySelector('.scan-x').addEventListener('click', () => close());
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    const show = (r, code) => {
      result.hidden = false;
      result.className = `scan-result ${r.ok ? 'ok' : 'bad'}`;
      result.innerHTML = `<span>${esc(r.message || code)}</span>${r.actionLabel ? `<button type="button" class="btn btn-sm">${esc(r.actionLabel)}</button>` : ''}`;
      if (r.actionLabel) result.querySelector('button').addEventListener('click', () => close(() => r.action?.()));
      if (continuous) el.querySelector('.scan-count').textContent = count ? `(${count})` : '';
    };
    const handle = async (code) => {
      paused = true;
      let r;
      try { r = (await onCode(code)) || { ok: true }; } catch (e) { r = { ok: false, message: e.message }; }
      beep(r.ok !== false);
      if (r.ok !== false) count++;
      show(r, code);
      if (!continuous && r.ok !== false) { setTimeout(() => close(), 250); return; }
      setTimeout(() => { paused = false; }, r.ok === false ? 1200 : 500);
    };

    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'done') close();
      if (act === 'manual') { const f = el.querySelector('.scan-manual'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); }
      if (act === 'torch') {
        const track = stream?.getVideoTracks()[0]; const on = !e.target.classList.contains('on');
        track?.applyConstraints({ advanced: [{ torch: on }] }).then(() => e.target.classList.toggle('on', on)).catch(() => {});
      }
    });
    el.querySelector('.scan-manual').addEventListener('submit', (e) => {
      e.preventDefault(); const i = e.target.querySelector('input'); const v = i.value.trim();
      if (v) { i.value = ''; handle(v); }
    });

    (async () => {
      if (!supported() || !window.isSecureContext) { status.textContent = 'La caméra n’est pas disponible ici : saisissez le code.'; el.querySelector('.scan-manual').hidden = false; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (e) {
        status.textContent = e.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorisez la caméra pour Comptoir dans les réglages du navigateur, ou saisissez le code.'
          : e.name === 'NotFoundError' ? 'Aucune caméra trouvée sur cet appareil : saisissez le code.' : 'La caméra ne répond pas : saisissez le code.';
        el.querySelector('.scan-manual').hidden = false; return;
      }
      if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream; await video.play().catch(() => {});
      const caps = stream.getVideoTracks()[0]?.getCapabilities?.() || {};
      if (caps.torch) el.querySelector('[data-act="torch"]').hidden = false;
      let det;
      try { status.textContent = hint || 'Placez le code-barres dans le cadre'; det = await detector(); }
      catch { status.textContent = 'Le lecteur n’a pas pu se charger : saisissez le code.'; el.querySelector('.scan-manual').hidden = false; return; }
      const tick = async () => {
        if (closed) return;
        if (!paused && video.readyState >= 2) {
          try {
            const found = await det.detect(video);
            const code = found && found[0] && String(found[0].rawValue || '').trim();
            // Même code juste après : ignoré (évite de compter deux fois le même article par erreur).
            if (code && !(code === last.code && Date.now() - last.at < 1800)) { last = { code, at: Date.now() }; await handle(code); }
          } catch { /* image illisible : on continue */ }
        }
        timer = setTimeout(tick, 120);
      };
      tick();
    })();
    return { close };
  }

  // Codes équivalents : EAN-13 commençant par 0 = UPC-A ; on compare aussi sans zéros de tête.
  function sameCode(a, b) {
    if (!a || !b) return false;
    a = String(a).trim().toLowerCase(); b = String(b).trim().toLowerCase();
    if (a === b) return true;
    const na = a.replace(/^0+/, ''), nb = b.replace(/^0+/, '');
    return /^\d+$/.test(a) && /^\d+$/.test(b) && na === nb && na.length >= 6;
  }

  window.ComptoirScanner = { open, supported, sameCode, preload: () => detector().catch(() => {}) };
})();
