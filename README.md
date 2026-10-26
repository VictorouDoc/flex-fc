# FLEX SQUAD 🔥

Le site qui récap nos flex League of Legends. Stats, MVP, boulets, roasting.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` / `style.css` / `app.js` | Le site (statique, aucune dépendance) |
| `data.js` | Les games (généré automatiquement, ne pas éditer à la main) |
| `fetch_games.js` | Script de mise à jour via l'API Riot |
| `roster.json` | Le roster : une personne (son nom) → ses comptes Riot |

## Mettre à jour les games

```
node fetch_games.js RGAPI-ta-clé
```

Le script récupère les games de **Ranked Flex (queue 440)** où au moins
`MIN_ROSTER` joueurs du roster sont dans la même équipe, et régénère `data.js`.
Ensuite : `git add data.js`, `git commit`, `git push` → le site se met à jour.

⚠️ La clé API ne doit JAMAIS être committée. Elle se passe en argument du script,
elle n'apparaît dans aucun fichier du repo.

## Le roster : une personne = un nom, plusieurs comptes

Tout est dans `roster.json` (lu par `fetch_games.js` ET par `worker.js`) :

```json
{ "name": "Kanye West", "accounts": ["Kanye West#JLOVE", "HANG NETANYAHU#pls"] }
```

- `name` — le **nom de la personne**, c'est lui qui est affiché sur le site et qui
  porte les stats. Il ne dépend d'aucun pseudo.
- `accounts` — tous ses comptes Riot (`Pseudo#TAG`) : main en premier (affiché
  sous le nom), puis smurfs et anciens pseudos. Toutes les games de tous ces
  comptes sont créditées à `name`.
- `aliases` (optionnel) — anciens **noms** de la personne, si tu la renommes et
  que ce nom n'était pas un pseudo de ses comptes.

Changer un nom ou ajouter un compte → modifier `roster.json`, c'est tout :
l'historique de `data.js` est réécrit au run suivant (un ancien pseudo de compte
est reconnu tout seul). Après un changement, redéployer le worker
(`npx wrangler deploy`) pour que le bouton ⟳ suive aussi.

Une game compte si **5 personnes** du roster sont dans la même équipe (deux
comptes de la même personne ne comptent qu'une fois).

En interne, les comptes sont résolus vers leur **PUUID** Riot (identifiant stable
qui ne change jamais, même après un rename) puis mis en cache dans `puuids.json`
(conservé entre les runs du bot grâce au cache GitHub Actions). Si un compte connu
est renommé, le script le retrouve quand même et affiche son nouveau pseudo pour
qu'on mette `roster.json` à jour.

⚠️ `puuids.json` n'est **jamais commité** (il est dans `.gitignore`) : un PUUID
est un identifiant de compte Riot, on ne le met pas dans un repo public. Pour la
même raison, `data.js` ne contient **que des pseudos**, aucun identifiant Riot.

Des games manquent ? `node fetch_games.js RGAPI-xxx --diag` liste les comptes
inconnus qui complètent vos games à 4 : souvent un smurf à ajouter dans `accounts`.

## Réglages (en haut de `fetch_games.js`)

- `MIN_ROSTER` — nombre minimum de potes dans la même équipe (actuellement 5 = full stack)
- `SINCE` — date de début : tout l'historique flex depuis cette date est parcouru
- `MAX_GAMES` — plafond de games téléchargées par run (le reste au run suivant)

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
