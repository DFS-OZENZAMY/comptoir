# Fonctionnalités de Comptoir

Catalogue détaillé de ce que fait la plateforme, fonction par fonction. Pour l'organisation du code, voir [ARCHITECTURE.md](ARCHITECTURE.md).

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
Elles sont définies dans `src/core/catalog.js` (prix, limites de produits et d'utilisateurs) : Essai gratuit (14 jours), Essentiel, Pro, Business. À la fin de l'essai sans formule, ou en cas de suspension, l'espace passe en **lecture seule** et la vitrine d'un commerce suspendu est masquée.

---

## Import des produits depuis un ancien logiciel

**Produits, Importer** récupère le catalogue d'un autre outil, en CSV ou en Excel (.xlsx) :
- **logiciels reconnus automatiquement** : Loyverse, Square, Shopify, WooCommerce, Odoo, Stock Express et Stock Standard (Klick), EBP et Sage (intitulés français), et le modèle Comptoir. Pour les cellules à plusieurs codes-barres, le premier est gardé ;
- **tout autre tableau** se fait correspondre à la main.

**Côté navigateur** (`public/app/import.js`, chargé seulement sur cette page) :
- **lecture** :
  - CSV avec séparateur `;` `,` ou tabulation, en UTF-8 ou en Windows-1252 (CSV d'Excel français) ;
  - XLSX lu avec la décompression intégrée au navigateur, sans bibliothèque externe ;
  - le fichier n'est jamais envoyé tel quel.
- **correspondance des colonnes**, en français et en anglais : nom, variante, référence, code-barres, catégorie, prix (HT ou TTC selon l'intitulé ou le logiciel), prix d'achat, TVA, seuil, unité, description et stock.
- **nettoyage** :
  - prix « 1 234,50 € » ;
  - catégories en chemin (« Épicerie > Miel ») ;
  - variantes Shopify et Loyverse sur plusieurs lignes (nom, catégorie et description hérités) ;
  - lignes d'images ignorées ;
  - produits parents WooCommerce et articles archivés Square ignorés ;
  - « vendu au poids » transformé en kg ;
  - codes-barres abîmés par Excel (format scientifique) signalés.
- **stock par magasin** : chaque colonne « In stock [Magasin] » ou « Current Quantity Magasin » est rapprochée de la boutique Comptoir du même nom.
- **aperçu** avant import (à créer, à mettre à jour, erreurs), puis envoi par lots de 200 lignes avec une barre de progression.

**Import direct d'une base de données**, quand le logiciel n'a pas d'export. La base est lue **dans le navigateur** et n'est jamais envoyée : seuls les produits partent vers le serveur.
- **formats** :
  - **SQLite** (.db, .sqlite), lu par sql.js 1.13.0 (`public/vendor/sqljs/`) ;
  - **Access** (.mdb, .accdb), lu par mdb-reader 3.2.0, assemblé pour le navigateur (`public/vendor/mdb/`) ;
  - **dBase** (.dbf), lecteur intégré ;
  - **archive .zip** (sauvegarde ou dossier) : la plus grande base lisible qu'elle contient est ouverte.

  Les lecteurs ne sont chargés que lorsqu'une base est déposée.
- **table des produits choisie automatiquement**, d'après ses colonnes et son nom, en écartant les factures, clients et mouvements. Le commerçant peut en choisir une autre.
- **identifiants remplacés par leurs libellés** : famille, catégorie, marque, unité ou TVA rangées dans une autre table.
- **stock rangé dans une table à part** (produit, dépôt, quantité) : une colonne « Quantité <dépôt> » par dépôt, rapprochée des boutiques Comptoir.
- **noms de colonnes de base de données compris** : « PrixVenteHT », « code_barre », « QteStock », « PV », « PA », « PMP », et les noms tronqués à 10 caractères de dBase (« DESIGNATIO »).
- **formats illisibles dans un navigateur**, avec un message qui oriente vers l'export du logiciel : SQL Server (.mdf), SQL Server Compact (.sdf), Firebird (.fdb), LiteDB, HFSQL (WinDev).
- **le format est reconnu à son contenu, pas à son extension** : un `.stockdb` qui contient une base SQLite, Access ou une archive est lu normalement. Un fichier binaire inconnu n'est jamais lu comme du texte : un message clair s'affiche, avec la signature des premiers octets à transmettre au support.
- **Encodage des fichiers texte**, détecté automatiquement : UTF-8 (avec ou sans marque), UTF-16 avec ou sans marque (exports « Unicode » des logiciels Windows), Windows européen (1252) ou arabe (1256) selon les lettres obtenues. Les fichiers dBase utilisent leur page de code. L'aperçu permet d'imposer un autre encodage (UTF-8, UTF-16, Windows Europe, Windows arabe, DOS 850). Les caractères de contrôle sont retirés des valeurs.
- **Champ de fichier sans filtre d'extension**, pour accepter les formats propres à chaque logiciel.

**Connexion directe aux outils en ligne** (`src/features/connectors.js`) : Loyverse, Square, Shopify, WooCommerce et Odoo.
- **Détection de l'outil** (`POST /api/store/connect/detect`) :
  - **par la clé collée** : `shpat_` pour Shopify, `EAAA` pour Square, `ck_` pour WooCommerce, 32 caractères hexadécimaux pour Loyverse, 40 pour Odoo ;
  - **par l'adresse de la boutique** : la page d'accueil est lue, ce qui révèle un site Shopify (et son adresse myshopify), WooCommerce, Odoo ou Square Online.

  Seules les adresses `https` publiques sont acceptées ; localhost, les adresses IP et les réseaux internes sont refusés.
- **Récupération page par page** (`POST /api/store/connect/fetch`) : produits, variantes, codes-barres, catégories, prix, coût, TVA (Odoo), seuils, unités, stock par magasin (Loyverse, Square) et photos. Le résultat est transformé en feuille commune, qui passe par le même aperçu et le même import qu'un fichier.
  - **Shopify** : jeton `shpat_` d'une application existante, ou identifiant et secret client d'une application du Dev Dashboard (jeton obtenu par « client credentials »). Les nouvelles applications personnalisées ne peuvent plus être créées depuis l'administration Shopify depuis le 1er janvier 2026.
  - **Square** : montants convertis depuis l'unité minimale de la devise (centimes, sauf devises sans décimales comme le XOF).
- **Clés d'accès** : jamais enregistrées ni journalisées. Le navigateur les renvoie à chaque page, et le curseur de pagination n'en contient aucune.
- **Photos** (`POST /api/store/import/images`, par lots de 12) : téléchargées après l'import, en JPEG, PNG ou WebP, 1 Mo au plus. Les images Shopify sont demandées en 800 px.
- **Logiciel déclaré à l'inscription** (« Votre logiciel actuel », réglage `previous_tool`) : la page d'import propose directement le bon outil.

**Côté serveur** (`src/features/importer.js`, `POST /api/store/import/products`) :
- **contrôles** : droit « produits », droit « stock » pour les quantités, limite de produits de la formule, 500 lignes au plus par envoi, valeurs vérifiées, boutiques autorisées seulement.
- **rapprochement** avec les produits existants par code-barres, puis référence, puis nom : mise à jour ou ignoré, au choix. Les doublons du fichier sont fusionnés.
- **création** des catégories manquantes.
- **stock** réparti par boutique, chaque quantité étant tracée dans les mouvements (« Import Loyverse »…). Les produits d'exemple jamais vendus peuvent être retirés.

**Modèle Comptoir** téléchargeable depuis la page. Guide : `/aide/importer-ses-produits`.

## Application installable (ordinateur et téléphone)

L'espace commerçant s'installe comme une application : icône sur l'écran d'accueil ou le bureau, fenêtre à part, ouverture directe sur le workspace, sans passer par le site.

- **Manifeste** (`public/manifest.webmanifest`) :
  - démarre sur `/app/`, avec une portée limitée à `/app/` ;
  - icônes standard et adaptatives (`assets/icon-*.png`) ;
  - **raccourcis** Caisse, Produits et Rapports (appui long ou clic droit sur l'icône) ;
  - captures d'écran pour la fenêtre d'installation (`assets/install/`).
- **Service worker** (`public/app/sw.js`) :
  - les données (`/api/`) viennent **toujours du serveur**, sans copie ; hors ligne, elles renvoient un message clair ;
  - le code de l'application vient du réseau d'abord, et se met donc à jour à chaque déploiement ;
  - les polices et icônes sont gardées en mémoire ;
  - sans connexion, la page `/app/offline` s'affiche et se recharge seule au retour d'internet.

  Après un changement important de `sw.js`, modifiez sa constante `VERSION`.
- **Installation dans l'espace** :
  - un bouton « Installer l'application » dans le menu et dans « Plus » ;
  - une carte sur l'Accueil, qui peut être masquée ;
  - sur Chrome et Edge (Android, Windows, Mac, Chromebook), la fenêtre d'installation du navigateur ;
  - sur iPhone, iPad et Safari pour Mac, la marche à suivre pas à pas (Partager, puis « Sur l'écran d'accueil » ; ou Fichier, puis « Ajouter au Dock »).

  Rien ne s'affiche une fois l'application installée.
- **Diagnostic** : Chrome ne signale aucun obstacle à l'installation (`Page.getInstallabilityErrors` vide).

Comptoir ne fonctionne pas hors ligne : les ventes et le stock sont enregistrés en direct pour rester justes sur tous les appareils.

## Centre d'aide

Des guides courts pour les commerçants, à l'adresse `/aide`, avec une recherche :
1. Bien démarrer
2. Encaisser à la caisse
3. Produits et stock
4. Devis, commandes et factures
5. Clients et fidélité
6. Vitrine en ligne et commandes WhatsApp
7. Plusieurs boutiques et rapports
8. Équipe et droits
9. Réglages, alertes et abonnement
10. Questions fréquentes

- **Dans l'espace commerçant** : un bouton « ? Aide » à côté du titre ouvre le guide de l'écran en cours, dans un nouvel onglet. Un lien « Centre d'aide » se trouve dans le menu, et dans « Plus » sur téléphone. L'encart « Pour bien démarrer » renvoie au guide complet.
- **Pages publiques** rendues côté serveur, présentes dans le plan du site, avec données structurées (`TechArticle`, `FAQPage`) : elles aident aussi le référencement.
- **Mise à jour** : le contenu est dans `GUIDES`, dans `src/features/help.js`, et le lien de chaque écran vers son guide dans `HELP_FOR`, dans `public/app/app.js`. Pensez à les mettre à jour quand une fonction change.

## Tarifs par pays

Les formules sont affichées dans la devise du visiteur, avec des **prix ronds pensés pour chaque marché** (`LOCAL_PRICES`, dans `src/core/catalog.js`) :

| Devise | Essentiel | Pro | Business |
|---|---|---|---|
| € (France, Belgique, Luxembourg) | 19 € | 39 € | 79 € |
| DH (Maroc) | 199 DH | 419 DH | 849 DH |
| DA (Algérie) | 2 900 DA | 5 900 DA | 11 900 DA |
| DT (Tunisie) | 59 DT | 119 DT | 249 DT |
| FCFA (Sénégal, Côte d'Ivoire, Cameroun) | 12 500 | 25 000 | 49 000 |
| CHF (Suisse) | 19 CHF | 39 CHF | 79 CHF |
| $ (Canada) | 29 $ | 59 $ | 119 $ |

- **Pays du visiteur** : son choix (`?pays=MA`, mémorisé dans le cookie `cp_pays`), sinon la détection de Cloudflare, sinon la France. Un sélecteur « Tarifs pour » permet d'en changer, et les données structurées pour Google suivent la même devise.
- **Commerçants** : la page Abonnement affiche les prix dans la devise du pays du commerce.
- **Console** : le revenu mensuel additionne les abonnements convertis en équivalent euros, au taux indicatif `eur` de `LOCAL_PRICES`.

## Commande WhatsApp depuis la vitrine

- **Réglages**, rubrique « Commandes WhatsApp » : le numéro du commerce, en format local accepté (l'indicatif du pays est ajouté automatiquement par `waNumber`), et un interrupteur pour activer la commande.
- **Vitrine** :
  - un bouton « Ajouter » sur chaque produit, qui devient un sélecteur de quantité ;
  - une barre « Voir le panier » ;
  - un panier avec le nom du client, retrait ou livraison avec adresse, et une remarque ;
  - « Envoyer la commande sur WhatsApp » ouvre WhatsApp avec un message déjà rédigé : articles, références, prix, total estimé et coordonnées.

  Le panier est gardé sur le téléphone du client. La commande passe directement du client au commerçant, sans transiter par Comptoir.
- **Barre du haut** : un bouton WhatsApp pour écrire directement au commerce.

## Programme de fidélité

- **Réglages**, rubrique « Programme de fidélité » : activation, montant dépensé pour gagner 1 point, nombre de points pour une récompense et valeur de la récompense. Un aperçu indique le pourcentage reversé. Les valeurs par défaut reversent environ 5 % ; au Maroc, par exemple, 1 point par 10 DH et 100 points = 50 DH.
- **Caisse** : le solde du client sélectionné s'affiche, avec le bouton « Utiliser 100 points (− 50 DH) ». Il n'est utilisable que sur un panier d'au moins la valeur de la récompense, pour que le client ne perde rien. Les points sont gagnés sur le montant réellement payé.
- **Contrôles côté serveur** : solde suffisant, montant de la récompense plafonné, une seule récompense par vente. La récompense est accessible même sans le droit de remise, car il s'agit d'un avantage programmé et non d'une remise libre. Si le ticket est annulé, les points sont rendus.
- **Fiches clients** : colonne « Points », historique des mouvements et ajustement manuel (droit « clients »).
- **Ticket imprimé** : points gagnés et nouveau solde.
- **Vitrine** : un encart présente le programme aux clients.

## Pages légales

`/mentions-legales`, `/cgu`, `/cgv` et `/confidentialite`. Elles couvrent le RGPD, la loi marocaine 09-08 et la CNDP, et rappellent les obligations fiscales du commerçant, dont la certification NF525 en France. Elles sont liées depuis toutes les pages publiques, la vitrine et l'inscription.

Les informations de l'éditeur se règlent dans **Cloudflare, Settings, Variables** :

| Variable | Contenu |
|---|---|
| `LEGAL_NAME` | Raison sociale |
| `LEGAL_FORM` | Forme juridique et capital |
| `LEGAL_ADDRESS` | Adresse du siège |
| `LEGAL_ID` | RC, ICE, IF ou SIRET |
| `LEGAL_DIRECTOR` | Directeur de la publication |
| `LEGAL_EMAIL`, `LEGAL_PHONE` | Contact |
| `LEGAL_CNDP` | Numéro de déclaration CNDP |
| `LEGAL_LAW` | Droit applicable, par exemple « droit marocain » |
| `LEGAL_COURT` | Tribunaux compétents |

Tant qu'une information manque, elle s'affiche surlignée « [à compléter] » et les pages ne sont pas indexées par Google. **Faites relire ces textes par un juriste avant le lancement commercial.**

## Plusieurs boutiques

Un commerce peut avoir plusieurs points de vente : 1 boutique en Essentiel, 3 en Pro et en essai, sans limite en Business.

- **Boutiques** (Réglages, Boutiques) : nom, adresse et téléphone. Une boutique peut être fermée ; son historique est conservé, mais son stock doit d'abord être transféré.
- **Ventes rattachées** : chaque ticket, facture, commande et devis enregistre la boutique où il a été fait. Une conversion (devis → facture…) reste dans la même boutique.
- **Stock par boutique** (`location_stock`) : les ventes, entrées, sorties et inventaires touchent la boutique concernée. Le **transfert entre boutiques** déplace le stock sans changer le total. `products.stock` reste le total du commerce, utilisé par les alertes et la vitrine.
- **Sélecteur de boutique** dans le menu, et dans « Plus » sur téléphone. « Toutes les boutiques » est proposé à ceux qui y ont accès. Tableau de bord, ventes, journal de caisse et mouvements suivent la boutique choisie. En vue globale, la caisse demande où l'on encaisse.
- **Rapports** (`/api/store/locations/report`), sur 7 ou 30 jours, le mois en cours, le mois précédent ou l'année :
  - chiffre d'affaires et part de chaque boutique, avec le classement ;
  - évolution par rapport à la période précédente ;
  - nombre de ventes et panier moyen ;
  - **marge brute**, calculée sur les produits qui ont un prix d'achat, avec le taux de couverture ;
  - impayés, valeur du stock et ruptures ;
  - 6 derniers mois et meilleures ventes de chaque boutique.
- **Mise à jour des commerces existants** : à leur première connexion, une « Boutique principale » est créée automatiquement. Elle reçoit tout l'historique et le stock actuel.

## Équipe, rôles et permissions (RBAC)

- **16 permissions** (`PERMISSIONS`, dans `src/core/catalog.js`), en 6 groupes :
  - caisse : encaisser, remises et changement de prix, crédit et mise de côté, journal ;
  - produits et stock ;
  - clients ;
  - ventes : voir, modifier, paiements et relances ;
  - pilotage : chiffres et rapports, alertes ;
  - administration : réglages, boutiques, équipe, abonnement.
- **4 rôles par défaut**, modifiables :
  - **Gérant** : tout le quotidien, sans l'administration ;
  - **Caissier** : caisse, journal et clients ;
  - **Magasinier** : produits, stock et alertes ;
  - **Comptable** : ventes, paiements, chiffres et journal.

  Des **rôles personnalisés** se créent en cochant les permissions voulues. Le **propriétaire** a toujours toutes les permissions et ne peut pas être modifié.
- **Accès par boutique** : chaque membre a un rôle et un accès à toutes les boutiques ou seulement à certaines. Un membre limité à une boutique ne voit et ne vend que dans celle-ci.
- **Contrôle côté serveur** (`guard`, dans `src/features/store.js`, et `resolveAccess`, dans `src/features/access.js`) : chaque route vérifie sa permission, quelle que soit l'interface. Sans le droit de remise, impossible d'appliquer une remise ou de vendre en dessous du prix du produit. Un changement de rôle s'applique **immédiatement**, sans reconnexion.
- **Interface** : menus, rubriques et boutons s'affichent selon les permissions. Un membre sans accès aux chiffres arrive directement sur la caisse.
- **Mise à jour** : les employés existants reçoivent le rôle « Gérant », qui correspond exactement à leurs droits d'avant.

## Référencement naturel (SEO)

Les pages publiques sont **rendues côté serveur** (`src/features/seo.js`) : Google lit leur contenu sans exécuter de JavaScript.

- **Accueil (`/`)** :
  - titre, description et adresse canonique ;
  - balises de partage (Open Graph, Twitter) avec l'image `assets/og-image.png` ;
  - données structurées : `Organization`, `WebSite`, `SoftwareApplication` (tarifs) et `FAQPage` ;
  - tarifs et liens vers les métiers directement dans le HTML.
- **Pages métier (`/logiciel-de-caisse/…`)** : 7 pages ciblant les recherches des commerçants (quincaillerie, épicerie, mode, beauté, téléphonie, librairie, décoration). Chacune a son texte, ses avantages, sa FAQ, son fil d'Ariane et ses liens croisés. La page `/logiciel-de-caisse/` les regroupe. Le contenu se modifie dans `METIERS`, dans `src/features/seo.js`.
- **Vitrines (`/s/<commerce>`)** :
  - titre et description propres à chaque commerce ;
  - produits, prix et disponibilité dans le HTML ;
  - données structurées `Store` : adresse, téléphone et catalogue d'offres avec prix et disponibilité ;
  - erreur 404 réelle pour un commerce inconnu ou suspendu.
- **`/sitemap.xml`** : généré automatiquement, il inclut chaque vitrine publique dès qu'elle a des produits. **`/robots.txt`** ferme `/app/`, `/console/` et `/api/` aux moteurs de recherche, sauf les images de produits.
- **Domaine unique** : si `APP_URL` est réglé (par exemple `https://comptoir.app`), toute autre adresse, dont `*.workers.dev`, redirige vers lui pour éviter le contenu en double.

**Après la mise en ligne sur votre domaine** : déclarez le site dans Google Search Console, puis soumettez `https://votre-domaine/sitemap.xml`.

## Performances

- **Polices hébergées sur le site** (`public/assets/fonts/`, 75 Ko en woff2, latin) et préchargées : aucune requête vers Google Fonts, ce qui est aussi plus simple pour le RGPD.
- **Espace commerçant et console** :
  - mémoire courte de 30 secondes pour les lectures, vidée à chaque modification ;
  - préchargement des données d'une rubrique dès le survol ou le toucher de son lien, et des rubriques principales après la connexion ;
  - « Chargement… » affiché seulement au-delà de 180 ms.

  Résultat : environ 80 ms pour changer de rubrique.
- **Compteurs du menu** : une seule requête légère (`/api/store/badges`) au lieu de charger les alertes et toutes les commandes.
- **Console** : l'instantané quotidien est réécrit au plus toutes les 15 minutes.
- **Vitrine** : les données arrivent avec la page, sans appel supplémentaire à l'API.
- **Cache navigateur** (`public/_headers`) : polices mises en cache pour un an, images pour une semaine.

## Design

Maquettes et système de design : **https://www.figma.com/design/3CaB0cSmhpdObFGUVA9Ktm**

Export consultable sans compte Figma, jetons de design et règles : voir le dossier [`design/`](design/README.md).
- **Fondations** : 17 couleurs, espacements, arrondis, 14 styles de texte, et 11 composants (bouton, pastille, badge, indicateur, tâche, tuile de caisse, carte produit, champ, ligne de ticket, menu, barre mobile).
- **Site et vitrine** : site de présentation et vitrine d'un commerce, en version ordinateur et téléphone.

Les mêmes jetons sont utilisés dans le code (variables CSS en tête de `public/app/app.css`, `public/assets/site.css` et `public/store/store.css`) :
- encre `#17181C`, fond `#F4F4F1`, bordures `#E3E3DF`, vermillon `#E4572E` ;
- polices : Archivo pour l'interface, **Archivo Narrow** pour les titres, **IBM Plex Mono** pour tout ce qui ressemble à un ticket de caisse ;
- arrondis : 8 px pour les contrôles, 12 px pour les cartes, 16 px pour les grandes tuiles.

L'élément signature est le **ticket de caisse au bord dentelé** : image d'accueil du site et panier en cours de la caisse.

## Notifications push

Chaque personne peut être prévenue sur son téléphone ou son ordinateur, **même quand Comptoir est fermé** (écran **Notifications**, dans le menu ; carte d'invitation sur l'accueil).

| Catégorie | Quand | Qui la reçoit |
|---|---|---|
| Stock bas et ruptures | aussitôt après une vente, une sortie ou un transfert qui fait passer un produit sous son seuil ; résumé chaque matin | droits « alertes » ou « stock », pour ses boutiques |
| Factures en retard et échéances | chaque matin | droits « alertes » ou « paiements » |
| Essai et abonnement | 3 jours avant la fin de l'essai | droit « abonnement » |
| Plateforme | nouvelle inscription, demande de formule, sauvegarde en échec | administrateurs de la plateforme |

- Préférences **par appareil**, notification d'essai, désactivation, liste des autres appareils de la personne.
- Une même alerte au plus **une fois par jour** ; les appareils désinstallés sont retirés automatiquement.
- Le contenu est **chiffré pour l'appareil** (RFC 8291) : le service de notification (Google, Apple, Mozilla, Microsoft) ne peut pas le lire. Seuls ces services sont acceptés comme destination.
- Fonctionne sur Android, Windows, Mac, Chromebook (Chrome, Edge, Firefox) et sur iPhone ou iPad (iOS 16.4 ou plus) **une fois Comptoir installé sur l'écran d'accueil**.
