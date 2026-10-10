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

### Espace commerce
- **Inscription en 2 minutes.** Le commerçant choisit son type de commerce : quincaillerie, épicerie, mode, beauté, téléphonie, librairie, maison ou autre. Il choisit aussi son pays : devise et TVA sont réglées automatiquement. Les catégories, les unités de vente et les produits d'exemple sont créés pour lui.
- **Caisse.**
  - Saisie : code-barres, remise, articles libres.
  - Encaissement : espèces avec monnaie à rendre, carte, chèque, virement, paiement mobile, ou plusieurs modes combinés.
  - Commandes téléphoniques mises de côté, ventes à crédit.
  - Ticket 80 mm et journal de caisse du jour.
- **Gestion.**
  - Stock suivi ou non selon le produit (les services ne sont pas suivis).
  - Alertes de rupture et d'impayés.
  - Devis, commandes et factures, paiements partiels, relances clients.
- **Équipe.** Le propriétaire crée des accès employés. Un employé tient la caisse et gère produits, stock, clients et documents, mais n'accède ni aux paramètres, ni à l'équipe, ni à l'abonnement.
- **Abonnement.** Le commerçant voit sa formule et son usage, et demande une formule payante.

### Console de la plateforme
- **Indicateurs** : commerces inscrits, actifs sur 7 et 30 jours, essais en cours et terminés, abonnés payants, revenu mensuel (MRR) et annuel.
- **Volume encaissé** par les commerces, **par devise** : on n'additionne jamais des euros et des dirhams.
- **Courbes** : commerces actifs par jour, inscriptions par mois.
- **Liste des commerces** avec un état de santé :
  - *nouveau* : inscrit depuis moins de 7 jours ;
  - *actif* : activité dans les 7 derniers jours ;
  - *à risque* : dernière activité il y a 8 à 21 jours ;
  - *inactif* : plus de 21 jours sans activité ;
  - *essai terminé* ou *suspendu*.

  Pour chacun : jours actifs sur 30, ventes, tickets, produits, équipe et vues de la vitrine.
- **Fiche commerce** : activité jour par jour, chiffres clés, contact, équipe, journal des événements.

  Actions possibles : changer de formule, suspendre ou réactiver, prolonger l'essai, prendre des notes internes, générer un mot de passe temporaire.
- **Demandes de formule** : un clic pour activer la formule une fois le paiement réglé avec le commerçant.

### Isolation des données
Une seule base, où chaque ligne porte l'identifiant de son commerce (`store_id`). **Toutes** les requêtes de l'espace commerce filtrent sur ce champ, y compris les jointures. Les produits cités dans un ticket ou une facture sont vérifiés : un commerce ne peut ni lire, ni modifier, ni vendre, ni déstocker les produits d'un autre. C'est testé automatiquement.

### Formules
Elles sont définies dans `src/catalog.js` (prix, limites de produits et d'utilisateurs) : Essai gratuit (14 jours), Essentiel, Pro, Business. À la fin de l'essai sans formule, ou en cas de suspension, l'espace passe en **lecture seule** et la vitrine d'un commerce suspendu est masquée.

---

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
