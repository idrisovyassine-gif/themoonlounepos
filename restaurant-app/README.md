# Servio POS — SaaS multi-restaurants

Servio transforme le POS tactile historique de Moon Lounge en une plateforme isolée par restaurant.
Le flux tables → commande → cuisine → paiement est conservé, avec une gestion web du menu, du
personnel, des tables, des paramètres et des statistiques.

## Installation et développement

Prérequis : Node.js 24+ (SQLite est fourni par `node:sqlite`).

```powershell
cd C:\Users\Onnou\Desktop\moonlounge\restaurant-app
npm install
Copy-Item .env.example .env
npm run dev
```

Ouvrir `http://localhost:3000`. Un restaurant se crée sur `/signup`. Le propriétaire complète ensuite
catégories, produits, options, tables et employés dans `/dashboard`, puis ouvre le POS sur `/`.
L’écran de production cuisine est disponible sur `/kitchen` et s’actualise automatiquement.

## Configuration

Le `.env` reste local et ne doit jamais être versionné.

- `PORT` : port HTTP, 3000 par défaut.
- `DATABASE_PATH` : SQLite, `./data/pos.sqlite` par défaut.
- `APP_ORIGIN` : origine autorisée pour les mutations en production.
- `SESSION_DAYS` : durée des sessions.
- `MOON_OWNER_PIN` : facultatif, utilisé une seule fois au seed initial pour l’accès PIN Moon Lounge.

## Base et migrations

`001_multi_tenant_core` est appliquée atomiquement au démarrage et suivie dans `schema_migrations`.
Chaque ressource métier contient `restaurant_id`. Les routes tenant utilisent uniquement le restaurant
de la session, jamais un identifiant de restaurant fourni par le client.

Au premier démarrage, les 14 catégories, 105 produits et 13 tables historiques sont rattachés à
`rest_moon_lounge`. La source versionnée est `seeds/moon-menu.seed.json`. En production, placer la base sur un
volume persistant et sauvegarder le fichier SQLite avec ses éventuels fichiers `-wal`/`-shm`.

## Créer le premier Super Admin

Le rôle `SUPER_ADMIN` n’est attribuable par aucune route publique.

```powershell
$env:SUPER_ADMIN_EMAIL='admin@votre-domaine.be'
$env:SUPER_ADMIN_PASSWORD='une-phrase-secrete-longue-et-unique'
$env:SUPER_ADMIN_FIRST_NAME='Votre prénom'
$env:SUPER_ADMIN_LAST_NAME='Votre nom'
npm run create-super-admin
Remove-Item Env:SUPER_ADMIN_PASSWORD
```

La console est disponible sur `/super-admin`.

## Rôles

- `RESTAURANT_OWNER` : gestion complète de son établissement.
- `MANAGER` : menu, équipe, tables, commandes, paiements et rapports.
- `WAITER` : prise de commande.
- `CASHIER` : commandes et encaissement.
- `KITCHEN` : accès à la vue cuisine et mise à jour des commandes en préparation/prêtes.
- `SUPER_ADMIN` : supervision et statut des restaurants.

Les permissions additionnelles sont stockées de façon extensible par employé.

Les prix du POS sont toujours recalculés par le serveur à partir du produit et de ses options. La TVA
configurée est enregistrée comme part incluse du prix TTC ; les frais de service sont ajoutés au total.

## Vérifications et production

```powershell
npm run check
npm test
npm start
```

En production : HTTPS, `NODE_ENV=production`, `APP_ORIGIN` exacte, volume persistant et sauvegardes.
Les tokens/PIN ne sont jamais journalisés. Les envois Telegram historiques globaux sont désactivés
jusqu’à la mise en place d’une configuration chiffrée par restaurant.

Voir [AUDIT_MULTI_TENANT.md](./AUDIT_MULTI_TENANT.md) pour l’audit complet et le plan appliqué.
