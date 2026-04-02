# Application POS tactile – The Moon Brussels

Application web mobile-first pour caissier/serveur (tablette) : plan des tables, prise de commande par gros boutons, ticket écran + impression pour The Moon Brussels.

## Démarrage rapide

1) Installer les dépendances : `npm install`  
2) Lancer le serveur : `npm start`  
3) Ouvrir : http://localhost:3000 (ajoutable à l'écran d'accueil en PWA).

## Pile technique

- Backend : Node.js + Express, stockage mémoire (modulaire avec SQLite si besoin).  
- Frontend : HTML/CSS/JS vanilla, UI tactile (min 44px), animations press.  
- PWA : manifest + service worker pour cache offline des assets.

## API (extrait)

- `GET /api/tables` → liste des tables + statut.  
- `POST /api/tables/:id/open` → ouvre la table, crée/retourne la commande.  
- `PUT /api/orders/:id` body `{ items }` → sauvegarde en temps réel.  
- `POST /api/orders/:id/mark-to-pay` → passe la table en état `to_pay`.  
- `POST /api/orders/:id/settle` → clôture, libère la table, retourne le ticket.
- `GET /api/reports/daily` → ticket récap de la journée (total TTC + détails).

## Fonctionnalités UI

- Plan tactile avec cartes colorées (libre/occupée/à payer).  
- Catégories + items à gros boutons, +/− pour quantités, total live.  
- Ticket plein écran avec bouton Imprimer (imprimante thermique via le navigateur).  
- Ticket journée imprimable avec total cumulé.
- Mode plein écran, sauvegarde auto des commandes, cache offline des assets.

## Structure

- `server.js` : serveur Express + routes API + ticket.  
- `public/` : `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`.
