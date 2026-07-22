# FLEX SQUAD 🔥

Le site qui récap nos flex League of Legends. Stats, MVP, boulets, roasting.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` / `style.css` / `app.js` | Le site (statique, aucune dépendance) |
| `data.js` | Les games (généré automatiquement, ne pas éditer à la main) |
| `fetch_games.js` | Script de mise à jour via l'API Riot |

## Mettre à jour les games

```
node fetch_games.js RGAPI-ta-clé
```

Le script récupère les games de **Ranked Flex (queue 440)** où au moins
`MIN_ROSTER` joueurs du roster sont dans la même équipe, et régénère `data.js`.
Ensuite : `git add data.js`, `git commit`, `git push` → le site se met à jour.

⚠️ La clé API ne doit JAMAIS être committée. Elle se passe en argument du script,
elle n'apparaît dans aucun fichier du repo.

## Comptes, smurfs et renames

Chaque personne est identifiée par son **PUUID** Riot (identifiant stable qui ne
change jamais, même après un rename), pas par son pseudo. La liste `ACCOUNTS`
(en haut de `fetch_games.js`, dupliquée dans `ROSTER` de `worker.js`) fait le
lien pseudo → personne :

- entrée normale → une personne affichée sur le site
- entrée avec `as: "X"` → smurf, ancien pseudo ou 2ᵉ compte : **toutes ses games
  sont créditées à X** (main + historique déjà en `data.js`)

Les PUUID résolus sont mis en cache dans `puuids.json` (commité). Grâce à ça, si
un compte **connu** est renommé sans qu'on mette `ACCOUNTS` à jour, le script
réutilise le puuid en cache et ne perd personne. Chaque game stocke désormais le
`puuid` de chaque joueur, donc l'agrégation sur le site est insensible aux
renames. Seul cas non automatisable : un compte **jamais vu** qui est en fait le
rename de quelqu'un — là il faut ajouter la ligne `as:` à la main.

## Réglages (en haut de `fetch_games.js`)

- `MIN_ROSTER` — nombre minimum de potes dans la même équipe (actuellement 5 = full stack)
- `MATCHES_PER_PLAYER` — profondeur d'historique par joueur
- `MAX_GAMES` — plafond de games téléchargées

## Mise à jour automatique (optionnel)

Le workflow `.github/workflows/update.yml` régénère `data.js` chaque nuit.
Il nécessite une **clé API permanente** (voir ci-dessous) stockée dans
Settings → Secrets and variables → Actions → New repository secret,
nom : `RIOT_API_KEY`.

## Clé API permanente

Les clés de développement expirent toutes les 24h. Pour une clé permanente :

1. Aller sur https://developer.riotgames.com → se connecter
2. Cliquer sur son profil → **Register Product** → **Personal API Key**
3. Remplir le formulaire (nom du projet, description : "site de stats privé
   pour notre groupe d'amis, lecture seule de l'historique de matchs")
4. Attendre la validation par Riot (quelques jours en général)
5. La clé obtenue n'expire pas et a des limites plus élevées
