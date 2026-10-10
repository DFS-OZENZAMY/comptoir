# Comptoir

**La caisse, le stock, les factures et la vitrine en ligne des commerces de proximité.**

Comptoir est une plateforme SaaS multi-commerces. Chaque commerce s'inscrit en ligne et obtient son propre espace :

- une caisse ;
- la gestion du stock ;
- les devis, commandes et factures ;
- les alertes ;
- une équipe ;
- une vitrine publique à ses couleurs.

Le propriétaire de la plateforme pilote l'ensemble depuis une console : commerces, usage, santé, abonnements et revenus.

Hébergement : **Cloudflare Workers** (site, API, tâches planifiées) et **Cloudflare D1** (base de données). Aucun serveur à gérer.

---

## Les trois espaces

| Adresse | Pour qui | Contenu |
|---|---|---|
| `/` | Prospects | Site de présentation, tarifs, inscription |
| `/app/` | Commerçants et employés | Caisse, tableau de bord, alertes, commandes, devis, factures, produits, stock, clients, paramètres, équipe, abonnement |
| `/s/<nom-du-commerce>` | Clients des commerces | Catalogue public, prix et disponibilité, bouton d'appel |
| `/console/` | Vous | Vue d'ensemble, liste des commerces, fiche détaillée, demandes de formule |

### Espace commerce (`/app/`)
Il est conçu pour être simple au quotidien. Le menu compte six entrées, plus un grand bouton **Caisse** :
- **Accueil** : un grand bouton « Nouvelle vente », les ventes du jour, du mois et le montant à encaisser. On y trouve aussi les raccourcis (ajouter un produit, réceptionner du stock, faire un devis ou une facture, partager la vitrine) et la liste **À faire**, écrite simplement : factures à relancer, commandes à préparer, ruptures, échéances et devis en attente. Les meilleures ventes complètent l'écran.
- **Ventes** : commandes, devis et factures.
- **Produits** : catalogue et stock.
- **Clients** et **Alertes**.
- **Réglages** : commerce et vitrine, équipe, abonnement. Cette entrée est réservée au propriétaire.

La **fiche produit** demande l'essentiel : photo, nom, prix de vente TTC (le prix que paie le client), quantité en stock et catégorie. Le reste (référence, code-barres, TVA, prix d'achat et marge, unité, seuil d'alerte) se trouve sous « Plus d'options ».

**Sur téléphone**, une barre de navigation en bas d'écran donne accès à Accueil, Ventes, Produits et Plus, avec un bouton central « Vendre ». Dans la caisse, une barre fixe affiche le total et le bouton Encaisser.

Inscription en 2 minutes : le commerçant choisit son type de commerce et son pays. Les catégories, les unités de vente, la devise, la TVA et des produits d'exemple sont prêts à son arrivée.

### Console de la plateforme (`/console/`)
- **Vue d'ensemble.** Elle s'ouvre sur les éléments à traiter. On y trouve :
  - les indicateurs avec leur évolution sur 7 jours ;
  - les commerces actifs par jour et la courbe de croissance ;
  - l'entonnoir de conversion (inscrits, configurés, première vente, réguliers, payants) et le délai médian avant la première vente ;
  - l'adoption de chaque fonction ;
  - le volume encaissé par devise, comparé au mois précédent ;
  - la santé des commerces et leur répartition par métier et par pays.
- **À traiter.** Les demandes de formule, les essais qui se terminent ou terminés sans abonnement, les clients payants devenus inactifs, les nouveaux commerces sans première vente, les erreurs serveur, une tâche du matin manquée et la configuration incomplète.
- **Commerces.** Pour chacun : son état de santé, une mini-courbe d'activité sur 30 jours, sa dernière activité et sa dernière vente, ses ventes, ses tickets, ses produits et les vues de sa vitrine. On peut filtrer, trier et exporter la liste en CSV.
- **Fiche commerce** (panneau latéral) :
  - *Aperçu* : chiffres clés, activité et ventes jour par jour, contact ;
  - *Utilisation* : score d'adoption et fonctions utilisées ou non ;
  - *Abonnement* : formule, suspension, prolongation d'essai, notes internes ;
  - *Équipe* : mots de passe temporaires ;
  - *Journal* des événements.
- **Activité.** Une carte de chaleur, un commerce par ligne et un jour par case, sur 30 jours.
- **Revenus.** L'évolution du revenu mensuel, la répartition par formule, le revenu moyen par abonné, la conversion des essais, les essais en cours et les abonnés payants.
- **Système.** L'état de la plateforme, les appels et les temps de réponse heure par heure, le trafic sur 30 jours, les fonctions les plus appelées et les plus lentes, les dernières erreurs serveur, la configuration, la tâche du matin, la taille de la base et le volume de chaque table.
- **Journal** filtrable et **Utilisateurs** : sessions, déconnexion forcée, mot de passe temporaire.
- **Recherche rapide** d'un commerce (Ctrl K) et mise à jour automatique des chiffres toutes les minutes.

Le monitoring repose sur trois tables alimentées automatiquement :
- `api_stats` : appels, erreurs et durées, par heure et par fonction ;
- `error_log` : les erreurs serveur ;
- `platform_daily` : un instantané quotidien de la plateforme, qui alimente les courbes de croissance et de revenu.

La tâche du matin purge l'ancien trafic (31 jours), les anciennes erreurs (90 jours) et les sessions expirées.

### Isolation des données
Une seule base, où chaque ligne porte l'identifiant de son commerce (`store_id`). **Toutes** les requêtes de l'espace commerce filtrent sur ce champ, y compris les jointures. Les produits cités dans un ticket ou une facture sont vérifiés : un commerce ne peut ni lire, ni modifier, ni vendre, ni déstocker les produits d'un autre. C'est testé automatiquement.

### Formules
Elles sont définies dans `src/catalog.js` (prix, limites de produits et d'utilisateurs) : Essai gratuit (14 jours), Essentiel, Pro, Business. À la fin de l'essai sans formule, ou en cas de suspension, l'espace passe en **lecture seule** et la vitrine d'un commerce suspendu est masquée.

---

## Design

Maquettes et système de design : **https://www.figma.com/design/76wfHUeIuxJcFzAcIjRSbr**
- **Fondations** : 17 couleurs, espacements, arrondis, 14 styles de texte, et 11 composants (bouton, pastille, badge, indicateur, tâche, tuile de caisse, carte produit, champ, ligne de ticket, menu, barre mobile).
- **Site et vitrine** : site de présentation et vitrine d'un commerce, en version ordinateur et téléphone.

Les mêmes jetons sont utilisés dans le code (variables CSS en tête de `public/app/app.css`, `public/assets/site.css` et `public/store/store.css`) :
- encre `#17181C`, fond `#F4F4F1`, bordures `#E3E3DF`, vermillon `#E4572E` ;
- polices : Archivo pour l'interface, **Archivo Narrow** pour les titres, **IBM Plex Mono** pour tout ce qui ressemble à un ticket de caisse ;
- arrondis : 8 px pour les contrôles, 12 px pour les cartes, 16 px pour les grandes tuiles.

L'élément signature est le **ticket de caisse au bord dentelé** : image d'accueil du site et panier en cours de la caisse.

## Mise en ligne sur Cloudflare

1. **Workers & Pages**, **Create**, **Import a repository**, puis choisir ce dépôt. Le nom du Worker doit être `comptoir` (champ `name` de `wrangler.jsonc`). La base D1 `comptoir-data` est créée automatiquement au premier déploiement.
2. Dans le Worker, **Settings**, **Variables and secrets** :
   - `PLATFORM_ADMIN_EMAILS` (texte) : votre adresse e-mail, ou plusieurs séparées par des virgules. Ces comptes ont accès à `/console/`.
   - `APP_URL` (texte, facultatif) : l'adresse publique, par exemple `https://comptoir.app`. Elle sert aux liens des e-mails.
   - `RESEND_API_KEY` (secret, facultatif) : active les e-mails d'alertes du matin pour les commerçants.
   - `MAIL_FROM` (texte, facultatif) : l'expéditeur, par exemple `Comptoir <alertes@comptoir.app>`. Il faut un domaine vérifié chez Resend.
3. Ouvrez `/app/#/inscription` et créez votre compte **avec l'adresse indiquée dans `PLATFORM_ADMIN_EMAILS`**. Votre commerce sert de boutique de démonstration, et le lien « Console plateforme » apparaît dans votre menu.
4. Facultatif : ajoutez votre nom de domaine dans **Settings**, **Domains & Routes**.

Chaque `git push` sur `main` redéploie la plateforme.

## Développement local

```bash
npm install
cp .dev.vars.example .dev.vars   # mettre votre e-mail dans PLATFORM_ADMIN_EMAILS
npm run dev                      # http://localhost:8787
```

## Structure

```
src/
  worker.js     Routage : site, vitrines /s/<slug>, API, tâche planifiée
  auth.js       Inscription, connexion, sessions, création des commerces
  store.js      Espace commerce (toujours filtré par store_id)
  console.js    Console de la plateforme
  catalog.js    Nom, formules, pays, modèles de commerce
  db.js         Schéma, migrations, compteurs d'usage, journal
  lib.js        Outils : HTTP, validation, chiffrement des mots de passe
public/
  index.html    Site de présentation
  app/          Espace commerce
  store/        Vitrine publique
  console/      Console de la plateforme
```

## Sécurité
- Mots de passe chiffrés avec PBKDF2-SHA256, 100 000 itérations et sel aléatoire.
- Sessions : jeton aléatoire, dont seule l'empreinte SHA-256 est stockée en base. Cookie HttpOnly, Secure, SameSite=Lax, valable 30 jours.
- Rôles vérifiés côté serveur. Les accès employés utilisent un mot de passe temporaire, à changer à la première connexion.

## Avant de commercialiser : ce qu'il reste à prévoir
- **Paiement des abonnements** : aujourd'hui les demandes de formule sont validées à la main dans la console. Brancher Stripe, ou un prestataire local (CMI au Maroc, Wave ou Orange Money en Afrique de l'Ouest), permettra des abonnements automatiques.
- **Mot de passe oublié par e-mail** : le propriétaire ou la console génèrent aujourd'hui un mot de passe temporaire.
- **Caisse en France** : les commerçants assujettis à la TVA qui encaissent des particuliers doivent utiliser un logiciel de caisse **certifié** (NF525 ou équivalent). Prévoir la certification, ou réserver la caisse aux marchés qui ne l'exigent pas.
- **Juridique** : CGU et CGV de la plateforme, politique de confidentialité (RGPD), contrat de sous-traitance des données des commerçants.
- **Anti-abus** : un captcha (Cloudflare Turnstile) sur l'inscription.
- **Volumétrie** : D1 accepte jusqu'à 10 Go par base, ce qui suffit pour plusieurs milliers de commerces. Au-delà, prévoir une base par groupe de commerces.
