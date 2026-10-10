// Configuration de la plateforme : nom, formules d'abonnement, pays et modèles de commerce.

export const PLATFORM = {
  name: 'Comptoir',
  tagline: 'La caisse, le stock et la vitrine en ligne de votre commerce.',
  trialDays: 14,
};

// Limites : null = illimité. Prix mensuel HT dans la devise de facturation de la plateforme.
export const PLANS = {
  essai: { name: 'Essai gratuit', price: 0, products: 1000, users: 3, description: 'Toutes les fonctions pendant 14 jours.' },
  essentiel: { name: 'Essentiel', price: 19, products: 300, users: 1, description: 'Caisse, stock et vitrine pour démarrer.' },
  pro: { name: 'Pro', price: 39, products: 5000, users: 5, description: 'Devis, factures, alertes et équipe.' },
  business: { name: 'Business', price: 79, products: null, users: 20, description: 'Sans limite de produits, équipe étendue.' },
};
export const PAID_PLANS = ['essentiel', 'pro', 'business'];

export const COUNTRIES = {
  FR: { name: 'France', currency: '€', tva: 20 },
  BE: { name: 'Belgique', currency: '€', tva: 21 },
  CH: { name: 'Suisse', currency: 'CHF', tva: 8.1 },
  LU: { name: 'Luxembourg', currency: '€', tva: 17 },
  MA: { name: 'Maroc', currency: 'DH', tva: 20 },
  DZ: { name: 'Algérie', currency: 'DA', tva: 19 },
  TN: { name: 'Tunisie', currency: 'DT', tva: 19 },
  SN: { name: 'Sénégal', currency: 'FCFA', tva: 18 },
  CI: { name: "Côte d'Ivoire", currency: 'FCFA', tva: 18 },
  CM: { name: 'Cameroun', currency: 'FCFA', tva: 19.25 },
  CA: { name: 'Canada (Québec)', currency: '$', tva: 14.975 },
  XX: { name: 'Autre pays', currency: '€', tva: 20 },
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

export function defaultSettings({ name, phone = '', email = '', country = 'FR', type = 'autre' }) {
  const c = COUNTRIES[country] || COUNTRIES.XX;
  const t = BUSINESS_TYPES[type] || BUSINESS_TYPES.autre;
  return {
    shop_name: name, tagline: t.tagline, address: '', phone, email, hours: '',
    currency: c.currency, tva_default: String(c.tva), invoice_due_days: '30',
    legal_info: '', bank_info: '', doc_footer: 'Merci pour votre confiance.',
    accent: t.accent, alert_email: email, alert_digest: '0', due_soon_days: '7',
    catalog_public: '1', show_prices: '1', show_stock: '1',
  };
}
export const SETTING_KEYS = Object.keys(defaultSettings({ name: '' }));
