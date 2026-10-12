# Feuille de route

Mise à jour : 12 octobre 2026. Ce document consigne l'étude du marché et les priorités. Il guide les prochaines évolutions.

**Suivi** : chaque fonction a son ticket GitHub, rangé dans le tableau [Comptoir — Feuille de route](https://github.com/users/DFS-OZENZAMY/projects/4) (priorité, effort, jalon, statut). Ce document donne la vue d'ensemble ; le détail et l'avancement sont dans les tickets.

**Tenue de la todo** : avant de commencer un ticket, l'assigner et le passer « En cours » ; à la livraison, commenter ce qui a été fait et vérifié, fermer le ticket, le passer « Terminé », et le déplacer dans « Fait » ci-dessous. Toute nouvelle tâche repérée (bogue, idée, action manuelle) reçoit un ticket.

**À faire par le propriétaire** (comptes, sécurité, sauvegardes, juridique, essais sur appareils réels) : ticket épinglé #17.

## Ce que dit le marché

### Réglementation : la facture électronique devient obligatoire
- **France** : réception obligatoire pour toutes les entreprises depuis le **1er septembre 2026** ; **émission et e-reporting** (dont les ventes aux particuliers, donc la caisse) obligatoires pour les **TPE, PME et micro-entreprises au 1er septembre 2027**. Formats : Factur-X, UBL, CII, via une plateforme agréée. Un PDF envoyé par e-mail n'est pas une facture électronique.
- **Maroc** : déploiement progressif depuis 2026 (grandes entreprises, puis entreprises moyennes ; calendrier des petites entreprises pas encore officialisé), modèle centralisé de la DGI avec validation (« clearance »), format **UBL** retenu.
- **Conséquence** : produire des factures structurées (UBL / CII) et préparer l'e-reporting est un argument de vente majeur pour 2027.

### Concurrence (exemple : Inyad, Maroc, 250 000 professionnels revendiqués)
- Formules à **149 / 249 DH HT par mois** (Comptoir : 199 / 419 / 849 DH). **La formule Pro de Comptoir coûte presque deux fois plus cher** : décision commerciale à prendre.
- Fonctions mises en avant : envoi des factures par WhatsApp, scan des codes-barres avec la caméra, achats et fournisseurs, étiquettes code-barres, prix par canal de vente, site de commande relié à la caisse (click & collect), mode hors ligne, conformité facture électronique.

## Fait
- Ticket et facture numériques par WhatsApp, SMS, e-mail (octobre 2026).
- Scan des codes-barres avec la caméra du téléphone (#1, octobre 2026).
- Menus latéraux regroupés, compte toujours visible, tout tient sur un portable 1280 × 720 (#21, octobre 2026).
- Mode hors ligne avec synchronisation, messagerie support en direct, notifications push, import depuis les anciens logiciels, multi-boutiques, fidélité, vitrine en ligne.

## Priorités

| Priorité | Fonction | Pourquoi | Effort | Ticket |
|---|---|---|---|---|
| 2 | **Achats et fournisseurs** : fiches fournisseurs, bons de commande depuis les alertes de stock, réception de marchandise (mise à jour du stock et du prix d'achat) | Inclus dans les formules Pro des concurrents ; complète la gestion de stock | Moyen à fort | #2 |
| 3 | **Facture électronique structurée** : export UBL 2.1 / CII (EN 16931), puis Factur-X (PDF/A-3) ; ensuite raccordement à une plateforme agréée (France) et à la DGI (Maroc) | Obligation légale 2027 en France, déploiement en cours au Maroc | Fort | #3, #4, #5 |
| 4 | **Click & collect** : commandes de la vitrine enregistrées dans Comptoir (au lieu du seul message WhatsApp), paiement à la remise | Transforme la vitrine en canal de vente | Moyen | #6 |
| 5 | **Étiquettes code-barres** et prix en rayon imprimables | Complète le scan et la réception | Faible | #7 |
| 6 | **Paiements mobiles** (Wave, Orange Money, MTN MoMo, CMI) : lien ou QR de paiement, rapprochement automatique | Paiement dominant en Afrique de l'Ouest | Fort (contrats partenaires) | #8 |
| 7 | **Variantes de produits** (taille, couleur) avec stock par variante | Mode, chaussures, téléphonie | Moyen | #9 |
| 8 | **QR code sur le ticket imprimé** vers le ticket numérique | Prolonge le ticket numérique | Faible | #10 |

## Déjà identifié (backlog)
Paiement des abonnements (#11), mot de passe oublié par e-mail (#12), captcha à l'inscription (#13), certification NF525 (#14), découpage de `public/app/app.js` (#15), grille tarifaire face à la concurrence (#16), maquettes Figma de la messagerie (#18), appareil reconnu non bloqué par adresse IP (#19, à valider), temps réel sur plusieurs serveurs Node.js (#20).
