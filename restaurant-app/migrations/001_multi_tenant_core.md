# Migration 001 — socle multi-tenant

La migration exécutable est définie dans `src/db.js` afin de rester atomique avec `node:sqlite`.
Elle crée les restaurants, utilisateurs, employés, catégories, produits, options, tables,
commandes, lignes, paiements, paramètres, sessions et journaux d’audit. Chaque table métier
porte `restaurant_id` et les index nécessaires. Le seed rattache le menu historique et les
13 tables au restaurant `rest_moon_lounge` sans créer de mot de passe dans le code source.

## Migration 002

Ajoute les montants de frais de service et pourboires aux commandes ainsi que les index des groupes
d’options et suppléments. Les taxes restent enregistrées séparément tout en conservant des prix TTC.
