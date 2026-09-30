# Application POS tactile - The Moon Brussels

Application web mobile-first pour caisse/tablette : plan des tables, prise de commande, tickets, impression et envoi Telegram des tickets encaisses.

## Demarrage rapide

1. Installer les dependances : `npm install`
2. Copier `.env.example` vers `.env`
3. Ajuster les variables dans `.env`
4. Lancer le serveur : `npm start`
5. Ouvrir : `http://localhost:3000`

## Variables d'environnement

Le serveur charge automatiquement le fichier `.env` place dans `restaurant-app/`.

- `PORT` : port HTTP local
- `APP_PIN` : code PIN de connexion
- `COMPANY_VAT_NUMBER` : numero de TVA imprime
- `TELEGRAM_BOT_TOKEN` : token du bot Telegram
- `TELEGRAM_CHAT_ID` : identifiant du chat ou groupe Telegram

## Pile technique

- Backend : Node.js + Express
- Frontend : HTML/CSS/JS vanilla
- PWA : manifest + service worker
- Stockage actuel : memoire serveur

## Points importants

- Les commandes, tickets et historiques sont encore stockes en memoire. Un redemarrage du serveur efface ces donnees.
- Le fichier `.env` est ignore par Git. Utilise `.env.example` comme modele.

## Structure

- `server.js` : serveur Express et API
- `public/` : interface web
- `.env.example` : modele de configuration locale
