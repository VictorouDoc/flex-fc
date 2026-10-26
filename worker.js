// ============================================================
//  WORKER.JS — backend Cloudflare du site (gratuit)
//
//  Routes :
//    GET    /comments            → tous les commentaires
//    POST   /comments            → ajoute {game, author, text}
//    DELETE /comments?id=&key=   → supprime (clé admin)
//    GET    /games               → games trouvées en live (pas encore dans data.js)
//    POST   /update              → interroge Riot, body {known:[ids déjà connus]}
//                                  cooldown 2 min, comme le bouton Update d'op.gg
//
//  Secrets nécessaires : ADMIN_KEY, RIOT_API_KEY
//  Binding KV : COMMENTS
//  Déploiement : npx wrangler deploy
// ============================================================

// roster partagé avec fetch_games.js : une entrée par personne, tous ses comptes
import roster from "./roster.json";
const ACCOUNTS = roster.people.flatMap((p) => p.accounts.map((riotId) => ({ riotId, person: p.name })));
const MIN_ROSTER = 5;
const COOLDOWN_MS = 2 * 60 * 1000;
const ROLE_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const ROLE_MAP = { TOP: "TOP", JUNGLE: "JGL", MIDDLE: "MID", BOTTOM: "ADC", UTILITY: "SUP" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function riot(path, env) {
  const res = await fetch(`https://europe.api.riotgames.com${path}`, {
    headers: { "X-Riot-Token": env.RIOT_API_KEY },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Riot HTTP ${res.status}`);
  return res.json();
}

// puuids du roster ("Pseudo#TAG" -> puuid), gardés en KV. On ne résout que
// les comptes pas encore connus, et on ne jette jamais un puuid déjà trouvé :
// un compte renommé reste suivi. Le nom affiché vient toujours de roster.json.
async function getPuuids(env) {
  const cache = (await env.COMMENTS.get("puuids_v5", "json")) || {};
  const missing = ACCOUNTS.filter((a) => !cache[a.riotId]);
  if (missing.length) {
    for (const { riotId } of missing) {
      const i = riotId.lastIndexOf("#");
      const acc = await riot(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId.slice(0, i))}/${encodeURIComponent(riotId.slice(i + 1))}`, env);
      if (acc) cache[riotId] = acc.puuid;
    }
    await env.COMMENTS.put("puuids_v5", JSON.stringify(cache));
  }
  const map = {};
  ACCOUNTS.forEach(({ riotId, person }) => { if (cache[riotId]) map[cache[riotId]] = person; });
  return map;
}

function buildGame(id, m, puuids) {
  const byTeam = { 100: [], 200: [] };
  m.info.participants.forEach((pt) => {
    const name = puuids[pt.puuid];
    if (name) byTeam[pt.teamId].push({ pt, name });
  });
  const team = byTeam[100].length >= byTeam[200].length ? byTeam[100] : byTeam[200];
  if (new Set(team.map((x) => x.name)).size < MIN_ROSTER) return null;
  const teamId = team[0].pt.teamId;
  const mates = m.info.participants.filter((p) => p.teamId === teamId);
  const sec = m.info.gameDuration;
  return {
    id,
    date: new Date(m.info.gameStartTimestamp).toISOString().slice(0, 10),
    victory: team[0].pt.win,
    duration: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`,
    teamKills: mates.reduce((s, p) => s + p.kills, 0),
    teamDamage: mates.reduce((s, p) => s + p.totalDamageDealtToChampions, 0),
    players: team
      .sort((a, b) => ROLE_ORDER.indexOf(a.pt.teamPosition) - ROLE_ORDER.indexOf(b.pt.teamPosition))
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
  };
}

async function handleUpdate(req, env) {
  let body = {};
  try { body = await req.json(); } catch {}
  const known = new Set(body.known || []);

  // cooldown global de 2 min, comme op.gg
  const meta = (await env.COMMENTS.get("live_meta", "json")) || {};
  const now = Date.now();
  if (meta.last && now - meta.last < COOLDOWN_MS) {
    return json({ error: "cooldown", wait: Math.ceil((COOLDOWN_MS - (now - meta.last)) / 1000) }, 429);
  }
  await env.COMMENTS.put("live_meta", JSON.stringify({ last: now }));

  const puuids = await getPuuids(env);

  // matchlists récentes de tout le roster
  const count = {};
  for (const [puuid, person] of Object.entries(puuids)) {
    const ids = (await riot(`/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=440&count=10`, env)) || [];
    ids.forEach((id) => { (count[id] = count[id] || new Set()).add(person); });
  }

  const stored = (await env.COMMENTS.get("live_games", "json")) || [];
  const storedIds = new Set(stored.map((g) => g.id));
  const todo = Object.entries(count)
    .filter(([id, people]) => people.size >= MIN_ROSTER && !known.has(id) && !storedIds.has(id))
    .map(([id]) => id)
    .slice(0, 10); // garde une marge sous la limite de sous-requêtes

  const added = [];
  for (const id of todo) {
    const m = await riot(`/lol/match/v5/matches/${id}`, env);
    if (!m || m.info.queueId !== 440) continue;
    const g = buildGame(id, m, puuids);
    if (g) added.push(g);
  }

  if (added.length) {
    const merged = [...stored, ...added].slice(-50); // le workflow de nuit consolide dans data.js
    await env.COMMENTS.put("live_games", JSON.stringify(merged));
  }
  return json({ added });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    try {
      if (url.pathname === "/games" && req.method === "GET") {
        return json((await env.COMMENTS.get("live_games", "json")) || []);
      }

      if (url.pathname === "/update" && req.method === "POST") {
        return await handleUpdate(req, env);
      }

      if (url.pathname === "/comments") {
        if (req.method === "GET") {
          return json((await env.COMMENTS.get("all", "json")) || {});
        }
        if (req.method === "POST") {
          let body;
          try { body = await req.json(); } catch { return json({ error: "json invalide" }, 400); }
          const { game, author, text } = body;
          if (!game || !author || !text) return json({ error: "champs manquants" }, 400);
          if (String(author).length > 40 || String(text).length > 300) return json({ error: "trop long" }, 400);
          const data = (await env.COMMENTS.get("all", "json")) || {};
          const list = data[game] || (data[game] = []);
          if (list.length >= 200) return json({ error: "trop de commentaires sur cette game" }, 429);
          list.push({
            id: crypto.randomUUID(),
            author: String(author).slice(0, 40),
            text: String(text).slice(0, 300),
            date: new Date().toISOString(),
          });
          await env.COMMENTS.put("all", JSON.stringify(data));
          return json({ ok: true });
        }
        if (req.method === "DELETE") {
          if (url.searchParams.get("key") !== env.ADMIN_KEY) return json({ error: "interdit" }, 403);
          const id = url.searchParams.get("id");
          const data = (await env.COMMENTS.get("all", "json")) || {};
          for (const g of Object.keys(data)) data[g] = data[g].filter((c) => c.id !== id);
          await env.COMMENTS.put("all", JSON.stringify(data));
          return json({ ok: true });
        }
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};
