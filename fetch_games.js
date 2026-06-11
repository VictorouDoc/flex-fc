// ============================================================
//  FETCH_GAMES.JS — récupère les vraies games de Flex (queue 440)
//  via l'API Riot et régénère data.js.
//
//  Usage :  node fetch_games.js RGAPI-xxxx
//      ou :  $env:RIOT_API_KEY="RGAPI-xxxx"; node fetch_games.js
//
//  Une game est gardée si au moins MIN_ROSTER joueurs du roster
//  sont dans la MÊME équipe.
// ============================================================

const fs = require("fs");

const API_KEY = process.argv[2] || process.env.RIOT_API_KEY;
if (!API_KEY) {
  console.error("Clé API manquante. Usage : node fetch_games.js RGAPI-xxxx");
  process.exit(1);
}

const REGION = "europe"; // routing match-v5 / account-v1 pour EUW
const MATCHES_PER_PLAYER = 100; // historique de matchlist par joueur
const MIN_ROSTER = 5;           // min de potes dans la même équipe
const MAX_GAMES = 80;           // plafond de games à télécharger

const PLAYERS = [
  { name: "Pyyrat",         tag: "#ASAP"  },
  { name: "Cedex",          tag: "#0000"  },
  { name: "Thanus",         tag: "#SODO"  },
  { name: "SeanII TK",      tag: "#EUW"   },
  { name: "CL Sky",         tag: "#EUW"   },
  { name: "ThanosDZ",       tag: "#EUW"   },
  { name: "HANG NETANYAHU", tag: "#pls"   },
  { name: "DocLaFolle",     tag: "#LeSaf" },
  { name: "Miso",           tag: "#RAT"   },
  { name: "Ξnjin",          tag: "#PEAK"  },
  { name: "Lionel Messi",   tag: "#safou" },
  { name: "Tasky",          tag: "#574"   },
  { name: "Jordan Carter",  tag: "#7741"  },
  { name: "Kanye West",     tag: "#JLOVE" },
  { name: "LaDid",          tag: "#LaDid" },
  { name: "Wiraak",         tag: "#EUW"   },
  { name: "Phaeldque",      tag: "#EUW"   },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function riot(path) {
  const url = `https://${REGION}.api.riotgames.com${path}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "X-Riot-Token": API_KEY } });
    if (res.status === 429) {
      const wait = parseInt(res.headers.get("retry-after") || "10", 10);
      console.log(`  ... rate limit, pause ${wait}s`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
    await sleep(60); // ~16 req/s max, sous la limite des 20/s
    return res.json();
  }
  throw new Error(`Trop de rate limits sur ${path}`);
}

const ROLE_MAP = { TOP: "TOP", JUNGLE: "JGL", MIDDLE: "MID", BOTTOM: "ADC", UTILITY: "SUP" };

function fmtDuration(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// games déjà présentes dans data.js : on les garde même si elles sont
// sorties de la fenêtre des 100 derniers matchs Riot, et on ne les
// re-télécharge pas (économie de rate limit).
function loadExistingGames() {
  try {
    const src = fs.readFileSync("data.js", "utf8");
    return new Function(`${src}; return GAMES;`)();
  } catch {
    return [];
  }
}

async function main() {
  // 1) Riot ID -> PUUID
  console.log("1/3 Résolution des comptes...");
  const puuidToName = {};
  for (const p of PLAYERS) {
    const tag = p.tag.replace("#", "");
    const acc = await riot(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(p.name)}/${encodeURIComponent(tag)}`);
    if (!acc) { console.log(`  ✗ ${p.name} ${p.tag} introuvable`); continue; }
    puuidToName[acc.puuid] = p.name;
    console.log(`  ✓ ${p.name} ${p.tag}`);
  }

  // 2) Matchlists flex + comptage des recoupements
  console.log("2/3 Récupération des historiques Flex...");
  const matchCount = {};
  for (const [puuid, name] of Object.entries(puuidToName)) {
    const ids = await riot(`/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=440&count=${MATCHES_PER_PLAYER}`);
    if (!ids) continue;
    console.log(`  ${name} : ${ids.length} games flex`);
    ids.forEach((id) => { matchCount[id] = (matchCount[id] || 0) + 1; });
  }

  const existing = loadExistingGames();
  const knownIds = new Set(existing.map((g) => g.id));
  const candidates = Object.entries(matchCount)
    .filter(([id, n]) => n >= MIN_ROSTER && !knownIds.has(id))
    .sort((a, b) => b[0].localeCompare(a[0])) // plus récentes d'abord
    .slice(0, MAX_GAMES)
    .map(([id]) => id);

  console.log(`3/3 ${candidates.length} games communes à télécharger...`);

  // 3) Détails des matchs
  const games = [];
  for (const id of candidates) {
    const m = await riot(`/lol/match/v5/matches/${id}`);
    if (!m || m.info.queueId !== 440) continue;

    // joueurs du roster groupés par équipe
    const byTeam = { 100: [], 200: [] };
    m.info.participants.forEach((pt) => {
      const name = puuidToName[pt.puuid];
      if (name) byTeam[pt.teamId].push({ pt, name });
    });
    const team = byTeam[100].length >= byTeam[200].length ? byTeam[100] : byTeam[200];
    if (team.length < MIN_ROSTER) continue;

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
    process.stdout.write(`  ${games.length}/${candidates.length}\r`);
  }

  const merged = [...existing, ...games];
  merged.sort((a, b) => a.date.localeCompare(b.date));
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
