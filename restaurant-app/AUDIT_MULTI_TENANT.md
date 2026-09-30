# Audit technique et plan de migration

## 1. Stack actuelle auditée

Le projet d’origine était un monolithe Node.js/Express 4.19 avec PDFKit, un frontend HTML/CSS/JS
vanilla et une PWA (manifest + service worker). Il n’existait ni framework frontend, ni TypeScript,
ni moteur de base de données, ni pipeline de build.

## 2. Architecture frontend

`public/index.html`, `styles.css` et `app.js` formaient une interface tactile unique. L’état côté
client contenait tables, menu, commande active, utilisateur et paiements. Les requêtes `fetch`
appelaient une API REST du même serveur. Les impressions utilisaient un rendu thermique HTML.

## 3. Architecture backend

Toutes les routes, règles métier, données seed, PDF, Telegram et sessions étaient concentrées dans
un `server.js` d’environ 1 250 lignes. La nouvelle entrée est minimale ; l’application testable est
créée dans `src/app.js`, la sécurité dans `src/security.js`, la configuration dans `src/config.js` et
le schéma/migrations dans `src/db.js`. L’ancienne implémentation reste consultable dans
`src/legacy-server.snapshot.js` pour traçabilité.

## 4. Base de données initiale

Le stockage était en mémoire avec sérialisation facultative dans `data/staff.json` et
`data/pos-state.json`. Les commandes, tables, tickets, historique, compteurs et employés n’avaient
aucune clé de restaurant. La migration introduit SQLite, clés étrangères, contraintes, index et
`restaurant_id` sur chaque donnée métier.

## 5. Authentification initiale

L’accès utilisait nom + PIN, SHA-256 non salé, deux comptes seed et une `Map` de sessions perdue au
redémarrage. Le rôle se limitait à `manager` ou `server`. La nouvelle authentification utilise scrypt
salé, cookies HttpOnly/SameSite strict, token aléatoire stocké seulement sous forme de hash, expiration,
rate limiting et rôles extensibles. `SUPER_ADMIN` est créé uniquement par CLI.

## 6. Fonctionnalités POS conservées

- plan tactile des tables et statuts libre/occupée/à payer ;
- création et modification de commande ;
- suivi des quantités envoyées en cuisine ;
- articles offerts ;
- encaissement cash, carte ou mixte avec rendu ;
- ticket, impression thermique, historique modifiable et rapport journalier ;
- suivi des encaissements par employé ;
- comportement lounge (têtes, goûts, promotions, supplément alcool) conservé uniquement au travers
  des métadonnées du menu migré.

## 7. Spécificités Moon Lounge identifiées

Nom « The Moon Brussels », TVA belge, adresse de ticket, logo/manifest, 14 catégories et 105 produits,
13 tables, employés Ilias/Celia, PIN par défaut, options shisha, promotions, supplément alcool et
identifiants Telegram étaient globaux ou codés en dur.

## 8. Éléments généralisés

Identité, adresse, TVA, devise, fuseau, langue, taxes, menu, disponibilité, équipe, rôles, permissions,
tables, commandes, paiements, rapports et statistiques proviennent maintenant du restaurant de la
session. Le branding plateforme est neutre (« Servio »). Les anciens secrets/PIN ne sont pas repris.

## 9. Éléments réutilisés

L’interface tablette, les composants visuels, le panier, la gestion de table, la cuisine, les tickets,
l’impression, l’historique et les calculs de paiement ont été conservés et raccordés au nouveau modèle.

## 10. Plan de migration appliqué

1. Archiver l’implémentation et extraire le menu sans perte.
2. Créer le schéma relationnel multi-tenant et le restaurant Moon Lounge.
3. Remplacer auth/session et introduire les rôles.
4. Ajouter inscription/onboarding et paramètres dynamiques.
5. Ajouter CRUD catégories, produits, employés et tables.
6. Rebrancher le POS, commandes et paiements avec filtres tenant serveur.
7. Ajouter dashboard restaurant et console Super Admin.
8. Tester deux restaurants, accès croisés, visibilité Super Admin et statut suspendu.

## Points d’évolution

Les groupes d’options/variantes et les champs d’abonnement sont déjà modélisés. Avant un déploiement
à forte charge, migrer SQLite vers PostgreSQL en conservant les mêmes contraintes tenant, ajouter une
file d’impression/cuisine, un stockage d’images objet, une politique de rétention des audits et les
connecteurs de paiement certifiés. Une application native App Store/Play Store pourra envelopper la
PWA (Capacitor) après validation des périphériques d’impression et des exigences hors-ligne.
