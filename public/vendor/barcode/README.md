# Lecture des codes-barres (scanner caméra)

- `barcode-detector.js` : [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.2, version IIFE « ponyfill » (licence MIT). Expose `window.BarcodeDetectionAPI.BarcodeDetector` et `prepareZXingModule`, sans modifier `window.BarcodeDetector`.
- `zxing_reader.wasm` : moteur de lecture [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.3 (licence MIT, fondé sur zxing-cpp, Apache-2.0).

Servis depuis Comptoir (et gardés par le service worker) : le scan fonctionne hors ligne, sans serveur externe.
Utilisés seulement quand le navigateur n'a pas de lecteur natif (iPhone, Firefox). Chargés à l'ouverture du scanner (`public/app/scanner.js`).

Mise à jour : `npm install barcode-detector@<version>` dans un dossier temporaire (version publiée depuis plus de 2 semaines), puis copier `dist/iife/ponyfill.js` et `zxing-wasm/dist/reader/zxing_reader.wasm` (même version que la dépendance de barcode-detector).
