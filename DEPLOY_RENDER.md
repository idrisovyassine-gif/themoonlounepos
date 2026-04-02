# Deployment Render

Ce projet peut etre deploye tel quel sur Render.

Le fichier [render.yaml](C:\Users\Onnou\Desktop\moonlounge\render.yaml) est deja configure pour lancer le service `restaurant-app` avec Node 20.

## Solution gratuite recommandee

Utilise un `Web Service` gratuit sur Render.

Avantages :
- pas besoin de modifier l'application
- URL publique en `onrender.com`
- HTTPS inclus
- passage vers une offre payante tres simple sur la meme plateforme

Limites importantes du gratuit :
- le service se met en veille apres inactivite
- le premier chargement peut prendre environ une minute
- Render peut redemarrer le service a tout moment
- l'application perd ses donnees si le serveur redemarre, car les commandes et paiements sont stockes en memoire

## Ce que fait actuellement l'application

Les donnees runtime sont stockees dans la memoire du serveur :
- commandes ouvertes
- tickets regles
- historique des paiements
- compteurs de tickets

Cela se voit dans [server.js](C:\Users\Onnou\Desktop\moonlounge\restaurant-app\server.js) avec `Map` et tableaux en memoire.

## Etapes de mise en ligne

1. Creer un depot GitHub avec le dossier racine `moonlounge`
2. Ouvrir Render
3. Choisir `New` puis `Blueprint` ou `Web Service`
4. Connecter le depot GitHub
5. Laisser Render detecter `render.yaml`
6. Lancer le deploiement
7. Ouvrir l'URL publique fournie par Render

## Variables utiles

L'application utilise deja :
- `PORT`
- `COMPANY_VAT_NUMBER`

## Pour passer ensuite en payant

Le plus simple est de rester sur Render et de faire :

1. upgrade du `Web Service` vers une instance payante
2. ajout d'une vraie base de donnees

Pour la base :
- test gratuit : Supabase Postgres gratuit ou Render Postgres gratuit
- plus stable pour exploitation : base payante avec sauvegarde

## Recommandation concrete

Pour une premiere mise en ligne rapide :
- hebergement gratuit sur Render
- sans changer le code tout de suite

Pour une vraie utilisation en restaurant :
- ajouter une base de donnees avant usage reel
- ensuite passer le service Render en payant
