// ============================================================
//  FETCH_GAMES.JS — récupère les vraies games de Flex (queue 440)
//  via l'API Riot et régénère data.js.
//
//  Usage :  node fetch_games.js RGAPI-xxxx
//      ou :  $env:RIOT_API_KEY="RGAPI-xxxx"; node fetch_games.js
//  Option :  --diag  → liste les comptes inconnus qui jouent souvent
//                       avec vous (smurf pas encore dans roster.json ?).
//                       Lancé tout seul si un compte du roster est introuvable :
//                       son nouveau pseudo apparaît en tête de liste.
//
//  Une game est gardée si au moins MIN_ROSTER PERSONNES du roster
//  sont dans la MÊME équipe. Le roster est dans roster.json :
//  une entrée par personne (son nom), avec tous ses comptes Riot.
// ============================================================

const fs = require("fs");

const args = process.argv.slice(2);
let DIAG = args.includes("--diag");
const API_KEY = args.find((a) => !a.startsWith("--")) || process.env.RIOT_API_KEY;
if (!API_KEY) {
  console.error("Clé API manquante. Usage : node fetch_games.js RGAPI-xxxx");
  process.exit(1);
}

const REGION = "europe"; // routing match-v5 / account-v1 pour EUW
const SINCE = "2026-01-01";     // on parcourt TOUT l'historique flex depuis cette date
const MIN_ROSTER = 5;           // min de potes dans la même équipe
const MAX_GAMES = 80;           // plafond de games à télécharger par run (le reste au run suivant)
const DIAG_GAMES = 30;          // --diag : nb de games "à 4 potes" inspectées

// ---------- roster : nom de la personne -> ses comptes ----------
const ROSTER = require("./roster.json").people;
const splitRiotId = (id) => {
  const i = id.lastIndexOf("#");
  return { gameName: id.slice(0, i), tagLine: id.slice(i + 1) };
};

// tout nom qu'on peut croiser dans data.js (pseudo d'un compte, ancien nom
// de la personne via `aliases`) -> nom actuel de la personne. Sert à migrer
// l'historique quand on renomme quelqu'un ou qu'un compte change de pseudo.
const NAME_OF = {};
ROSTER.forEach((p) => p.accounts.forEach((acc) => { NAME_OF[splitRiotId(acc).gameName] = p.name; }));
ROSTER.forEach((p) => (p.aliases || []).forEach((a) => { NAME_OF[a] = p.name; }));
ROSTER.forEach((p) => { NAME_OF[p.name] = p.name; });
const canon = (name) => NAME_OF[name] || name;

// Cache des PUUID (identifiant Riot stable, ne change JAMAIS même après un
// rename). Si l'API renvoie 404 sur un Riot ID (compte renommé), on réutilise
// le puuid déjà connu. Jamais commité (.gitignore) ; sur GitHub Actions il est
// conservé d'un run à l'autre via actions/cache.
const PUUID_CACHE_FILE = "puuids.json";
function loadPuuidCache() {
  try { return JSON.parse(fs.readFileSync(PUUID_CACHE_FILE, "utf8")); } catch { return {}; }
}
function savePuuidCache(cache) {
  fs.writeFileSync(PUUID_CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

// annotation visible dans l'onglet Actions de GitHub
const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `  ⚠ ${msg}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function riot(path, host = REGION) {
  const url = `https://${host}.api.riotgames.com${path}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { "X-Riot-Token": API_KEY } });
    if (res.status === 429) {
      const wait = parseInt(res.headers.get("retry-after") || "10", 10);
      console.log(`  ... rate limit, pause ${wait}s`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (res.status >= 500) { // Riot tousse : on retente un peu plus tard
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
    await sleep(60); // ~16 req/s max, sous la limite des 20/s
    return res.json();
  }
  throw new Error(`Riot ne répond pas sur ${path}`);
}

const ROLE_MAP = { TOP: "TOP", JUNGLE: "JGL", MIDDLE: "MID", BOTTOM: "ADC", UTILITY: "SUP" };

function fmtDuration(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// games déjà présentes dans data.js : on les garde, et on ne les
// re-télécharge pas (économie de rate limit).
function loadExistingGames() {
  try {
    const src = fs.readFileSync("data.js", "utf8");
    return new Function(`${src}; return GAMES;`)();
  } catch {
    return [];
  }
}

// tous les ids de matchs flex d'un compte depuis SINCE (pagination par 100)
async function allFlexIds(puuid) {
  const startTime = Math.floor(new Date(SINCE).getTime() / 1000);
  const ids = [];
  for (let start = 0; ; start += 100) {
    const page = await riot(`/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=440&startTime=${startTime}&start=${start}&count=100`);
    if (!page || !page.length) break;
    ids.push(...page);
    if (page.length < 100) break;
  }
  return ids;
}

const matchNum = (id) => Number(id.split("_")[1]) || 0;

async function main() {
  // 1) Riot ID -> PUUID (avec cache : robuste aux renames)
  console.log("1/3 Résolution des comptes...");
  const cache = loadPuuidCache();
  const puuidToName = {};
  for (const person of ROSTER) {
    for (const riotId of person.accounts) {
      const { gameName, tagLine } = splitRiotId(riotId);
      const acc = await riot(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
      let puuid;
      if (acc) {
        puuid = acc.puuid;
        cache[riotId] = puuid;
        console.log(`  ✓ ${riotId} → ${person.name}`);
      } else if (cache[riotId]) {
        puuid = cache[riotId];
        const now = await riot(`/riot/account/v1/accounts/by-puuid/${puuid}`);
        const newId = now ? `${now.gameName}#${now.tagLine}` : "?";
        warn(`${riotId} (${person.name}) a été renommé en ${newId} — puuid en cache réutilisé, mets à jour roster.json`);
      } else {
        warn(`${riotId} (${person.name}) introuvable : pseudo ou tag faux, ou compte renommé — ses games sont ignorées`);
        DIAG = true; // le diag listera qui joue à sa place avec vous
        continue;
      }
      puuidToName[puuid] = person.name;
    }
  }
  savePuuidCache(cache);

  // roster affiché sur le site : une entrée par personne (pas de puuid : data.js
  // est public, on ne veut aucun identifiant Riot dedans)
  const PLAYERS = ROSTER.map((p) => {
    const main = splitRiotId(p.accounts[0]);
    return { name: p.name, pseudo: main.gameName, tag: `#${main.tagLine}`, accounts: p.accounts };
  });

  // 2) Historiques flex complets + comptage des PERSONNES par match
  //    (avant : seulement les 100 derniers matchs de chacun, donc une game
  //    commune sortie de la fenêtre d'UN seul des 5 était perdue)
  console.log(`2/3 Récupération des historiques Flex depuis le ${SINCE}...`);
  const peopleIn = {};
  for (const [puuid, name] of Object.entries(puuidToName)) {
    let ids;
    try { ids = await allFlexIds(puuid); } catch (e) { warn(`historique de ${name} non récupéré (${e.message})`); continue; }
    console.log(`  ${name} : ${ids.length} games flex`);
    ids.forEach((id) => { (peopleIn[id] = peopleIn[id] || new Set()).add(name); });
  }

  const existing = loadExistingGames().map((g) => ({
    ...g,
    players: g.players.map((p) => ({ ...p, name: canon(p.name) })),
  }));
  const knownIds = new Set(existing.map((g) => g.id));
  const unknown = Object.entries(peopleIn)
    .filter(([id]) => !knownIds.has(id))
    .sort((a, b) => matchNum(b[0]) - matchNum(a[0])); // plus récentes d'abord
  const candidates = unknown.filter(([, s]) => s.size >= MIN_ROSTER).map(([id]) => id);
  const almost = unknown.filter(([, s]) => s.size === MIN_ROSTER - 1).map(([id]) => id);
  const todo = candidates.slice(0, MAX_GAMES);

  console.log(`3/3 ${candidates.length} games communes à télécharger${candidates.length > todo.length ? ` (${todo.length} ce run, le reste au prochain)` : ""}...`);
  if (almost.length) console.log(`  (+ ${almost.length} games à ${MIN_ROSTER - 1} du roster ignorées${DIAG ? "" : " — lance avec --diag pour voir avec qui"})`);

  // 3) Détails des matchs
  const games = [];
  for (const id of todo) {
    let m;
    try { m = await riot(`/lol/match/v5/matches/${id}`); } catch (e) { warn(`${id} non récupérée (${e.message}), retentée au prochain run`); continue; }
    if (!m || m.info.queueId !== 440) continue;

    // joueurs du roster groupés par équipe
    const byTeam = { 100: [], 200: [] };
    m.info.participants.forEach((pt) => {
      const name = puuidToName[pt.puuid];
      if (name) byTeam[pt.teamId].push({ pt, name });
    });
    const team = byTeam[100].length >= byTeam[200].length ? byTeam[100] : byTeam[200];
    if (new Set(team.map((x) => x.name)).size < MIN_ROSTER) continue;

    games.push({
      id: id,
      date: new Date(m.info.gameStartTimestamp).toISOString().slice(0, 10),
      victory: team[0].pt.win,
      duration: fmtDuration(m.info.gameDuration),
      teamKills: m.info.participants.filter((p) => p.teamId === team[0].pt.teamId).reduce((s, p) => s + p.kills, 0),
      teamDamage: m.info.participants.filter((p) => p.teamId === team[0].pt.teamId).reduce((s, p) => s + p.totalDamageDealtToChampions, 0),
      players: team
        .sort((a, b) => Object.keys(ROLE_MAP).indexOf(a.pt.teamPosition) - Object.keys(ROLE_MAP).indexOf(b.pt.teamPosition))
        .map(({ pt, name }) => ({
          name,
          role: ROLE_MAP[pt.teamPosition] || "?",
          champion: pt.championName,
          kills: pt.kills,
          deaths: pt.deaths,
          assists: pt.assists,
          cs: pt.totalMinionsKilled + pt.neutralMinionsKilled,
          damage: pt.totalDamageDealtToChampions,
          vision: pt.visionScore,
        })),
    });
    process.stdout.write(`  ${games.length}/${todo.length}\r`);
  }

  // --diag : qui complète nos games à 4 ? (smurf d'un pote pas encore dans roster.json)
  if (DIAG && almost.length) {
    console.log(`\nDiag : comptes inconnus dans les ${Math.min(DIAG_GAMES, almost.length)} dernières games à ${MIN_ROSTER - 1} potes...`);
    const strangers = {};
    for (const id of almost.slice(0, DIAG_GAMES)) {
      let m;
      try { m = await riot(`/lol/match/v5/matches/${id}`); } catch { continue; }
      if (!m) continue;
      const mates = m.info.participants.filter((pt) => puuidToName[pt.puuid]);
      const teamId = mates[0] && mates[0].teamId;
      m.info.participants
        .filter((pt) => pt.teamId === teamId && !puuidToName[pt.puuid])
        .forEach((pt) => {
          const rid = `${pt.riotIdGameName}#${pt.riotIdTagline}`;
          strangers[rid] = (strangers[rid] || 0) + 1;
        });
    }
    Object.entries(strangers).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([rid, n]) => console.log(`  ${String(n).padStart(3)}x  ${rid}`));
  }

  const merged = [...existing, ...games];
  merged.sort((a, b) => a.date.localeCompare(b.date) || matchNum(a.id) - matchNum(b.id));
  games.length = 0;
  games.push(...merged);

  // 4) Génération de data.js
  const out = `// ============================================================
//  DATA.JS — généré automatiquement par fetch_games.js
//  le ${new Date().toLocaleString("fr-FR")}
//  ${games.length} games de Flex (queue 440), min ${MIN_ROSTER} joueurs du roster.
//  Pour mettre à jour : node fetch_games.js RGAPI-xxxx
// ============================================================

const PLAYERS = ${JSON.stringify(PLAYERS, null, 2)};

const GAMES = ${JSON.stringify(games, null, 2)};
`;
  fs.writeFileSync("data.js", out, "utf8");
  console.log(`\n✓ data.js régénéré : ${games.length} games de flex.`);
}

main().catch((e) => { console.error("Erreur :", e.message); process.exit(1); });
