// Centre d'aide : guides courts pour bien utiliser son espace Comptoir.
// Pages publiques (/aide, /aide/<guide>), rendues côté serveur, liées depuis l'espace commerçant.
import { escHtml as e } from './lib.js';
import { docHead, NAV, FOOTER, headTags, jsonLd } from './seo.js';

// Chaque guide : titre, résumé, écran de l'application concerné, sections (HTML simple, écrit ici).
export const GUIDES = [
  {
    slug: 'bien-demarrer', title: 'Bien démarrer', app: 'tableau-de-bord',
    summary: 'Les quatre réglages à faire le premier jour pour que tout fonctionne : coordonnées, produits, première vente, vitrine.',
    sections: [
      ['Votre espace en un coup d’œil', `<p>Le menu de gauche (ou la barre du bas sur téléphone) donne accès à tout :</p>
        <ul><li><strong>Caisse</strong> : le grand bouton, pour vendre ;</li><li><strong>Accueil</strong> : les chiffres du jour et ce qu’il reste à faire ;</li><li><strong>Ventes</strong> : commandes, devis et factures ;</li><li><strong>Produits</strong> : le catalogue et le stock ;</li><li><strong>Clients</strong>, <strong>Alertes</strong> et <strong>Rapports</strong> ;</li><li><strong>Réglages</strong> : votre commerce, vos boutiques, votre équipe et votre abonnement.</li></ul>`],
      ['Les premiers pas', `<ol><li><strong>Renseignez vos coordonnées</strong> dans Réglages, Mon commerce : nom, téléphone, adresse. Elles apparaissent sur vos tickets, vos factures et votre vitrine.</li>
        <li><strong>Ajoutez vos produits</strong> dans Produits, Nouveau produit. Les produits d’exemple (références EX-…) peuvent être modifiés ou supprimés.</li>
        <li><strong>Faites une première vente</strong> à la caisse, même un essai à 1 : vous verrez le ticket, le stock qui baisse et le chiffre du jour.</li>
        <li><strong>Complétez les mentions légales</strong> des factures dans Réglages, Mon commerce, Facturation.</li></ol>
        <p>L’Accueil affiche ces étapes dans « Pour bien démarrer » et les coche au fur et à mesure.</p>`],
      ['Installer Comptoir comme une application', `<p>Installé, Comptoir s’ouvre directement sur votre espace, en plein écran, depuis l’écran d’accueil du téléphone ou le bureau de l’ordinateur, sans passer par le site.</p>
        <ul><li><strong>Android, Windows, Chromebook et Mac avec Chrome ou Edge</strong> : touchez <strong>Installer l’application</strong> dans le menu de votre espace (dans « Plus » sur téléphone), ou la carte sur l’Accueil, puis confirmez.</li>
        <li><strong>iPhone et iPad</strong> : dans Safari, bouton <strong>Partager</strong>, puis <strong>Sur l’écran d’accueil</strong>, puis <strong>Ajouter</strong>. Vous vous connectez une fois dans l’application.</li>
        <li><strong>Mac avec Safari</strong> : menu <strong>Fichier</strong>, puis <strong>Ajouter au Dock</strong>.</li></ul>
        <p>Un appui long (ou un clic droit) sur l’icône ouvre directement la <strong>Caisse</strong>, les <strong>Produits</strong> ou les <strong>Rapports</strong>. L’application se met à jour toute seule.</p>`],
    ],
  },
  {
    slug: 'caisse', title: 'Encaisser à la caisse', app: 'caisse',
    summary: 'Ajouter des articles, scanner, appliquer une remise, encaisser en plusieurs paiements, rendre la monnaie et imprimer le ticket.',
    sections: [
      ['Composer le ticket', `<ul><li><strong>Touchez une tuile</strong> pour ajouter le produit ; touchez-la encore pour en ajouter un.</li>
        <li><strong>Scannez un code-barres</strong> : une douchette USB ou Bluetooth fonctionne sans réglage, le champ « Scanner ou rechercher un produit » est actif dès l’ouverture de la caisse.</li>
        <li><strong>Article libre</strong> : pour vendre quelque chose qui n’est pas dans le catalogue (un service, un article unique).</li>
        <li>Les boutons <strong>−</strong> et <strong>+</strong> changent la quantité ; le prix d’une ligne se modifie si vous en avez le droit.</li></ul>`],
      ['Encaisser', `<ol><li>Choisissez le client si vous le connaissez (utile pour la fidélité et l’historique), sinon laissez « Client de passage ».</li>
        <li>Touchez <strong>Encaisser</strong>, puis le mode de paiement : espèces, carte, chèque, virement ou paiement mobile.</li>
        <li>En espèces, saisissez le montant reçu ou touchez un billet : <strong>la monnaie à rendre</strong> s’affiche.</li>
        <li>Pour payer en plusieurs fois (une partie en espèces, le reste par carte), ajoutez un second paiement avant de valider.</li></ol>
        <p>Le stock baisse automatiquement et le ticket peut être imprimé (format 80 mm pour les imprimantes de tickets).</p>`],
      ['Remise, mise de côté et crédit', `<ul><li><strong>Remise</strong> : un pourcentage sur tout le ticket.</li>
        <li><strong>Mettre de côté</strong> : pour une commande prise au téléphone ou réservée. Elle apparaît dans Ventes, Commandes, et s’encaisse au retrait ; le stock n’est déduit qu’une fois.</li>
        <li><strong>À crédit</strong> : le client paie plus tard. Une facture est créée avec une échéance, et les retards apparaissent dans les Alertes.</li></ul>
        <p>Ces boutons n’apparaissent que pour les membres qui en ont le droit (voir <a href="/aide/equipe-et-droits">Équipe et droits</a>).</p>`],
      ['Le journal de caisse', `<p>L’onglet <strong>Journal de caisse</strong> donne, pour une journée : les encaissements par mode de paiement, les tickets, les ventes à crédit, le panier moyen. Il s’imprime pour la clôture du soir. Un ticket ouvert depuis le journal peut être annulé : le stock est restitué, un remboursement est inscrit au journal et les points de fidélité sont rendus.</p>`],
    ],
  },
  {
    slug: 'produits-et-stock', title: 'Produits et stock', app: 'produits',
    summary: 'Créer une fiche produit, gérer les catégories et les photos, réceptionner la marchandise, faire un inventaire et recevoir les alertes de rupture.',
    sections: [
      ['Créer un produit', `<p>Dans <strong>Produits, Nouveau produit</strong>, l’essentiel suffit : photo, nom, <strong>prix de vente TTC</strong> (le prix payé par le client), quantité en stock et catégorie.</p>
        <p>Sous <strong>Plus d’options</strong> : référence, code-barres, TVA, prix d’achat (pour calculer la marge), unité de vente (pièce, kg, mètre, lot…) et seuil d’alerte. Décochez « Suivre le stock » pour un service.</p>`],
      ['Faire entrer ou sortir du stock', `<p>Dans <strong>Produits, Stock</strong> :</p>
        <ul><li><strong>Entrée de stock</strong> : à la réception d’une livraison fournisseur ;</li><li><strong>Sortie</strong> : casse, perte, usage interne ;</li><li><strong>Inventaire</strong> : vous saisissez la quantité comptée, Comptoir corrige l’écart.</li></ul>
        <p>Chaque mouvement est tracé dans « Mouvements récents », avec la date et le motif. Les ventes et les annulations s’y ajoutent seules.</p>`],
      ['Ne plus tomber en rupture', `<p>Donnez à chaque produit un <strong>seuil d’alerte</strong> (« M’alerter quand il en reste »). Les produits sous ce seuil remontent dans <strong>Alertes</strong> et dans « À réapprovisionner », avec la quantité conseillée et une liste à imprimer pour votre fournisseur.</p>`],
    ],
  },
  {
    slug: 'devis-commandes-factures', title: 'Devis, commandes et factures', app: 'devis',
    summary: 'Faire un devis, le transformer en commande puis en facture, enregistrer les paiements partiels et relancer les retards.',
    sections: [
      ['Le parcours d’une vente', `<ol><li><strong>Devis</strong> : dans Ventes, Devis, Nouveau. Ajoutez le client et les lignes, puis imprimez-le ou envoyez-le avec <strong>Écrire au client</strong>.</li>
        <li><strong>Commande</strong> : le client accepte ? Transformez le devis en commande en un clic. Le stock est déduit quand la commande passe au statut « livrée ».</li>
        <li><strong>Facture</strong> : transformez la commande (ou directement le devis) en facture. Le numéro est attribué automatiquement et ne peut plus changer.</li></ol>
        <p>Chaque document garde le lien vers celui dont il vient : vous retrouvez toujours le devis d’origine d’une facture.</p>`],
      ['Paiements et relances', `<ul><li>Sur une facture, le bouton <strong>Encaisser</strong> accepte les paiements partiels : le reste dû se met à jour.</li>
        <li>Le <strong>délai de paiement</strong> par défaut se règle dans Réglages, Mon commerce, Facturation.</li>
        <li>Les factures en retard apparaissent dans <strong>Alertes</strong> et sur l’Accueil, avec un bouton pour relancer le client.</li></ul>`],
      ['Personnaliser vos documents', `<p>Dans Réglages, Mon commerce, Facturation : TVA par défaut, coordonnées bancaires, mentions légales et message en bas des documents.</p>`],
    ],
  },
  {
    slug: 'clients-et-fidelite', title: 'Clients et fidélité', app: 'clients',
    summary: 'Tenir un fichier clients, suivre leurs achats et récompenser les clients fidèles avec des points.',
    sections: [
      ['Le fichier clients', `<p>Dans <strong>Clients</strong>, chaque fiche regroupe les coordonnées, les documents, le total facturé et le reste dû. Un client se crée aussi depuis la caisse avec le bouton <strong>Nouveau</strong>.</p>`],
      ['Activer le programme de fidélité', `<p>Dans <strong>Réglages, Mon commerce, Programme de fidélité</strong>, cochez « Activer » et choisissez :</p>
        <ul><li>le montant dépensé pour gagner 1 point ;</li><li>le nombre de points pour une récompense ;</li><li>la valeur de la récompense.</li></ul>
        <p>Un aperçu indique le pourcentage reversé à vos clients (environ 5 % par défaut).</p>`],
      ['À la caisse', `<p>Choisissez le client : son solde de points s’affiche. Dès qu’il a assez de points et que le panier atteint la valeur de la récompense, touchez <strong>Utiliser … points</strong>. Les points gagnés sont imprimés sur le ticket. Une annulation rend les points.</p>
        <p>Pour un geste commercial, le bouton <strong>Ajuster</strong> de la fiche client ajoute ou retire des points, avec un motif.</p>`],
    ],
  },
  {
    slug: 'vitrine-et-whatsapp', title: 'Vitrine en ligne et commandes WhatsApp', app: 'parametres',
    summary: 'Mettre votre catalogue en ligne à vos couleurs, le partager et recevoir les commandes de vos clients sur WhatsApp.',
    sections: [
      ['Votre vitrine', `<p>Chaque commerce a sa vitrine publique : votre catalogue, vos prix et la disponibilité, à jour en temps réel. Son adresse est dans <strong>Réglages, Mon commerce, Vitrine en ligne</strong>, avec un bouton pour la copier. Sur l’Accueil, <strong>Partager ma vitrine</strong> ouvre le partage du téléphone (WhatsApp, SMS…) ou copie le lien sur ordinateur.</p>
        <p>Vous y choisissez la couleur, et si les prix et la disponibilité sont affichés. Un produit se masque de la vitrine depuis sa fiche.</p>`],
      ['Recevoir les commandes sur WhatsApp', `<ol><li>Dans <strong>Réglages, Mon commerce, Commandes WhatsApp</strong>, saisissez votre numéro (format local accepté, par exemple 06 12 34 56 78).</li>
        <li>Cochez « Permettre aux clients de composer un panier ».</li></ol>
        <p>Vos clients ajoutent des produits sur la vitrine, puis envoient un message tout prêt : articles, références, total estimé, nom, retrait ou livraison. Vous confirmez la disponibilité et le prix, puis vous pouvez <strong>mettre la commande de côté</strong> depuis la caisse.</p>`],
      ['Être trouvé sur Google', `<p>Votre vitrine est lisible par les moteurs de recherche. Pour aider : un texte d’accueil qui dit ce que vous vendez et où, des noms de produits clairs, des photos, et l’adresse complète.</p>`],
    ],
  },
  {
    slug: 'boutiques-et-rapports', title: 'Plusieurs boutiques et rapports', app: 'rapports',
    summary: 'Gérer plusieurs points de vente, suivre le stock de chacun, transférer la marchandise et savoir quelle boutique rapporte le plus.',
    sections: [
      ['Ajouter une boutique', `<p>Dans <strong>Réglages, Boutiques, Ajouter une boutique</strong>. Chaque boutique a son stock, ses ventes et son journal de caisse. Le nombre de boutiques dépend de votre formule.</p>`],
      ['Choisir la boutique affichée', `<p>Le sélecteur <strong>Boutique</strong>, en haut du menu (dans « Plus » sur téléphone), choisit la boutique que vous regardez. « Toutes les boutiques » donne la vue d’ensemble ; la caisse demande alors dans quelle boutique vous encaissez.</p>`],
      ['Transférer du stock', `<p>Dans <strong>Produits, Stock, Transfert entre boutiques</strong> : le produit, la boutique de départ, celle d’arrivée et la quantité. Le stock total ne change pas.</p>`],
      ['Les rapports', `<p><strong>Rapports</strong> compare vos boutiques sur 7 jours, 30 jours, le mois ou l’année : chiffre d’affaires et part de chacune, évolution, panier moyen, marge brute, impayés, valeur du stock et meilleures ventes.</p>
        <p>La marge se calcule à partir du <strong>prix d’achat</strong> des produits : renseignez-le dans les fiches pour qu’elle soit complète.</p>`],
    ],
  },
  {
    slug: 'equipe-et-droits', title: 'Équipe et droits', app: 'equipe',
    summary: 'Donner un accès à chaque employé, choisir ce qu’il peut faire et dans quelles boutiques.',
    sections: [
      ['Ajouter un membre', `<ol><li>Dans <strong>Réglages, Équipe et rôles, Ajouter un membre</strong> : nom et e-mail.</li>
        <li>Choisissez son <strong>rôle</strong> et ses <strong>boutiques</strong> (toutes, ou seulement certaines).</li>
        <li>Transmettez-lui l’adresse et le mot de passe temporaire affichés : il choisira le sien à la première connexion.</li></ol>`],
      ['Les rôles', `<ul><li><strong>Gérant</strong> : tout le quotidien (caisse, produits, stock, ventes, chiffres), sans l’administration ;</li>
        <li><strong>Caissier</strong> : encaisser, voir son journal de caisse, gérer les clients ;</li>
        <li><strong>Magasinier</strong> : produits, stock et alertes ;</li>
        <li><strong>Comptable</strong> : devis, factures, paiements et chiffres, sans encaisser.</li></ul>
        <p><strong>Créer un rôle</strong> permet d’en composer un sur mesure, en cochant les permissions. Le tableau des rôles montre qui peut faire quoi. Un changement de droits s’applique immédiatement.</p>`],
      ['Mot de passe oublié', `<p>Un employé a oublié son mot de passe ? Bouton <strong>Mot de passe</strong> sur sa ligne : un nouveau mot de passe temporaire est créé. Le propriétaire qui a oublié le sien contacte le support Comptoir.</p>`],
    ],
  },
  {
    slug: 'reglages-et-abonnement', title: 'Réglages, alertes et abonnement', app: 'parametres',
    summary: 'Les réglages du commerce, les alertes du matin par e-mail et le choix de la formule.',
    sections: [
      ['Mon commerce', `<p>Coordonnées, vitrine, commandes WhatsApp, fidélité et facturation (TVA, délai de paiement, coordonnées bancaires, mentions légales) se règlent dans <strong>Réglages, Mon commerce</strong>. Les modifications s’appliquent aux prochains tickets et documents.</p>`],
      ['Les alertes', `<p>La page <strong>Alertes</strong> regroupe les factures en retard, les échéances proches, les ruptures et les stocks sous le seuil. Vous pouvez recevoir ce résumé <strong>chaque matin par e-mail</strong> : indiquez l’adresse dans « E-mail qui reçoit les alertes » et le nombre de jours pour être prévenu avant une échéance.</p>`],
      ['L’abonnement', `<p><strong>Réglages, Abonnement</strong> montre votre formule, votre utilisation (produits et utilisateurs) et les formules disponibles, dans la devise de votre pays. Choisissez une formule : elle est activée dès réception du paiement. Sans engagement.</p>`],
    ],
  },
  {
    slug: 'questions-frequentes', title: 'Questions fréquentes', app: null,
    summary: 'Imprimante, douchette, téléphone, données, fin d’essai : les réponses aux questions les plus posées.',
    faq: [
      ['Quelle imprimante de tickets utiliser ?', 'N’importe quelle imprimante thermique 80 mm reconnue par votre ordinateur ou votre tablette. Le ticket s’imprime depuis la fenêtre d’impression du navigateur : choisissez l’imprimante et désactivez les marges.'],
      ['Comment brancher une douchette code-barres ?', 'Branchez-la (USB ou Bluetooth) : elle se comporte comme un clavier. À la caisse, scannez directement, le produit s’ajoute au ticket. Le code-barres se renseigne dans la fiche produit, sous Plus d’options.'],
      ['Comptoir fonctionne-t-il sans internet ?', 'Non : les ventes et le stock sont enregistrés en direct sur le serveur, pour qu’ils soient justes sur tous vos appareils. Sans connexion, l’application l’indique et se recharge toute seule quand internet revient.'],
            ['Puis-je utiliser Comptoir sur plusieurs appareils ?', 'Oui, en même temps : ordinateur, tablette et téléphone. Chaque membre de l’équipe se connecte avec son propre compte.'],
      ['Que se passe-t-il à la fin de l’essai gratuit ?', 'Vos données restent consultables. Pour continuer à encaisser et modifier, choisissez une formule dans Réglages, Abonnement.'],
      ['Mes données sont-elles protégées ?', 'Chaque commerce a son espace, séparé des autres. Les connexions sont chiffrées et les mots de passe ne sont jamais conservés en clair. Voir la politique de confidentialité.'],
      ['Un produit affiche un stock négatif, pourquoi ?', 'Il a été vendu alors que le stock enregistré était à zéro. Faites un inventaire dans Produits, Stock, Inventaire pour corriger la quantité.'],
      ['Comment annuler une vente ?', 'Dans la caisse, onglet Journal de caisse, ouvrez le ticket et annulez-le. Le stock est restitué, un remboursement est inscrit au journal et les points de fidélité sont rendus ; le ticket reste visible comme annulé.'],
    ],
  },
];

const css = `<style>
.help { max-width: 980px; padding-bottom: 72px; }
.help h1 { font-size: clamp(2.6rem, 6vw, 4rem); line-height: 1; margin: 20px 0 10px; }
.help-lead { color: var(--muted); font-size: 1.1rem; max-width: 40rem; margin: 0 0 24px; }
.help-search { width: 100%; max-width: 520px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 1rem; background: #fff; }
.help-grid { list-style: none; padding: 0; margin: 28px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.help-grid a { display: flex; flex-direction: column; gap: 6px; height: 100%; padding: 20px 22px; background: #fff; border: 1px solid var(--line); border-radius: 12px; text-decoration: none; }
.help-grid a:hover { border-color: var(--ink); }
.help-grid strong { font-size: 1.1rem; }
.help-grid span { color: var(--muted); font-size: .94rem; }
.help-empty { color: var(--muted); }
.help-article { max-width: 760px; }
.help-article h2 { font-family: var(--font); font-size: 1.3rem; font-weight: 700; margin: 34px 0 10px; letter-spacing: 0; }
.help-article p, .help-article li { line-height: 1.65; color: #2F3238; }
.help-article ul, .help-article ol { padding-left: 22px; display: grid; gap: 6px; }
.help-article .help-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.help-toc a { display: block; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: #fff; text-decoration: none; font-size: .88rem; font-weight: 600; }
.help-open { display: inline-flex; margin-top: 18px; }
.help-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 44px; padding-top: 20px; border-top: 1px solid var(--line); }
.help-nav a { text-decoration: none; font-weight: 600; }
.help-nav small { display: block; color: var(--muted); font-weight: 400; }
.help-article details { border-top: 1px solid var(--line); padding: 16px 0; }
.help-article details:last-of-type { border-bottom: 1px solid var(--line); }
.help-article summary { font-weight: 600; cursor: pointer; font-size: 1.05rem; }
</style>`;

const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function renderHelpIndex(origin) {
  const title = 'Aide Comptoir : guides pour bien utiliser votre espace';
  const description = 'Guides courts pour bien utiliser Comptoir : caisse, produits et stock, factures, clients et fidélité, vitrine WhatsApp, boutiques, équipe et réglages.';
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: GUIDES.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/aide/${g.slug}`, name: g.title })) };
  const index = GUIDES.map((g) => ({ s: g.slug, t: (g.title + ' ' + g.summary + ' ' + (g.sections || []).map(([h, x]) => h + ' ' + plain(x)).join(' ') + ' ' + (g.faq || []).flat().join(' ')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') }));
  return `${docHead(title, description, headTags({ origin, path: '/aide', title, description }) + jsonLd(ld) + css)}
<body>
  ${NAV}
  <main class="help wrap">
    <nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="/">Comptoir</a><span aria-hidden="true">/</span><span aria-current="page">Aide</span></nav>
    <h1>Centre d’aide</h1>
    <p class="help-lead">Des guides courts pour bien utiliser votre espace, de la première vente aux rapports par boutique.</p>
    <label class="visually-hidden" for="helpQ">Rechercher dans l’aide</label>
    <input class="help-search" id="helpQ" type="search" placeholder="Rechercher : inventaire, imprimante, fidélité…" autocomplete="off">
    <ul class="help-grid" id="helpList">${GUIDES.map((g) => `<li data-slug="${g.slug}"><a href="/aide/${g.slug}"><strong>${e(g.title)}</strong><span>${e(g.summary)}</span></a></li>`).join('')}</ul>
    <p class="help-empty" id="helpEmpty" hidden>Aucun guide ne correspond. Essayez un autre mot, ou consultez les <a href="/aide/questions-frequentes">questions fréquentes</a>.</p>
  </main>
  ${FOOTER()}
  <script>
    (() => {
      const IDX = ${JSON.stringify(index).replace(/</g, '\\u003c')};
      const q = document.getElementById('helpQ');
      q.addEventListener('input', () => {
        const words = q.value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').split(/\\s+/).filter(Boolean);
        let n = 0;
        for (const it of IDX) { const ok = words.every((w) => it.t.includes(w)); document.querySelector('[data-slug="' + it.s + '"]').hidden = !ok; n += ok ? 1 : 0; }
        document.getElementById('helpEmpty').hidden = n > 0;
      });
    })();
  </script>
</body>
</html>`;
}

export function renderHelpGuide(origin, slug) {
  const i = GUIDES.findIndex((g) => g.slug === slug);
  if (i < 0) return null;
  const g = GUIDES[i], prev = GUIDES[i - 1], next = GUIDES[i + 1];
  const title = `${g.title} | Aide Comptoir`;
  const path = `/aide/${g.slug}`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Comptoir', item: origin + '/' },
    { '@type': 'ListItem', position: 2, name: 'Aide', item: origin + '/aide' },
    { '@type': 'ListItem', position: 3, name: g.title, item: origin + path },
  ] }];
  if (g.faq) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: g.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  else ld.push({ '@context': 'https://schema.org', '@type': 'TechArticle', headline: g.title, description: g.summary, inLanguage: 'fr', url: origin + path });
  const anchor = (h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const body = g.faq
    ? g.faq.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')
    : g.sections.map(([h, html]) => `<h2 id="${anchor(h)}">${e(h)}</h2>${html}`).join('');
  return `${docHead(title, g.summary, headTags({ origin, path, title: g.title, description: g.summary }) + ld.map(jsonLd).join('') + css)}
<body>
  ${NAV}
  <main class="help wrap">
    <nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="/">Comptoir</a><span aria-hidden="true">/</span><a href="/aide">Aide</a><span aria-hidden="true">/</span><span aria-current="page">${e(g.title)}</span></nav>
    <article class="help-article">
      <h1>${e(g.title)}</h1>
      <p class="help-lead">${e(g.summary)}</p>
      ${g.sections && g.sections.length > 2 ? `<ul class="help-toc">${g.sections.map(([h]) => `<li><a href="#${anchor(h)}">${e(h)}</a></li>`).join('')}</ul>` : ''}
      ${body}
      ${g.app ? `<a class="btn btn-primary help-open" href="/app/#/${g.app}">Ouvrir dans mon espace</a>` : ''}
      <nav class="help-nav" aria-label="Guides">
        ${prev ? `<a href="/aide/${prev.slug}"><small>Précédent</small>${e(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a href="/aide/${next.slug}" style="text-align:right"><small>Suivant</small>${e(next.title)}</a>` : `<a href="/aide" style="text-align:right"><small>Retour</small>Tous les guides</a>`}
      </nav>
    </article>
  </main>
  ${FOOTER()}
</body>
</html>`;
}
