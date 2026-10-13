// Configuration de la plateforme : nom, formules d'abonnement, pays et modèles de commerce.

export const PLATFORM = {
  name: 'Comptoir',
  tagline: 'La caisse, le stock et la vitrine en ligne de votre commerce.',
  trialDays: 14,
};

// Limites : null = illimité. Prix mensuel HT dans la devise de facturation de la plateforme.
export const PLANS = {
  essai: { name: 'Essai gratuit', price: 0, products: 1000, users: 3, locations: 3, description: 'Toutes les fonctions pendant 14 jours.' },
  essentiel: { name: 'Essentiel', price: 19, products: 300, users: 1, locations: 1, description: 'Caisse, stock et vitrine pour démarrer.' },
  pro: { name: 'Pro', price: 39, products: 5000, users: 5, locations: 3, description: 'Devis, factures, alertes et équipe.' },
  business: { name: 'Business', price: 79, products: null, users: 20, locations: null, description: 'Sans limite de produits, équipe étendue.' },
};
export const PAID_PLANS = ['essentiel', 'pro', 'business'];

export const COUNTRIES = {
  FR: { name: 'France', currency: '€', tva: 20, iso: 'EUR', dial: '33' },
  BE: { name: 'Belgique', currency: '€', tva: 21, iso: 'EUR', dial: '32' },
  CH: { name: 'Suisse', currency: 'CHF', tva: 8.1, iso: 'CHF', dial: '41' },
  LU: { name: 'Luxembourg', currency: '€', tva: 17, iso: 'EUR', dial: '352' },
  MA: { name: 'Maroc', currency: 'DH', tva: 20, iso: 'MAD', dial: '212' },
  DZ: { name: 'Algérie', currency: 'DA', tva: 19, iso: 'DZD', dial: '213' },
  TN: { name: 'Tunisie', currency: 'DT', tva: 19, iso: 'TND', dial: '216' },
  SN: { name: 'Sénégal', currency: 'FCFA', tva: 18, iso: 'XOF', dial: '221' },
  CI: { name: "Côte d'Ivoire", currency: 'FCFA', tva: 18, iso: 'XOF', dial: '225', keepZero: true },
  CM: { name: 'Cameroun', currency: 'FCFA', tva: 19.25, iso: 'XAF', dial: '237' },
  CA: { name: 'Canada (Québec)', currency: '$', tva: 14.975, iso: 'CAD', dial: '1' },
  XX: { name: 'Autre pays', currency: '€', tva: 20, iso: 'EUR', dial: '' },
};

// Chaque modèle : catégories, unités, couleur de vitrine, texte d'accueil et quelques produits d'exemple
// [nom, description, index de catégorie, prix TTC, unité, stock, seuil].
export const BUSINESS_TYPES = {
  quincaillerie: {
    label: 'Quincaillerie & bricolage', accent: '#1F2D3A',
    categories: ['Visserie & fixation', 'Outillage à main', 'Électroportatif', 'Plomberie', 'Électricité', 'Peinture'],
    units: ['pièce', 'boîte', 'sachet', 'mètre', 'kg', 'litre'],
    tagline: 'Visserie, outillage, plomberie, électricité : consultez notre catalogue et la disponibilité en magasin.',
    demo: [
      ['Vis bois inox 4×50 mm, boîte de 200', 'Tête fraisée Torx, pour l’extérieur.', 0, 14.9, 'boîte', 40, 10],
      ['Marteau de charpentier 500 g', 'Manche fibre de verre anti-vibrations.', 1, 24.9, 'pièce', 12, 4],
      ['Perceuse-visseuse 18 V, 2 batteries', 'Couple 60 Nm, livrée en coffret.', 2, 149, 'pièce', 5, 2],
      ['Mitigeur lavabo chromé', 'Cartouche céramique, flexibles fournis.', 3, 58, 'pièce', 3, 3],
    ],
  },
  alimentation: {
    label: 'Épicerie & alimentation', accent: '#2E6B3A',
    categories: ['Fruits & légumes', 'Épicerie salée', 'Épicerie sucrée', 'Boissons', 'Produits frais', 'Hygiène & entretien'],
    units: ['pièce', 'kg', 'litre', 'paquet', 'bouteille', 'lot'],
    tagline: 'Produits frais et épicerie du quotidien : découvrez nos rayons et passez commande par téléphone.',
    demo: [
      ['Tomates grappe', 'Origine locale, selon arrivage.', 0, 3.2, 'kg', 25, 5],
      ['Huile d’olive vierge extra 1 L', 'Première pression à froid.', 1, 9.5, 'bouteille', 18, 6],
      ['Café moulu 250 g', 'Torréfaction artisanale.', 2, 4.8, 'paquet', 30, 8],
      ['Eau minérale 6 × 1,5 L', '', 3, 3.9, 'lot', 40, 10],
    ],
  },
  mode: {
    label: 'Mode & accessoires', accent: '#7A2E4E',
    categories: ['Femme', 'Homme', 'Enfant', 'Chaussures', 'Accessoires'],
    units: ['pièce', 'paire', 'lot'],
    tagline: 'Les nouveautés de la saison, en boutique et disponibles en un coup d’œil.',
    demo: [
      ['Chemise lin, coupe droite', 'Tailles S à XL, plusieurs coloris.', 1, 49, 'pièce', 14, 4],
      ['Robe midi imprimée', 'Viscose fluide, doublée.', 0, 65, 'pièce', 9, 3],
      ['Baskets cuir blanches', 'Du 36 au 45.', 3, 89, 'paire', 11, 4],
      ['Sac cabas en toile', 'Anses cuir, poche intérieure zippée.', 4, 35, 'pièce', 6, 2],
    ],
  },
  beaute: {
    label: 'Beauté & parfumerie', accent: '#9A4F3B',
    categories: ['Soins visage', 'Maquillage', 'Parfums', 'Cheveux', 'Corps'],
    units: ['pièce', 'flacon', 'coffret'],
    tagline: 'Soins, maquillage et parfums sélectionnés avec soin. Conseils personnalisés en boutique.',
    demo: [
      ['Crème hydratante 50 ml', 'Peaux normales à sèches.', 0, 24.5, 'pièce', 20, 5],
      ['Rouge à lèvres mat', 'Tenue longue durée, 12 teintes.', 1, 18.9, 'pièce', 36, 10],
      ['Eau de parfum 50 ml', 'Notes boisées et ambrées.', 2, 69, 'flacon', 8, 3],
      ['Shampoing doux 250 ml', 'Sans sulfates.', 3, 12.9, 'flacon', 15, 5],
    ],
  },
  electronique: {
    label: 'Téléphonie & électronique', accent: '#1E4FA8',
    categories: ['Smartphones', 'Accessoires', 'Informatique', 'Audio', 'Réparations'],
    units: ['pièce', 'service'],
    tagline: 'Smartphones, accessoires et réparations rapides. Vérifiez la disponibilité avant de passer.',
    demo: [
      ['Coque silicone renforcée', 'Pour les modèles les plus courants.', 1, 19.9, 'pièce', 45, 10],
      ['Chargeur rapide USB-C 20 W', '', 1, 24.9, 'pièce', 22, 6],
      ['Écouteurs sans fil', 'Autonomie 24 h avec le boîtier.', 3, 59, 'pièce', 7, 3],
      ['Remplacement d’écran', 'Main-d’œuvre, pièce en sus selon modèle.', 4, 49, 'service', 0, 0, 'service'],
    ],
  },
  librairie: {
    label: 'Librairie & papeterie', accent: '#5B4A2F',
    categories: ['Romans', 'Jeunesse', 'Scolaire', 'Papeterie', 'Loisirs créatifs'],
    units: ['pièce', 'lot', 'ramette'],
    tagline: 'Livres, fournitures scolaires et papeterie : demandez-nous, nous commandons ce qui manque.',
    demo: [
      ['Cahier grand format 96 pages', 'Grands carreaux.', 2, 2.9, 'pièce', 120, 30],
      ['Ramette papier A4 80 g', '500 feuilles.', 3, 6.5, 'ramette', 40, 10],
      ['Stylos gel, lot de 4', 'Noir, bleu, rouge, vert.', 3, 5.9, 'lot', 50, 15],
      ['Boîte de 24 crayons de couleur', '', 4, 8.9, 'pièce', 18, 5],
    ],
  },
  maison: {
    label: 'Maison & décoration', accent: '#3F5E5A',
    categories: ['Cuisine', 'Décoration', 'Linge de maison', 'Rangement', 'Luminaires'],
    units: ['pièce', 'lot', 'mètre'],
    tagline: 'Des objets choisis pour la maison : cuisine, décoration et linge, disponibles en boutique.',
    demo: [
      ['Lot de 4 verres soufflés', 'Verre recyclé.', 0, 24, 'lot', 12, 4],
      ['Coussin lin lavé 45 × 45', 'Housse déhoussable.', 2, 29, 'pièce', 16, 5],
      ['Panier en jonc tressé', 'Diamètre 35 cm.', 3, 32, 'pièce', 7, 2],
      ['Lampe à poser céramique', 'Abat-jour lin inclus.', 4, 79, 'pièce', 4, 2],
    ],
  },
  autre: {
    label: 'Autre commerce', accent: '#2F3A45',
    categories: ['Produits', 'Services'],
    units: ['pièce', 'kg', 'litre', 'mètre', 'heure', 'service'],
    tagline: 'Découvrez nos produits et leur disponibilité, puis passez nous voir ou appelez-nous.',
    demo: [
      ['Produit exemple', 'Modifiez ou supprimez ce produit.', 0, 10, 'pièce', 10, 3],
      ['Prestation exemple', 'Un service sans suivi de stock.', 1, 30, 'service', 0, 0, 'service'],
    ],
  },
};

// Valeurs par défaut du programme de fidélité selon la devise : environ 5 % reversés au client.
const LOYALTY_DEFAULTS = { '€': [1, 5], CHF: [1, 5], $: [1, 5], DH: [10, 50], DT: [3, 15], DA: [100, 500], FCFA: [500, 2500] };
export function defaultSettings({ name, phone = '', email = '', country = 'FR', type = 'autre' }) {
  const c = COUNTRIES[country] || COUNTRIES.XX;
  const t = BUSINESS_TYPES[type] || BUSINESS_TYPES.autre;
  return {
    shop_name: name, tagline: t.tagline, address: '', phone, email, hours: '',
    currency: c.currency, tva_default: String(c.tva), invoice_due_days: '30',
    legal_info: '', bank_info: '', doc_footer: 'Merci pour votre confiance.',
    accent: t.accent, alert_email: email, alert_digest: '0', due_soon_days: '7',
    catalog_public: '1', show_prices: '1', show_stock: '1',
    whatsapp: '', whatsapp_orders: '1', previous_tool: '',
    loyalty_enabled: '0', loyalty_earn: String((LOYALTY_DEFAULTS[c.currency] || [1, 5])[0]), loyalty_threshold: '100',
    loyalty_reward: String((LOYALTY_DEFAULTS[c.currency] || [1, 5])[1]),
  };
}
export const SETTING_KEYS = Object.keys(defaultSettings({ name: '' }));

/* ------------------------------------------------------------------ */
/* Prix des formules dans la devise de chaque pays                     */
/* ------------------------------------------------------------------ */
// Prix ronds pensés pour chaque marché (pas une simple conversion). eur : valeur approximative en euros (pilotage).
export const LOCAL_PRICES = {
  EUR: { symbol: '€', essentiel: 19, pro: 39, business: 79, eur: 1 },
  CHF: { symbol: 'CHF', essentiel: 19, pro: 39, business: 79, eur: 1.05 },
  MAD: { symbol: 'DH', essentiel: 199, pro: 419, business: 849, eur: 0.092 },
  DZD: { symbol: 'DA', essentiel: 2900, pro: 5900, business: 11900, eur: 0.0068 },
  TND: { symbol: 'DT', essentiel: 59, pro: 119, business: 249, eur: 0.3 },
  XOF: { symbol: 'FCFA', essentiel: 12500, pro: 25000, business: 49000, eur: 0.001524 },
  XAF: { symbol: 'FCFA', essentiel: 12500, pro: 25000, business: 49000, eur: 0.001524 },
  CAD: { symbol: '$', essentiel: 29, pro: 59, business: 119, eur: 0.67 },
};
export function pricing(country) {
  const c = COUNTRIES[country] ? country : 'XX';
  const iso = COUNTRIES[c].iso, p = LOCAL_PRICES[iso] || LOCAL_PRICES.EUR;
  const fmt = (n) => `${new Intl.NumberFormat('fr-FR').format(n)} ${p.symbol}`;
  return { country: c, country_name: COUNTRIES[c].name, currency: iso, symbol: p.symbol, eur: p.eur, price: (plan) => p[plan] ?? 0, format: fmt };
}
// Valeur mensuelle d'un abonnement en euros (pilotage de la plateforme, toutes devises confondues).
export const planEur = (plan, country) => { const p = pricing(country); return Math.round(p.price(plan) * p.eur * 100) / 100; };

// Numéro WhatsApp international (chiffres seulement) à partir d'un numéro saisi localement.
export function waNumber(raw, country) {
  let d = String(raw || '').trim();
  if (!d) return '';
  const plus = d.startsWith('+') || d.startsWith('00');
  d = d.replace(/\D/g, '');
  if (plus) return d.replace(/^00/, '');
  const c = COUNTRIES[country] || COUNTRIES.XX;
  if (!c.dial) return d;
  if (d.startsWith(c.dial) && d.length > 9) return d;
  if (c.keepZero) return c.dial + d;
  return c.dial + d.replace(/^0/, '');
}


// Permissions attribuables aux membres de l'équipe (contrôle d'accès par rôle).
export const PERMISSIONS = [
  { key: 'pos.sell', group: 'Caisse', label: 'Encaisser des ventes' },
  { key: 'pos.discount', group: 'Caisse', label: 'Accorder des remises et modifier un prix en caisse' },
  { key: 'pos.credit', group: 'Caisse', label: 'Vendre à crédit et mettre des commandes de côté' },
  { key: 'pos.journal', group: 'Caisse', label: 'Voir le journal de caisse' },
  { key: 'products.edit', group: 'Produits et stock', label: 'Créer et modifier les produits, les prix et les catégories' },
  { key: 'stock.manage', group: 'Produits et stock', label: 'Réceptionner, ajuster et transférer le stock' },
  { key: 'purchases.view', group: 'Produits et stock', label: 'Voir les achats et les fournisseurs' },
  { key: 'purchases.manage', group: 'Produits et stock', label: 'Commander aux fournisseurs et réceptionner la marchandise' },
  { key: 'customers.manage', group: 'Clients', label: 'Créer et modifier les fiches clients' },
  { key: 'documents.view', group: 'Ventes', label: 'Voir les devis, commandes et factures' },
  { key: 'documents.edit', group: 'Ventes', label: 'Créer, modifier et annuler devis, commandes, factures et tickets' },
  { key: 'payments.manage', group: 'Ventes', label: 'Enregistrer des paiements et relancer les clients' },
  { key: 'reports.view', group: 'Pilotage', label: 'Voir le tableau de bord, les chiffres et les rapports par boutique' },
  { key: 'alerts.view', group: 'Pilotage', label: 'Voir les alertes (impayés, ruptures, stock bas)' },
  { key: 'settings.manage', group: 'Administration', label: 'Modifier les réglages du commerce et de la vitrine' },
  { key: 'locations.manage', group: 'Administration', label: 'Créer et modifier les boutiques' },
  { key: 'team.manage', group: 'Administration', label: 'Gérer l’équipe, les rôles et les accès' },
  { key: 'billing.manage', group: 'Administration', label: 'Gérer l’abonnement' },
];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Rôles créés pour chaque commerce ; le propriétaire a toujours toutes les permissions.
export const DEFAULT_ROLES = [
  { name: 'Gérant', description: 'Tient la boutique au quotidien : caisse, produits, stock, ventes et chiffres.',
    permissions: ['pos.sell', 'pos.discount', 'pos.credit', 'pos.journal', 'products.edit', 'stock.manage', 'purchases.view', 'purchases.manage', 'customers.manage', 'documents.view', 'documents.edit', 'payments.manage', 'reports.view', 'alerts.view'] },
  { name: 'Caissier', description: 'Encaisse les ventes et consulte son journal de caisse.',
    permissions: ['pos.sell', 'pos.journal', 'customers.manage'] },
  { name: 'Magasinier', description: 'Réceptionne la marchandise, tient le stock et les fiches produits.',
    permissions: ['products.edit', 'stock.manage', 'purchases.view', 'purchases.manage', 'alerts.view'] },
  { name: 'Comptable', description: 'Suit les factures, les paiements et les chiffres, sans encaisser.',
    permissions: ['documents.view', 'documents.edit', 'payments.manage', 'reports.view', 'purchases.view', 'pos.journal', 'customers.manage'] },
];


/* ------------------------------------------------------------------ */
/* RBAC de la plateforme (console Comptoir)                            */
/* Permissions granulaires + rôles système, sur le modèle enterprise.  */
/* ------------------------------------------------------------------ */

export const PLATFORM_PERMISSIONS = [
  // Pilotage
  { key: 'platform.overview', group: 'Pilotage', label: 'Voir la vue d\'ensemble et les indicateurs' },
  { key: 'platform.todo', group: 'Pilotage', label: 'Voir la file « À traiter »' },
  { key: 'platform.activity', group: 'Pilotage', label: 'Voir la carte d\'activité des commerces' },
  { key: 'platform.revenue', group: 'Pilotage', label: 'Voir les revenus et le MRR' },
  { key: 'platform.events', group: 'Pilotage', label: 'Consulter le journal d\'événements' },
  // Commerces
  { key: 'platform.stores.view', group: 'Commerces', label: 'Lister et ouvrir les fiches commerces' },
  { key: 'platform.stores.edit', group: 'Commerces', label: 'Modifier un commerce (notes, statut, formule)' },
  { key: 'platform.stores.export', group: 'Commerces', label: 'Exporter la liste des commerces (CSV)' },
  // Support
  { key: 'platform.support.view', group: 'Support', label: 'Lire les conversations du support' },
  { key: 'platform.support.reply', group: 'Support', label: 'Répondre et prendre en charge les tickets' },
  // Utilisateurs
  { key: 'platform.users.view', group: 'Utilisateurs', label: 'Voir les comptes utilisateurs' },
  { key: 'platform.users.reset', group: 'Utilisateurs', label: 'Réinitialiser un mot de passe ou forcer la déconnexion' },
  // Système
  { key: 'platform.system.view', group: 'Système', label: 'Voir l\'état système, les stats API et les erreurs' },
  { key: 'platform.system.backups', group: 'Système', label: 'Gérer les sauvegardes (créer, vérifier, télécharger)' },
  // Équipe plateforme
  { key: 'platform.staff.view', group: 'Équipe', label: 'Voir l\'équipe de la plateforme et les rôles' },
  { key: 'platform.staff.manage', group: 'Équipe', label: 'Inviter, retirer ou changer le rôle d\'un membre' },
  { key: 'platform.roles.manage', group: 'Équipe', label: 'Créer et modifier les rôles de la plateforme' },
];
export const PLATFORM_PERMISSION_KEYS = PLATFORM_PERMISSIONS.map((p) => p.key);

// Rôles système : seedés à l\'init, non supprimables. « Propriétaire » = toutes les permissions.
export const DEFAULT_PLATFORM_ROLES = [
  {
    name: 'Propriétaire',
    description: 'Accès total à la console. Réservé aux fondateurs (souvent via PLATFORM_ADMIN_EMAILS).',
    system: true,
    permissions: [...PLATFORM_PERMISSION_KEYS],
  },
  {
    name: 'Administrateur',
    description: 'Pilotage opérationnel : commerces, support, utilisateurs, système. Ne gère pas les rôles critiques.',
    system: true,
    permissions: PLATFORM_PERMISSION_KEYS.filter((k) => k !== 'platform.roles.manage'),
  },
  {
    name: 'Support',
    description: 'Aide les commerçants : messagerie, fiches commerces, réinitialisation de mots de passe.',
    system: true,
    permissions: [
      'platform.overview', 'platform.todo', 'platform.stores.view', 'platform.stores.edit',
      'platform.support.view', 'platform.support.reply',
      'platform.users.view', 'platform.users.reset', 'platform.events',
    ],
  },
  {
    name: 'Analyste',
    description: 'Lecture seule des indicateurs, revenus, activité et commerces (pas de modification).',
    system: true,
    permissions: [
      'platform.overview', 'platform.todo', 'platform.activity', 'platform.revenue',
      'platform.events', 'platform.stores.view', 'platform.stores.export',
    ],
  },
  {
    name: 'Développeur',
    description: 'Surveillance technique : système, sauvegardes, journal, commerces en lecture.',
    system: true,
    permissions: [
      'platform.overview', 'platform.system.view', 'platform.system.backups',
      'platform.events', 'platform.stores.view',
    ],
  },
  {
    name: 'Marketing',
    description: 'Vue business : croissance, revenus, activité des commerces.',
    system: true,
    permissions: [
      'platform.overview', 'platform.activity', 'platform.revenue',
      'platform.stores.view', 'platform.stores.export',
    ],
  },
];
