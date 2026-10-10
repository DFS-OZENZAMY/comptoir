// Référencement naturel : pages publiques rendues côté serveur (contenu lisible par Google sans JavaScript),
// données structurées schema.org, pages métier, plan du site et robots.txt.
import { r2, escHtml as e } from './lib.js';
import { init, bump } from './db.js';
import { PLATFORM, PLANS, PAID_PLANS, COUNTRIES, waNumber, pricing } from './catalog.js';
import { getSettings, imageUrl } from './store.js';

const ISO = { FR: 'EUR', BE: 'EUR', LU: 'EUR', CH: 'CHF', MA: 'MAD', DZ: 'DZD', TN: 'TND', SN: 'XOF', CI: 'XOF', CM: 'XAF', CA: 'CAD', XX: 'EUR' };
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const html = (body, status = 200, cache = 'public, max-age=300') => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache } });
// Pays du visiteur : choix explicite (?pays=MA, mémorisé), sinon détection Cloudflare, sinon France.
export function visitorCountry(request, url) {
  const asked = (url.searchParams.get('pays') || '').toUpperCase();
  if (COUNTRIES[asked]) return { country: asked, set: true };
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)cp_pays=([A-Z]{2})/);
  if (m && COUNTRIES[m[1]]) return { country: m[1], set: false };
  const cf = request.cf?.country;
  if (cf && COUNTRIES[cf]) return { country: cf, set: false };
  return { country: cf ? 'XX' : 'FR', set: false };
}
const countryCookie = (c) => `cp_pays=${c}; Path=/; Max-Age=31536000; SameSite=Lax`;
const fmt = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function headTags({ origin, path, title, description, image, type = 'website', noindex = false }) {
  const url = origin + path;
  const img = image && image.startsWith('http') ? image : origin + (image || '/assets/og-image.png');
  return `
  <link rel="canonical" href="${e(url)}">
  ${noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${e(PLATFORM.name)}">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${e(url)}">
  <meta property="og:image" content="${e(img)}">
  <meta property="og:image:alt" content="${e(title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${e(title)}">
  <meta name="twitter:description" content="${e(description)}">
  <meta name="twitter:image" content="${e(img)}">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">`;
}

/* ------------------------------------------------------------------ */
/* Pages métier                                                        */
/* ------------------------------------------------------------------ */

export const METIERS = {
  quincaillerie: {
    type: 'quincaillerie', name: 'quincaillerie', label: 'Quincaillerie et bricolage',
    title: 'Logiciel de caisse pour quincaillerie : stock, devis et vitrine',
    h1: 'Le logiciel de caisse pensé pour les quincailleries',
    lead: 'Des milliers de références, des clients artisans qui veulent un devis et des particuliers pressés : Comptoir réunit la caisse, le stock, les devis et factures et une vitrine en ligne dans un seul outil simple.',
    benefits: [
      ['Vente au mètre, au kilo ou à la boîte', 'Câble au mètre, visserie à la boîte, chevilles au sachet : chaque produit a son unité de vente, et le prix se calcule tout seul en caisse.'],
      ['Codes-barres et recherche rapide', 'Scannez avec une douchette USB ou tapez une référence : le produit arrive dans le ticket en une seconde, même parmi des milliers d’articles.'],
      ['Devis et factures pour les artisans', 'Préparez un devis au comptoir, transformez-le en facture en un clic et suivez les paiements des professionnels, y compris les ventes à crédit.'],
      ['Alertes de rupture', 'Les références sous leur seuil remontent chaque matin avec la quantité conseillée à recommander, et une liste à imprimer pour le fournisseur.'],
    ],
    faq: [
      ['Puis-je vendre du câble ou de la chaîne au mètre ?', 'Oui. Choisissez l’unité « mètre » sur la fiche produit : la quantité peut être décimale (2,5 m) et le stock se met à jour en conséquence.'],
      ['Mes clients artisans peuvent-ils payer en fin de mois ?', 'Oui, avec la vente à crédit : la facture est créée avec une échéance, l’acompte éventuel est enregistré et les retards de paiement apparaissent dans vos alertes.'],
      ['Comment importer mes références ?', 'Ajoutez vos produits depuis l’espace commerçant, avec photo, référence et code-barres. Les produits les plus vendus peuvent être saisis en premier, le reste au fil des ventes.'],
    ],
  },
  epicerie: {
    type: 'alimentation', name: 'épicerie', label: 'Épicerie et alimentation',
    title: 'Logiciel de caisse pour épicerie et supérette : simple et rapide',
    h1: 'Une caisse simple et rapide pour votre épicerie',
    lead: 'Les clients font la queue, les produits frais tournent vite et le stock change chaque jour : Comptoir vous fait encaisser en quelques secondes et suit votre stock sans effort.',
    benefits: [
      ['Encaissement en quelques secondes', 'Tuiles produits, scan des codes-barres, espèces avec monnaie à rendre, carte ou paiement mobile : la file avance plus vite.'],
      ['Vente au kilo et à la pièce', 'Fruits et légumes au kilo, boissons au lot, épicerie à la pièce : chaque unité est gérée et le ticket reste clair pour le client.'],
      ['Commandes par téléphone', 'Un client appelle pour réserver ? Mettez sa commande de côté et encaissez-la à son passage, le stock n’est déduit qu’une seule fois.'],
      ['Vitrine en ligne de vos rayons', 'Vos clients consultent les produits disponibles et les prix sur votre vitrine, puis vous appellent avec la bonne référence.'],
    ],
    faq: [
      ['Comptoir fonctionne-t-il sur téléphone ?', 'Oui. La caisse est conçue pour le téléphone comme pour l’ordinateur : une barre fixe affiche le total et le bouton Encaisser.'],
      ['Puis-je suivre ce que j’encaisse chaque jour ?', 'Le journal de caisse donne le total par mode de paiement (espèces, carte, paiement mobile), le nombre de tickets et le panier moyen, avec une version imprimable.'],
      ['Dans quels pays puis-je l’utiliser ?', 'En France, en Belgique, en Suisse, au Maroc, en Algérie, en Tunisie, au Sénégal, en Côte d’Ivoire, au Cameroun et au Québec : devise et TVA sont réglées selon votre pays.'],
    ],
  },
  'boutique-mode': {
    type: 'mode', name: 'boutique de mode', label: 'Mode et accessoires',
    title: 'Logiciel de caisse pour boutique de vêtements et accessoires',
    h1: 'La caisse et la vitrine en ligne de votre boutique de mode',
    lead: 'Nouvelles collections, clientes fidèles et ventes en boutique : Comptoir vous aide à vendre, à suivre votre stock pièce par pièce et à montrer vos nouveautés en ligne.',
    benefits: [
      ['Une vitrine à vos couleurs', 'Présentez vos pièces avec photo, prix et disponibilité sur une vitrine en ligne à votre image, à partager sur Instagram et WhatsApp.'],
      ['Fichier clientes', 'Retrouvez l’historique d’achat de chaque cliente, ses coordonnées et ses commandes mises de côté.'],
      ['Remises en caisse', 'Appliquez une remise sur le ticket en un geste pendant les soldes ou pour une cliente fidèle, avec une TVA toujours juste.'],
      ['Stock par pièce', 'Chaque vente déduit le stock ; les pièces bientôt épuisées remontent dans vos alertes pour réassortir à temps.'],
    ],
    faq: [
      ['Puis-je mettre un article de côté pour une cliente ?', 'Oui : mettez la commande de côté depuis la caisse avec le nom de la cliente, puis encaissez-la quand elle passe en boutique.'],
      ['Mes employés peuvent-ils tenir la caisse ?', 'Oui. Chaque employé a son propre accès à la caisse et aux produits ; les réglages et l’abonnement restent réservés au propriétaire.'],
      ['Comment partager ma vitrine ?', 'Chaque boutique a son adresse en ligne. Un bouton « Partager ma vitrine » copie le lien pour vos réseaux sociaux et vos messages.'],
    ],
  },
  'beaute-parfumerie': {
    type: 'beaute', name: 'boutique beauté', label: 'Beauté et parfumerie',
    title: 'Logiciel de caisse pour parfumerie, cosmétiques et institut',
    h1: 'Gérez votre boutique de beauté sans tableur',
    lead: 'Soins, maquillage, parfums et prestations : Comptoir gère la caisse, le stock de vos produits, les prestations sans stock et une vitrine en ligne élégante.',
    benefits: [
      ['Produits et prestations', 'Vendez des produits suivis en stock et des prestations sans stock (soin, maquillage) dans le même ticket.'],
      ['Vitrine élégante', 'Vos clientes découvrent les marques et produits disponibles, avec les prix, avant de passer en boutique.'],
      ['Alertes de réassort', 'Les références les plus demandées ne manquent plus : les ruptures et stocks bas apparaissent chaque matin.'],
      ['Meilleures ventes', 'Voyez en un coup d’œil ce qui se vend le mieux sur les 30 derniers jours pour mieux commander.'],
    ],
    faq: [
      ['Puis-je vendre une prestation sans stock ?', 'Oui : décochez « Suivre le stock » sur la fiche. La prestation s’encaisse normalement, sans toucher au stock.'],
      ['Puis-je imprimer un ticket de caisse ?', 'Oui, au format 80 mm pour les imprimantes de tickets, ou en A4 pour une facture.'],
      ['Mes données sont-elles protégées ?', 'Chaque commerce dispose de son espace, séparé des autres, avec des accès personnels pour chaque membre de l’équipe.'],
    ],
  },
  telephonie: {
    type: 'electronique', name: 'boutique de téléphonie', label: 'Téléphonie et électronique',
    title: 'Logiciel de caisse pour boutique de téléphonie et réparation',
    h1: 'La caisse des boutiques de téléphonie et de réparation',
    lead: 'Accessoires, smartphones et réparations : Comptoir encaisse produits et prestations, suit les stocks par référence et publie votre catalogue en ligne.',
    benefits: [
      ['Réparations sans stock', 'Enregistrez les remplacements d’écran ou de batterie comme des prestations, à côté des pièces et accessoires suivis en stock.'],
      ['Codes-barres', 'Scannez les accessoires à la caisse et retrouvez chaque référence instantanément.'],
      ['Devis de réparation', 'Établissez un devis, faites-le accepter puis transformez-le en facture une fois la réparation terminée.'],
      ['Disponibilité en ligne', 'Vos clients vérifient sur votre vitrine si le modèle ou l’accessoire est en stock avant de se déplacer.'],
    ],
    faq: [
      ['Puis-je faire un devis de réparation ?', 'Oui : créez un devis avec les pièces et la main-d’œuvre, puis transformez-le en commande ou en facture en un clic.'],
      ['Le paiement mobile est-il prévu ?', 'Oui. En caisse, choisissez espèces, carte, chèque, virement ou paiement mobile, ou combinez plusieurs modes.'],
      ['Puis-je suivre les impayés de mes clients professionnels ?', 'Les factures en retard apparaissent dans vos alertes avec un bouton pour relancer le client.'],
    ],
  },
  'librairie-papeterie': {
    type: 'librairie', name: 'librairie', label: 'Librairie et papeterie',
    title: 'Logiciel de caisse pour librairie et papeterie',
    h1: 'Une caisse claire pour votre librairie-papeterie',
    lead: 'Rentrée scolaire, fournitures de bureau et livres : Comptoir vous fait encaisser vite pendant les pics et garde un œil sur votre stock de références.',
    benefits: [
      ['Pics de la rentrée', 'Tuiles produits, scan et paiement rapide : la caisse reste fluide quand les listes scolaires s’enchaînent.'],
      ['Ventes aux écoles et entreprises', 'Devis et factures pour les commandes groupées, avec paiements partiels et relances.'],
      ['Stock des fournitures', 'Cahiers, ramettes, stylos : les ruptures et stocks bas remontent avant la rentrée.'],
      ['Catalogue en ligne', 'Les parents consultent les fournitures disponibles sur votre vitrine et vous appellent pour réserver.'],
    ],
    faq: [
      ['Puis-je préparer la commande d’une école ?', 'Oui : créez un devis, faites-le valider, puis transformez-le en facture avec une échéance de paiement.'],
      ['Comment préparer la rentrée ?', 'La liste « à commander » des alertes calcule les quantités à recommander pour chaque référence sous son seuil.'],
      ['Puis-je vendre des lots ?', 'Oui, chaque produit a son unité de vente : pièce, lot, ramette…'],
    ],
  },
  'decoration-maison': {
    type: 'maison', name: 'boutique de décoration', label: 'Maison et décoration',
    title: 'Logiciel de caisse pour boutique de décoration et maison',
    h1: 'Votre boutique de décoration, en caisse et en ligne',
    lead: 'Objets choisis, petites séries et clients qui reviennent : Comptoir gère votre caisse, votre stock et une vitrine en ligne qui met vos pièces en valeur.',
    benefits: [
      ['Vitrine avec photos', 'Chaque produit a sa photo, son prix et sa disponibilité sur votre vitrine en ligne.'],
      ['Petites séries', 'Le stock pièce par pièce vous dit ce qu’il reste et ce qui est bientôt épuisé.'],
      ['Commandes et réservations', 'Mettez de côté une pièce pour un client et encaissez-la à son passage.'],
      ['Factures pour les professionnels', 'Décorateurs et architectes reçoivent une facture en bonne et due forme, avec suivi des paiements.'],
    ],
    faq: [
      ['Puis-je personnaliser la couleur de ma vitrine ?', 'Oui : choisissez la couleur de votre boutique dans Réglages, la vitrine s’adapte automatiquement.'],
      ['Puis-je masquer les prix sur la vitrine ?', 'Oui, vous pouvez afficher ou masquer les prix et la disponibilité.'],
      ['Faut-il installer quelque chose ?', 'Non. Comptoir fonctionne dans le navigateur, sur ordinateur, tablette ou téléphone.'],
    ],
  },
};

const NAV = `<header class="nav">
    <a class="logo" href="/">Comptoir</a>
    <nav aria-label="Navigation">
      <a href="/#fonctions" class="nav-link">Fonctions</a>
      <a href="/logiciel-de-caisse/" class="nav-link">Métiers</a>
      <a href="/#tarifs" class="nav-link">Tarifs</a>
      <a href="/aide" class="nav-link">Aide</a>
      <a href="/app/" class="btn btn-ghost nav-login">Se connecter</a>
      <a href="/app/#/inscription" class="btn btn-primary">Essai gratuit</a>
    </nav>
  </header>`;
const LEGAL_LINKS = '<a href="/mentions-legales">Mentions légales</a><a href="/cgu">CGU</a><a href="/cgv">CGV</a><a href="/confidentialite">Confidentialité</a>';
const footerLinks = () => Object.entries(METIERS).map(([slug, m]) => `<a href="/logiciel-de-caisse/${slug}">Caisse ${e(m.name)}</a>`).join('');
const FOOTER = () => `<footer class="footer">
    <div class="wrap footer-cols">
      <div><span class="logo logo-light">Comptoir</span><p>La caisse, le stock, les factures et la vitrine en ligne des commerces de proximité.</p></div>
      <nav aria-label="Logiciel de caisse par métier"><strong>Par métier</strong>${footerLinks()}</nav>
      <nav aria-label="Comptoir"><strong>Comptoir</strong><a href="/#fonctions">Fonctions</a><a href="/#tarifs">Tarifs</a><a href="/app/#/inscription">Essai gratuit</a><a href="/aide">Centre d’aide</a><a href="/app/">Espace commerçant</a></nav>
    </div>
    <div class="wrap footer-in"><span>© ${new Date().getFullYear()} Comptoir</span><span class="footer-legal">${LEGAL_LINKS}</span></div>
  </footer>`;
const docHead = (title, description, extra) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(title)}</title>
  <meta name="description" content="${e(description)}">
  <meta name="theme-color" content="#17181C">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/archivo-narrow.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/fonts.css">
  <link rel="stylesheet" href="/assets/site.css">${extra}
</head>`;

const offersLd = (pr = pricing('FR')) => ({
  '@type': 'AggregateOffer', priceCurrency: pr.currency,
  lowPrice: Math.min(...PAID_PLANS.map((k) => pr.price(k))), highPrice: Math.max(...PAID_PLANS.map((k) => pr.price(k))), offerCount: PAID_PLANS.length,
});
const softwareLd = (origin, name, description, pr) => ({
  '@context': 'https://schema.org', '@type': 'SoftwareApplication', name, description, url: origin + '/',
  applicationCategory: 'BusinessApplication', applicationSubCategory: 'Logiciel de caisse', operatingSystem: 'Web, Android, iOS, Windows, macOS',
  inLanguage: 'fr', offers: offersLd(pr),
});
const faqLd = (faq) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });

export function renderMetier(origin, slug, country = 'FR') {
  const m = METIERS[slug];
  const pr = pricing(country);
  if (!m) return null;
  const path = `/logiciel-de-caisse/${slug}`;
  const description = clip(m.lead, 158);
  const others = Object.entries(METIERS).filter(([s]) => s !== slug);
  const ld = [
    softwareLd(origin, `Comptoir, logiciel de caisse pour ${m.name}`, description, pr),
    faqLd(m.faq),
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Comptoir', item: origin + '/' },
      { '@type': 'ListItem', position: 2, name: 'Logiciel de caisse', item: origin + '/logiciel-de-caisse/' },
      { '@type': 'ListItem', position: 3, name: m.label, item: origin + path },
    ] },
  ];
  return `${docHead(`${m.title} | Comptoir`, description, headTags({ origin, path, title: m.title, description }) + ld.map(jsonLd).join(''))}
<body>
  ${NAV}
  <main>
    <nav class="breadcrumb wrap" aria-label="Fil d’Ariane"><a href="/">Comptoir</a><span aria-hidden="true">/</span><a href="/logiciel-de-caisse/">Logiciel de caisse</a><span aria-hidden="true">/</span><span aria-current="page">${e(m.label)}</span></nav>
    <section class="hero hero-metier">
      <div class="hero-copy">
        <h1>${e(m.h1)}</h1>
        <p class="lead">${e(m.lead)}</p>
        <div class="hero-cta"><a class="btn btn-primary btn-lg" href="/app/#/inscription">Essayer gratuitement</a><span class="muted">14 jours gratuits, sans carte bancaire</span></div>
      </div>
    </section>
    <section class="band" id="fonctions">
      <div class="wrap">
        <h2>Ce que Comptoir fait pour votre ${e(m.name)}</h2>
        <div class="features features-2">${m.benefits.map(([t, d]) => `<article><h3>${e(t)}</h3><p>${e(d)}</p></article>`).join('')}</div>
      </div>
    </section>
    <section class="steps wrap">
      <h2>Prêt en trois étapes</h2>
      <ol>
        <li><span class="step-n">1</span><h3>Créez votre commerce</h3><p>Choisissez « ${e(m.label)} » et votre pays : catégories, unités de vente, devise et TVA sont prêtes.</p></li>
        <li><span class="step-n">2</span><h3>Ajoutez vos produits</h3><p>Un nom, un prix TTC, une quantité. Ou scannez directement les codes-barres.</p></li>
        <li><span class="step-n">3</span><h3>Vendez et partagez</h3><p>Encaissez dès le premier jour et envoyez le lien de votre vitrine à vos clients.</p></li>
      </ol>
    </section>
    <section class="faq wrap">
      <h2>Questions fréquentes</h2>
      <details><summary>Combien coûte Comptoir ${pr.country === 'XX' ? '' : 'en ' + e(pr.country_name)} ?</summary><p>À partir de ${e(pr.format(pr.price('essentiel')))} HT par mois, sans engagement, après 14 jours d’essai gratuit. La formule Pro est à ${e(pr.format(pr.price('pro')))} HT par mois, la formule Business à ${e(pr.format(pr.price('business')))}.</p></details>
      ${m.faq.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}
    </section>
    <section class="related wrap">
      <h2>Comptoir pour d’autres commerces</h2>
      <ul class="related-list">${others.map(([s, o]) => `<li><a href="/logiciel-de-caisse/${s}">Logiciel de caisse pour ${e(o.name)}</a></li>`).join('')}</ul>
    </section>
    <section class="final"><div class="wrap final-in"><h2>Ouvrez votre comptoir en ligne aujourd’hui.</h2><a class="btn btn-dark btn-lg" href="/app/#/inscription">Commencer l’essai gratuit</a></div></section>
  </main>
  ${FOOTER()}
</body>
</html>`;
}

export function renderHub(origin) {
  const title = 'Logiciel de caisse pour commerces de proximité, par métier';
  const description = 'Quincaillerie, épicerie, boutique de mode, beauté, téléphonie, librairie, décoration : un logiciel de caisse, de stock et de facturation adapté à votre métier.';
  const path = '/logiciel-de-caisse/';
  const ld = [{ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: Object.entries(METIERS).map(([s, m], i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/logiciel-de-caisse/${s}`, name: m.title })) }];
  return `${docHead(`${title} | Comptoir`, description, headTags({ origin, path, title, description }) + ld.map(jsonLd).join(''))}
<body>
  ${NAV}
  <main>
    <nav class="breadcrumb wrap" aria-label="Fil d’Ariane"><a href="/">Comptoir</a><span aria-hidden="true">/</span><span aria-current="page">Logiciel de caisse</span></nav>
    <section class="hero hero-metier"><div class="hero-copy">
      <h1>Un logiciel de caisse adapté à votre métier</h1>
      <p class="lead">${e(description)}</p>
    </div></section>
    <section class="steps wrap"><ol class="metier-grid">
      ${Object.entries(METIERS).map(([s, m]) => `<li><h2 class="metier-title"><a href="/logiciel-de-caisse/${s}">${e(m.label)}</a></h2><p>${e(clip(m.lead, 150))}</p><a class="metier-more" href="/logiciel-de-caisse/${s}">Voir la caisse ${e(m.name)}</a></li>`).join('')}
    </ol></section>
    <section class="final"><div class="wrap final-in"><h2>Ouvrez votre comptoir en ligne aujourd’hui.</h2><a class="btn btn-dark btn-lg" href="/app/#/inscription">Commencer l’essai gratuit</a></div></section>
  </main>
  ${FOOTER()}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Page d'accueil : balises, données structurées, tarifs et métiers    */
/* ------------------------------------------------------------------ */

const LANDING_FAQ = [
  ['Ai-je besoin de matériel particulier ?', 'Non. Comptoir fonctionne dans un navigateur, sur ordinateur, tablette ou téléphone. Une douchette code-barres USB et une imprimante de tickets 80 mm se branchent sans réglage si vous le souhaitez.'],
  ['Mes clients peuvent-ils commander en ligne ?', 'La vitrine présente votre catalogue, vos prix et la disponibilité. Vos clients vous appellent ou passent en boutique ; vous mettez la commande de côté en un clic.'],
  ['Mes données sont-elles séparées de celles des autres commerces ?', 'Oui. Chaque commerce dispose de son propre espace, inaccessible aux autres. Vos employés ont des accès limités.'],
  ['Que se passe-t-il à la fin de l’essai ?', 'Vous choisissez une formule depuis votre espace. Sans abonnement, vos données restent consultables mais l’encaissement est suspendu.'],
];
const FEATURES = { essentiel: ['Caisse et stock', 'Vitrine en ligne'], pro: ['Devis et factures', 'Alertes par e-mail'], business: ['Toutes les fonctions', 'Accompagnement prioritaire'] };

export async function renderLanding(env, request, url) {
  const res = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  if (!res.ok) return res;
  const origin = url.origin;
  const vc = visitorCountry(request, url);
  const pr = pricing(vc.country);
  const title = 'Comptoir : caisse, stock, factures et vitrine en ligne pour les commerces';
  const description = 'Logiciel de caisse en ligne pour commerces de proximité : encaissement, stock, devis et factures, alertes et vitrine en ligne. Essai gratuit de 14 jours.';
  const ld = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Comptoir', url: origin + '/', logo: origin + '/assets/icon-512.png' },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Comptoir', url: origin + '/', inLanguage: 'fr' },
    softwareLd(origin, 'Comptoir', description, pr),
    faqLd(LANDING_FAQ),
  ];
  const plans = PAID_PLANS.map((k) => ({ key: k, ...PLANS[k] }));
  const plansHtml = plans.map((pl) => `
        <article class="plan ${pl.key === 'pro' ? 'featured is-shown' : ''}" data-plan="${pl.key}">
          <div class="plan-top"><h3>${e(pl.name)}</h3>${pl.key === 'pro' ? '<span class="plan-tag">Le plus choisi</span>' : ''}</div>
          <p class="price ${pr.format(pr.price(pl.key)).length > 8 ? 'price-long' : ''}"><strong>${e(pr.format(pr.price(pl.key)))}</strong><span>HT / mois</span></p>
          <p class="plan-desc">${e(pl.description)}</p>
          <ul><li>${pl.products === null ? 'Produits illimités' : new Intl.NumberFormat('fr-FR').format(pl.products) + ' produits'}</li><li>${pl.users} utilisateur${pl.users > 1 ? 's' : ''}</li>${(FEATURES[pl.key] || []).map((f) => `<li>${e(f)}</li>`).join('')}</ul>
          <a class="btn ${pl.key === 'pro' ? 'btn-primary' : 'btn-secondary'} btn-lg btn-block" href="/app/#/inscription">Essayer gratuitement</a>
        </article>`).join('');
  const tabsHtml = plans.map((pl) => `<button type="button" role="tab" data-tab="${pl.key}" aria-selected="${pl.key === 'pro'}">${e(pl.name)}</button>`).join('');
  // Sélecteur de pays : les tarifs s'affichent dans la devise choisie.
  const countryHtml = `<label for="paysTarifs">Tarifs pour</label><select id="paysTarifs" name="pays">${Object.entries(COUNTRIES).filter(([k]) => k !== 'XX').map(([k, c]) => `<option value="${k}" ${k === pr.country ? 'selected' : ''}>${e(c.name)} (${e(pricing(k).symbol)})</option>`).join('')}${pr.country === 'XX' ? '<option value="XX" selected>Autre pays (€)</option>' : ''}</select><noscript><button type="submit" class="btn btn-secondary">Afficher</button></noscript>`;
  const tradesHtml = Object.entries(METIERS).map(([s, m]) => `<li><a href="/logiciel-de-caisse/${s}">${e(m.label.split(' et ')[0])}</a></li>`).join('');
  const body = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', description); } })
    .on('head', { element(el) { el.append(headTags({ origin, path: '/', title, description }) + ld.map(jsonLd).join(''), { html: true }); } })
    .on('#plans', { element(el) { el.setInnerContent(plansHtml, { html: true }); } })
    .on('#planTabs', { element(el) { el.setInnerContent(tabsHtml, { html: true }); } })
    .on('#trades', { element(el) { el.setInnerContent(tradesHtml, { html: true }); } })
    .on('#footerMetiers', { element(el) { el.setInnerContent(`<strong>Par métier</strong>${footerLinks()}`, { html: true }); } })
    .on('#pricingCountry', { element(el) { el.setInnerContent(countryHtml, { html: true }); } })
    .on('#footerLegal', { element(el) { el.setInnerContent(LEGAL_LINKS, { html: true }); } })
    .transform(res);
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-cache', vary: 'Cookie' };
  if (vc.set) headers['set-cookie'] = countryCookie(vc.country);
  return new Response(body.body, { status: 200, headers });
}

/* ------------------------------------------------------------------ */
/* Vitrine d'un commerce, rendue côté serveur                          */
/* ------------------------------------------------------------------ */

export async function loadCatalog(db, slug) {
  const store = await db.prepare('SELECT id, name, slug, status, business_type, country FROM stores WHERE slug = ?').bind(slug).first();
  if (!store || store.status !== 'active') return null;
  const s = await getSettings(db, store.id, store);
  if (s.catalog_public === '0') return null;
  const settings = {};
  for (const k of ['shop_name', 'tagline', 'address', 'phone', 'email', 'hours', 'currency', 'accent', 'show_prices', 'show_stock']) settings[k] = s[k];
  // Commande WhatsApp : numéro au format international, seulement si le commerçant l'a activée.
  const wa = waNumber(s.whatsapp || (s.whatsapp_orders === '1' ? '' : ''), store.country);
  settings.whatsapp = s.whatsapp_orders !== '0' && wa ? wa : '';
  if (s.loyalty_enabled === '1') settings.loyalty = { earn: Number(s.loyalty_earn) || 1, threshold: Number(s.loyalty_threshold) || 100, reward: Number(s.loyalty_reward) || 0 };
  const categories = (await db.prepare('SELECT id, name FROM categories WHERE store_id = ? ORDER BY position, name').bind(store.id).all()).results;
  const rows = (await db.prepare(`SELECT id, ref, name, description, category_id, price_ht, tva_rate, stock, stock_min, unit, image_v, track_stock
    FROM products WHERE store_id = ? AND visible = 1 ORDER BY name COLLATE NOCASE`).bind(store.id).all()).results;
  const showPrices = s.show_prices !== '0', showStock = s.show_stock !== '0';
  const products = rows.map((p) => ({
    id: p.id, ref: p.ref, name: p.name, description: p.description, category_id: p.category_id, unit: p.unit, image: imageUrl(p),
    price_ttc: showPrices ? r2(p.price_ht * (1 + p.tva_rate / 100)) : null,
    availability: !showStock ? null : !p.track_stock ? 'in' : p.stock <= 0 ? 'out' : p.stock <= p.stock_min ? 'low' : 'in',
  }));
  return { store: { id: store.id, name: store.name, slug: store.slug, country: store.country }, settings, categories, products };
}

const AVAIL = { in: 'En stock', low: 'Stock limité', out: 'Sur commande' };
const SCHEMA_AVAIL = { in: 'https://schema.org/InStock', low: 'https://schema.org/LimitedAvailability', out: 'https://schema.org/BackOrder' };
const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const cardHtml = (p, currency, wa = false) => {
  const ini = e(norm(p.name).replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase());
  const media = p.image ? `<img src="${e(p.image)}" alt="${e(p.name)}" loading="lazy" decoding="async" width="300" height="225">` : `<span class="placeholder" aria-hidden="true">${ini}</span>`;
  return `
      <article class="card">
        <button class="card-open" type="button" data-open="${p.id}" aria-label="${e(p.name)}, voir le détail">
          <div class="card-media">${media}</div>
          <div class="card-body">
            <span class="card-ref">${e(p.ref)}</span>
            <h3 class="card-name">${e(p.name)}</h3>
            ${p.availability ? `<span class="avail ${p.availability}">${AVAIL[p.availability]}</span>` : ''}
          </div>
          ${p.price_ttc !== null ? `<div class="card-foot"><span class="price">${fmt(p.price_ttc)} ${e(currency)} <small>/ ${e(p.unit)}</small></span></div>` : ''}
        </button>
        ${wa ? `<button class="card-add" type="button" data-inc="${p.id}">Ajouter</button>` : ''}
      </article>`;
};

export async function renderVitrine(env, request, url, slug) {
  const db = env.DB;
  await init(db);
  const data = await loadCatalog(db, slug);
  const res = await env.ASSETS.fetch(new Request(new URL('/store/', url), request));
  const origin = url.origin, path = `/s/${slug}`;
  if (!data) {
    const body = new HTMLRewriter()
      .on('title', { element(el) { el.setInnerContent('Commerce introuvable | Comptoir'); } })
      .on('head', { element(el) { el.append('<meta name="robots" content="noindex"><script>window.__STORE__ = null;</script>', { html: true }); } })
      .transform(res);
    return new Response(body.body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  await bump(db, data.store.id, 'catalog_views');
  delete data.store.id;
  const s = data.settings, name = s.shop_name || data.store.name;
  const currency = s.currency || '€', iso = ISO[data.store.country] || 'EUR';
  const country = (COUNTRIES[data.store.country] || COUNTRIES.XX).name;
  const title = `${name} : catalogue et disponibilité des produits`;
  const description = clip(s.tagline ? `${s.tagline}${s.phone ? ' Tél. ' + s.phone : ''}` : `Découvrez les produits de ${name}, leurs prix et leur disponibilité. ${s.address || ''}`, 158);
  const firstImage = data.products.find((p) => p.image)?.image;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Store', name, url: origin + path, description: s.tagline || undefined,
    telephone: s.phone || undefined, email: s.email || undefined, image: firstImage ? origin + firstImage : origin + '/assets/og-image.png',
    address: s.address ? { '@type': 'PostalAddress', streetAddress: s.address, addressCountry: data.store.country !== 'XX' ? data.store.country : undefined } : undefined,
    currenciesAccepted: iso, areaServed: country,
    hasOfferCatalog: { '@type': 'OfferCatalog', name: `Catalogue ${name}`, itemListElement: data.products.slice(0, 100).map((p) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Product', name: p.name, sku: p.ref || undefined, description: p.description || undefined, image: p.image ? origin + p.image : undefined },
      ...(p.price_ttc !== null ? { price: p.price_ttc.toFixed(2), priceCurrency: iso } : {}),
      ...(p.availability ? { availability: SCHEMA_AVAIL[p.availability] } : {}),
    })) },
  };
  const counts = {}; data.products.forEach((p) => { counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
  const catsHtml = [`<button class="cat" type="button" data-cat="all" aria-pressed="true">Tous les produits<span class="n">${data.products.length}</span></button>`,
    ...data.categories.filter((c) => counts[c.id]).map((c) => `<button class="cat" type="button" data-cat="${c.id}" aria-pressed="false">${e(c.name)}<span class="n">${counts[c.id]}</span></button>`)].join('');
  const gridHtml = data.products.length ? data.products.map((p) => cardHtml(p, currency, !!s.whatsapp)).join('') : '<div class="empty"><strong>Le catalogue est en cours de préparation.</strong>Revenez bientôt ou contactez-nous.</div>';
  const words = name.split(' ');
  const h1 = words.length > 1 ? `${e(words.slice(0, -1).join(' '))}<br>${e(words.at(-1))}` : e(name);
  const inline = `<script>window.__STORE__ = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>`;
  const setText = (key) => ({ element(el) { if (s[key]) el.setInnerContent(s[key]); } });
  const body = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', description); } })
    .on('meta[name="theme-color"]', { element(el) { if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) el.setAttribute('content', s.accent); } })
    .on('head', { element(el) { el.append(headTags({ origin, path, title, description, image: firstImage, type: 'business.business' }) + jsonLd(ld) + inline, { html: true }); } })
    .on('#heroTitle', { element(el) { el.setInnerContent(h1, { html: true }); } })
    .on('.hero-lead', setText('tagline'))
    .on('#brandLink', { element(el) { el.setInnerContent(name); el.setAttribute('href', path); } })
    .on('#cats', { element(el) { el.setInnerContent(catsHtml, { html: true }); } })
    .on('#grid', { element(el) { el.setInnerContent(gridHtml, { html: true }); } })
    .on('#resultCount', { element(el) { el.setInnerContent(`${data.products.length} produit${data.products.length > 1 ? 's' : ''}`); } })
    .on('dd[data-setting="address"]', setText('address'))
    .on('dd[data-setting="hours"]', setText('hours'))
    .on('#vitrineLegal', { element(el) { el.setInnerContent('<a href="/mentions-legales">Mentions légales</a> · <a href="/confidentialite">Confidentialité</a>', { html: true }); } })
    .transform(res);
  return new Response(body.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}

/* ------------------------------------------------------------------ */
/* Plan du site et robots.txt                                          */
/* ------------------------------------------------------------------ */

const HELP_SLUGS = ['bien-demarrer', 'caisse', 'produits-et-stock', 'importer-ses-produits', 'devis-commandes-factures', 'clients-et-fidelite', 'vitrine-et-whatsapp', 'boutiques-et-rapports', 'equipe-et-droits', 'reglages-et-abonnement', 'questions-frequentes'];
export async function sitemap(env, url) {
  const db = env.DB;
  await init(db);
  const origin = url.origin;
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await db.prepare(`SELECT s.slug, MAX(p.updated_at) AS updated FROM stores s
      JOIN products p ON p.store_id = s.id AND p.visible = 1
      WHERE s.status = 'active' AND NOT EXISTS (SELECT 1 FROM settings st WHERE st.store_id = s.id AND st.key = 'catalog_public' AND st.value = '0')
      GROUP BY s.id ORDER BY s.id`).all()).results;
  const urls = [
    { loc: '/', priority: '1.0', changefreq: 'weekly', lastmod: today },
    { loc: '/logiciel-de-caisse/', priority: '0.8', changefreq: 'monthly', lastmod: today },
    ...Object.keys(METIERS).map((s) => ({ loc: `/logiciel-de-caisse/${s}`, priority: '0.8', changefreq: 'monthly', lastmod: today })),
    ...Object.keys(LEGAL_PAGES).map((k) => ({ loc: `/${k}`, priority: '0.3', changefreq: 'yearly', lastmod: today })),
    { loc: '/aide', priority: '0.6', changefreq: 'monthly', lastmod: today },
    ...HELP_SLUGS.map((s) => ({ loc: `/aide/${s}`, priority: '0.5', changefreq: 'monthly', lastmod: today })),
    ...rows.map((r) => ({ loc: `/s/${r.slug}`, priority: '0.6', changefreq: 'daily', lastmod: (r.updated || today).slice(0, 10) })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${e(origin + u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

export function robots(url) {
  return new Response(`User-agent: *
Allow: /
Allow: /api/images/
Disallow: /app/
Disallow: /console/
Disallow: /api/

Sitemap: ${url.origin}/sitemap.xml
`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}

export { html };

/* ------------------------------------------------------------------ */
/* Pages légales                                                       */
/* ------------------------------------------------------------------ */
// Les informations de l'éditeur viennent des variables d'environnement (Cloudflare → Settings → Variables).
// Tant qu'une information manque, elle s'affiche « à compléter » pour ne jamais publier de données inventées.
function legalInfo(env) {
  const v = (k, label) => (env[k] ? e(env[k]) : `<mark class="todo">[à compléter : ${label}]</mark>`);
  return {
    name: v('LEGAL_NAME', 'raison sociale'), form: v('LEGAL_FORM', 'forme juridique et capital'), address: v('LEGAL_ADDRESS', 'adresse du siège'),
    id: v('LEGAL_ID', 'immatriculation : RC, ICE, IF ou SIRET'), director: v('LEGAL_DIRECTOR', 'directeur de la publication'),
    email: env.LEGAL_EMAIL ? `<a href="mailto:${e(env.LEGAL_EMAIL)}">${e(env.LEGAL_EMAIL)}</a>` : v('LEGAL_EMAIL', 'e-mail de contact'),
    phone: v('LEGAL_PHONE', 'téléphone'), cndp: v('LEGAL_CNDP', 'numéro de déclaration ou d’autorisation CNDP'),
    court: v('LEGAL_COURT', 'tribunaux compétents, par exemple ceux de Casablanca'), law: v('LEGAL_LAW', 'droit applicable, par exemple le droit marocain'),
    complete: ['LEGAL_NAME', 'LEGAL_ADDRESS', 'LEGAL_ID', 'LEGAL_EMAIL'].every((k) => env[k]),
  };
}
const UPDATED = '10 octobre 2026';

export const LEGAL_PAGES = {
  'mentions-legales': { title: 'Mentions légales', body: (L) => `
    <h2>Éditeur</h2>
    <p>Le site Comptoir et le service associé sont édités par ${L.name}, ${L.form}, dont le siège est situé ${L.address}, immatriculée sous le numéro ${L.id}.</p>
    <p>Directeur de la publication : ${L.director}.<br>Contact : ${L.email}, ${L.phone}.</p>
    <h2>Hébergement</h2>
    <p>Le site, l’application et les données sont hébergés par Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis (cloudflare.com), sur son réseau mondial et sa base de données D1.</p>
    <h2>Propriété intellectuelle</h2>
    <p>La marque Comptoir, le site, le logiciel, les textes, le design et les éléments graphiques sont protégés. Toute reproduction ou réutilisation sans autorisation écrite est interdite.</p>
    <h2>Vitrines des commerçants</h2>
    <p>Chaque vitrine publiée à l’adresse <code>/s/…</code> présente le catalogue d’un commerçant indépendant. Les produits, prix, photos, disponibilités et informations de contact y sont publiés sous la seule responsabilité de ce commerçant, qui est aussi l’interlocuteur des clients pour toute commande. Pour signaler un contenu illicite, écrivez à ${L.email}.</p>
    <h2>Données personnelles</h2>
    <p>Voir la <a href="/confidentialite">politique de confidentialité</a>.</p>` },

  cgu: { title: 'Conditions générales d’utilisation', body: (L) => `
    <h2>1. Objet</h2>
    <p>Les présentes conditions encadrent l’utilisation du service Comptoir, édité par ${L.name} : logiciel en ligne de caisse, de gestion de stock, de devis et factures, et de vitrine en ligne destiné aux commerçants (« l’Utilisateur »). Créer un compte vaut acceptation des présentes conditions.</p>
    <h2>2. Compte et accès</h2>
    <p>L’Utilisateur fournit des informations exactes et garde ses identifiants confidentiels. Il est responsable des actions faites avec son compte et avec les accès qu’il crée pour son équipe, dont il fixe lui-même les rôles et permissions. En cas d’accès non autorisé, il doit prévenir ${L.email} sans délai.</p>
    <h2>3. Essai gratuit</h2>
    <p>Chaque nouveau commerce bénéficie de 14 jours d’essai gratuit, sans carte bancaire. À la fin de l’essai, sans abonnement, les données restent consultables mais l’encaissement et les modifications sont suspendus.</p>
    <h2>4. Utilisation du service</h2>
    <p>L’Utilisateur s’engage à utiliser le service conformément aux lois en vigueur et à ne pas publier sur sa vitrine de contenu illicite, trompeur ou portant atteinte aux droits de tiers. L’éditeur peut suspendre un compte en cas de manquement grave, après en avoir informé l’Utilisateur sauf urgence.</p>
    <h2>5. Obligations fiscales et comptables</h2>
    <p>Comptoir est un outil d’aide à la gestion. L’Utilisateur reste seul responsable du respect de ses obligations fiscales, comptables et sociales : facturation, déclarations de TVA, conservation des pièces, et le cas échéant utilisation d’un logiciel de caisse certifié lorsque la réglementation de son pays l’impose (en France, notamment, la certification NF525 ou une attestation de l’éditeur, que Comptoir ne délivre pas à ce jour).</p>
    <h2>6. Données de l’Utilisateur</h2>
    <p>Les produits, clients, ventes et documents saisis appartiennent à l’Utilisateur. Pour les données personnelles de ses propres clients, l’Utilisateur est responsable de traitement et l’éditeur agit comme sous-traitant, dans les conditions décrites dans la <a href="/confidentialite">politique de confidentialité</a>.</p>
    <h2>7. Disponibilité et responsabilité</h2>
    <p>L’éditeur met en œuvre des moyens raisonnables pour assurer la disponibilité et la sécurité du service, sans garantir une disponibilité ininterrompue. Sa responsabilité est limitée aux dommages directs et, en tout état de cause, au montant payé par l’Utilisateur au cours des douze derniers mois.</p>
    <h2>8. Modification</h2>
    <p>Ces conditions peuvent évoluer ; l’Utilisateur est informé de toute modification importante au moins 30 jours avant son entrée en vigueur.</p>
    <h2>9. Droit applicable</h2>
    <p>Les présentes conditions sont soumises au ${L.law}. À défaut d’accord amiable, tout litige relève des ${L.court}.</p>` },

  cgv: { title: 'Conditions générales de vente', body: (L) => `
    <h2>1. Formules</h2>
    <p>Comptoir est proposé sous forme d’abonnement mensuel (formules Essentiel, Pro et Business) dont le contenu et les limites (produits, utilisateurs, boutiques) sont présentés sur la <a href="/#tarifs">page des tarifs</a>.</p>
    <h2>2. Prix</h2>
    <p>Les prix sont indiqués hors taxes, dans la devise du pays du commerce (par exemple en dirhams au Maroc, en euros en France). Les taxes applicables dans le pays du client s’ajoutent au prix hors taxes. Les prix peuvent évoluer ; tout changement est annoncé au moins 30 jours à l’avance et ne s’applique qu’à la période suivante.</p>
    <h2>3. Souscription et paiement</h2>
    <p>L’Utilisateur choisit sa formule depuis son espace (Réglages, Abonnement). L’abonnement est activé après réception du paiement, selon les modalités communiquées lors de la demande. L’abonnement est payable d’avance, mois par mois.</p>
    <h2>4. Durée et résiliation</h2>
    <p>L’abonnement est sans engagement de durée. Il peut être résilié à tout moment depuis l’espace commerçant ou en écrivant à ${L.email} ; la résiliation prend effet à la fin du mois en cours, sans remboursement de la période entamée.</p>
    <h2>5. Fin du contrat</h2>
    <p>Après la fin de l’abonnement, l’Utilisateur peut consulter et exporter ses données pendant 90 jours. Passé ce délai, elles peuvent être supprimées, sous réserve des obligations légales de conservation.</p>
    <h2>6. Réclamations</h2>
    <p>Toute réclamation est à adresser à ${L.email}. Une réponse est apportée sous 7 jours ouvrés.</p>
    <h2>7. Droit applicable</h2>
    <p>Les présentes conditions sont soumises au ${L.law}. Tout litige relève des ${L.court}. Les <a href="/cgu">conditions générales d’utilisation</a> s’appliquent également.</p>` },

  confidentialite: { title: 'Politique de confidentialité', body: (L) => `
    <h2>Qui est responsable de vos données</h2>
    <p>${L.name}, ${L.address} (contact : ${L.email}) est responsable du traitement des données des utilisateurs de Comptoir (commerçants et leurs équipes). Pour les données que chaque commerçant enregistre sur ses propres clients (fichier clients, points de fidélité, ventes), le commerçant est responsable de traitement et Comptoir agit comme sous-traitant.</p>
    <h2>Données collectées</h2>
    <ul>
      <li><strong>Compte</strong> : nom, adresse e-mail, téléphone (facultatif) et mot de passe, conservé uniquement sous forme chiffrée et irréversible.</li>
      <li><strong>Données du commerce</strong> : produits, stock, ventes, documents, clients et réglages saisis par le commerçant.</li>
      <li><strong>Données techniques</strong> : journaux de connexion et d’erreurs nécessaires à la sécurité et au bon fonctionnement, conservés au plus 90 jours.</li>
      <li><strong>Visiteurs des vitrines</strong> : aucune donnée personnelle n’est collectée ; un compteur anonyme du nombre de visites est tenu pour le commerçant. Une commande envoyée par WhatsApp passe directement de votre téléphone à celui du commerçant, sans transiter par Comptoir.</li>
    </ul>
    <h2>Pourquoi et sur quelle base</h2>
    <p>Pour fournir le service souscrit (exécution du contrat), assurer sa sécurité et l’améliorer (intérêt légitime), envoyer les e-mails d’alerte que l’Utilisateur active (consentement, désactivable à tout moment), et respecter nos obligations légales.</p>
    <h2>Destinataires</h2>
    <p>Les données ne sont jamais vendues. Elles sont accessibles à l’éditeur et à ses sous-traitants techniques : Cloudflare, Inc. (hébergement, base de données) et Resend (envoi des e-mails d’alerte, si activé). Ces prestataires peuvent traiter des données hors de l’Union européenne et du Maroc, avec des garanties contractuelles appropriées.</p>
    <h2>Durée de conservation</h2>
    <p>Pendant toute la durée de l’abonnement, puis 90 jours après sa fin pour permettre l’export, sauf obligation légale de conservation plus longue (par exemple pour les factures).</p>
    <h2>Cookies et stockage local</h2>
    <p>Comptoir n’utilise ni cookie publicitaire ni outil de mesure d’audience tiers. Seuls sont utilisés : le cookie de session de l’espace commerçant (indispensable à la connexion), un cookie mémorisant le pays choisi pour l’affichage des tarifs, et le stockage local de votre navigateur pour la boutique affichée et le panier de la vitrine. Aucun consentement n’est requis pour ces usages strictement nécessaires.</p>
    <h2>Sécurité</h2>
    <p>Connexions chiffrées (HTTPS), mots de passe hachés, données de chaque commerce strictement séparées, accès de l’équipe limités par rôles et permissions.</p>
    <h2>Vos droits</h2>
    <p>Conformément au Règlement général sur la protection des données (RGPD) et à la loi marocaine n° 09-08 relative à la protection des personnes physiques à l’égard du traitement des données à caractère personnel, vous disposez d’un droit d’accès, de rectification, d’opposition, d’effacement, de limitation et de portabilité de vos données. Écrivez à ${L.email}. Vous pouvez également saisir l’autorité de contrôle compétente : la CNDP au Maroc (cndp.ma) ou la CNIL en France (cnil.fr).</p>
    <p>Ce traitement a fait l’objet d’une déclaration auprès de la CNDP sous le numéro ${L.cndp}.</p>` },
};

export function renderLegal(origin, key, env) {
  const page = LEGAL_PAGES[key];
  if (!page) return null;
  const L = legalInfo(env);
  const title = `${page.title} | Comptoir`;
  const description = `${page.title} du service Comptoir : caisse, stock, factures et vitrine en ligne pour les commerces.`;
  return `${docHead(title, description, headTags({ origin, path: '/' + key, title: page.title, description, noindex: !L.complete }))}
<body>
  ${NAV}
  <main class="legal wrap">
    <nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="/">Comptoir</a><span aria-hidden="true">/</span><span aria-current="page">${e(page.title)}</span></nav>
    <h1>${e(page.title)}</h1>
    <p class="muted">Dernière mise à jour : ${UPDATED}</p>
    ${page.body(L)}
    <nav class="legal-nav" aria-label="Autres documents">${Object.entries(LEGAL_PAGES).filter(([k]) => k !== key).map(([k, p]) => `<a href="/${k}">${e(p.title)}</a>`).join('')}</nav>
  </main>
  ${FOOTER()}
</body>
</html>`;
}

export { docHead, NAV, FOOTER, headTags, jsonLd };
