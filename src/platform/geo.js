// Pays du visiteur, quel que soit l'hébergeur : chacun le transmet à sa façon.
const HEADERS = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-vercel-ip-country', 'x-appengine-country', 'x-country-code', 'x-geo-country'];
export function requestCountry(request) {
  const cf = request.cf && request.cf.country;
  if (cf) return String(cf).toUpperCase();
  for (const h of HEADERS) { const v = request.headers.get(h); if (v && /^[A-Za-z]{2}$/.test(v)) return v.toUpperCase(); }
  return null;
}
