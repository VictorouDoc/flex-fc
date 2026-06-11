// ============================================================
//  APP.JS — toute la logique. Rien à toucher ici normalement.
// ============================================================

// ---------- config ----------
// URL du worker Cloudflare pour les commentaires (voir README).
// Tant que c'est vide, la zone commentaires affiche un message d'attente.
const COMMENTS_API = "https://flex-comments.champagne-victor28000-6a2.workers.dev";

// ---------- état (rechargeable via le bouton ⟳) ----------
let STATE = { players: PLAYERS, games: GAMES, gamesOrder: "asc" };
let STATS = {};
let ACTIVE = [];

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const fmt = (n) => n.toLocaleString("fr-FR");
const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
const kda = (p) => p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths;
const kdaStr = (p) => kda(p).toFixed(1);

// hash déterministe : le flame d'une perf ne change pas à chaque rechargement
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

const QUIPS = [
  "A déjà flamé le jungler. Était le jungler.",
  "Ping '?' plus vite que son ombre.",
  "Mute all dès la sélection des champions.",
  "Achète un Contrôle de Vision par mois. Maximum.",
  "« C'est lag » — lui, en 12/0 contre lui.",
  "Pense que le baron est optionnel.",
  "First blood offert avec le sourire.",
  "A déjà gagné une game. On a la preuve quelque part.",
  "Smurf autoproclamé depuis 2019.",
  "Son champion pool : ce qui est gratuit cette semaine.",
  "Stratégie préférée : prier.",
  "A inventé le concept de back à 30 secondes du baron.",
  "KDA player assumé. Et fier.",
  "Flash dans le mur, mais avec confiance.",
  "Le coach vocal dont personne n'a besoin.",
  "Présent en vocal, absent en game.",
];

// ---------- flames du débrief, par tranche de note ----------
const FLAMES = {
  god: [ // 8+
    "{kda} sur {champ}. Calme-toi, c'est de la flex, pas les Worlds.",
    "{champ} injouable. On attend le même niveau demain, pas de pression.",
    "A porté l'équipe sur son dos. L'équipe était lourde pourtant.",
    "Perf de smurf. Ou alors les adversaires étaient en mousse, on penche pour ça.",
    "Le seul à avoir lu le guide de {champ} apparemment.",
  ],
  good: [ // 6-8
    "Bonne game sur {champ}. Profite, on l'encadre, ça n'arrive pas si souvent.",
    "Solide. Pas spectaculaire, mais solide. Comme un tabouret.",
    "{kda}, propre. Presque suspect d'ailleurs.",
    "A fait son travail sur {champ}. C'est déjà énorme pour cette équipe.",
    "Très correct. Le mot 'carry' est encore un peu fort, mais très correct.",
  ],
  mid: [ // 4-6
    "Game anonyme sur {champ}. Présent sur la feuille de match, c'est tout.",
    "Ni bon ni mauvais. L'eau tiède de la flex.",
    "{kda}. Le strict minimum syndical.",
    "A existé pendant {champ} game. Aucune preuve d'impact retenue.",
    "Spectateur premium de sa propre game. Au moins il avait une bonne place.",
  ],
  bad: [ // 2.5-4
    "{kda} sur {champ}. Y'a des mots, mais on va rester polis.",
    "A confondu {champ} avec un sac de gold pour l'équipe d'en face.",
    "Performance sponsorisée par l'équipe adverse.",
    "{deaths} morts. Le respawn timer était son vrai duo de la soirée.",
    "On a vu des bots avec plus d'impact. Des bots débranchés.",
  ],
  int: [ // <2.5
    "{kda}. C'est pas une perf, c'est un acte de sabotage.",
    "{deaths} morts sur {champ}. Riot devrait rembourser les 4 autres.",
    "Détection d'int en cours... Confirmé. C'était bien volontaire ou c'est pire.",
    "L'écran gris a passé plus de temps affiché que le jeu lui-même.",
    "Perf à montrer aux écoles. En cours de 'ce qu'il ne faut pas faire'.",
  ],
};

function flameFor(p, game) {
  const score = perfScore(p, game);
  const tier = score >= 8 ? "god" : score >= 6 ? "good" : score >= 4 ? "mid" : score >= 2.5 ? "bad" : "int";
  const pool = FLAMES[tier];
  const line = pool[hash(`${game.id}|${p.name}`) % pool.length];
  return line
    .replace(/\{champ\}/g, p.champion)
    .replace(/\{kda\}/g, `${p.kills}/${p.deaths}/${p.assists}`)
    .replace(/\{deaths\}/g, p.deaths);
}

// score de performance d'un joueur dans une game (0-10)
function perfScore(p, game) {
  const teamKills = game.teamKills || game.players.reduce((s, x) => s + x.kills, 0) || 1;
  const teamDamage = game.teamDamage || game.players.reduce((s, x) => s + x.damage, 0) || 1;
  const kp = (p.kills + p.assists) / teamKills;       // kill participation
  const ds = p.damage / teamDamage;                    // damage share
  const k = Math.min(kda(p) / 6, 1);                   // kda normalisé
  return Math.round((k * 4 + kp * 3 + ds * 3) * 10) / 10; // note sur 10
}

function mvpAndNoob(game) {
  const scored = game.players.map((p) => ({ ...p, score: perfScore(p, game) }));
  scored.sort((a, b) => b.score - a.score);
  return { mvp: scored[0], noob: scored[scored.length - 1] };
}

// stats agrégées par joueur
function recompute() {
  const map = {};
  STATE.players.forEach((p) => {
    map[p.name] = {
      name: p.name, tag: p.tag, games: 0, wins: 0,
      kills: 0, deaths: 0, assists: 0, damage: 0, cs: 0, vision: 0,
      champs: {}, mvps: 0, noobs: 0, scoreSum: 0,
    };
  });
  STATE.games.forEach((g) => {
    const { mvp, noob } = mvpAndNoob(g);
    g.players.forEach((p) => {
      const s = map[p.name];
      if (!s) return;
      s.games++;
      if (g.victory) s.wins++;
      s.kills += p.kills; s.deaths += p.deaths; s.assists += p.assists;
      s.damage += p.damage; s.cs += p.cs; s.vision += p.vision;
      s.champs[p.champion] = (s.champs[p.champion] || 0) + 1;
      s.scoreSum += perfScore(p, g);
      if (p.name === mvp.name) s.mvps++;
      if (p.name === noob.name) s.noobs++;
    });
  });
  Object.values(map).forEach((s) => {
    s.winrate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
    s.avgKda = s.deaths === 0 ? s.kills + s.assists : (s.kills + s.assists) / s.deaths;
    s.avgScore = s.games ? s.scoreSum / s.games : 0;
    s.mainChamp = Object.entries(s.champs).sort((a, b) => b[1] - a[1])[0];
  });
  STATS = map;
  ACTIVE = Object.values(map).filter((s) => s.games > 0);
}

// ============================================================
//  RECHARGEMENT DES DONNÉES (bouton ⟳)
//  Re-télécharge data.js (mis à jour chaque nuit par le bot)
//  et rafraîchit la page courante sans recharger le site.
// ============================================================
async function reloadData() {
  const btn = $("#reload-btn");
  btn.disabled = true;
  btn.textContent = "⟳ Chargement...";
  try {
    const res = await fetch(`data.js?nocache=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const src = await res.text();
    const data = new Function(`${src}; return { PLAYERS, GAMES };`)();
    const diff = data.GAMES.length - STATE.games.length;
    STATE = { players: data.PLAYERS, games: data.GAMES };
    recompute();
    renderAll();
    btn.textContent = diff > 0 ? `✓ ${diff} nouvelle${diff > 1 ? "s" : ""} game${diff > 1 ? "s" : ""} !` : "✓ Rien de neuf";
  } catch (e) {
    btn.textContent = "✗ Erreur de chargement";
  }
  setTimeout(() => { btn.textContent = "⟳ Actualiser"; btn.disabled = false; }, 3000);
}

// ============================================================
//  PAGE : GAMES
// ============================================================
function renderGames() {
  const el = $("#page-games");
  const asc = STATE.gamesOrder === "asc";
  let html = `
    <h2 class="page-title">Historique des flex</h2>
    <p class="page-sub">${STATE.games.length} games enregistrées. Chacune avec son héros... et son coupable.
      <button class="order-btn" id="order-btn">📅 ${asc ? "Plus anciennes d'abord" : "Plus récentes d'abord"} ↕</button>
    </p>
  `;

  if (!STATE.games.length) {
    html += `<div class="empty-note">Aucune game pour l'instant.</div>`;
    el.innerHTML = html;
    return;
  }

  const ordered = asc ? [...STATE.games] : [...STATE.games].reverse();
  ordered.forEach((g) => {
    const { mvp, noob } = mvpAndNoob(g);
    const cls = g.victory ? "win" : "loss";
    const rows = g.players.map((p) => {
      const rowCls = p.name === mvp.name ? "row-mvp" : p.name === noob.name ? "row-noob" : "";
      return `
        <tr class="${rowCls}">
          <td class="player-cell" data-player="${p.name}">
            <span class="role-tag">${p.role}</span>${p.name}
          </td>
          <td class="dim">${p.champion}</td>
          <td class="mono">${p.kills} / ${p.deaths} / ${p.assists}</td>
          <td class="mono">${kdaStr(p)}</td>
          <td class="mono">${p.cs}</td>
          <td class="mono">${fmt(p.damage)}</td>
          <td class="mono">${p.vision}</td>
        </tr>`;
    }).join("");

    const flames = g.players.map((p) => {
      const score = perfScore(p, g);
      const icon = score >= 8 ? "🔥" : score >= 6 ? "👍" : score >= 4 ? "😐" : score >= 2.5 ? "🤨" : "🚨";
      return `<li><span class="flame-icon">${icon}</span><b class="player-cell" data-player="${p.name}">${p.name}</b> <span class="flame-score mono">(${score.toFixed(1)}/10)</span> — ${flameFor(p, g)}</li>`;
    }).join("");

    html += `
      <div class="game-card">
        <div class="game-header ${cls}">
          <div>
            <div class="game-result ${cls}">${g.victory ? "VICTOIRE" : "DÉFAITE"}</div>
            <div class="game-meta">${new Date(g.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} · ${g.duration}</div>
          </div>
          <div class="game-badges">
            <span class="badge mvp">👑 MVP : ${mvp.name} (${mvp.champion})</span>
            <span class="badge noob">🤡 Boulet : ${noob.name} (${noob.champion})</span>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>Joueur</th><th>Champion</th><th>K / D / A</th><th>KDA</th><th>CS</th><th>Dégâts</th><th>Vision</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="game-recap">
          <div class="recap-title">💬 Le débrief</div>
          <ul class="recap-list">${flames}</ul>
        </div>
        ${commentsBlock(g)}
      </div>`;
  });

  el.innerHTML = html;
  $("#order-btn").addEventListener("click", () => {
    STATE.gamesOrder = asc ? "desc" : "asc";
    renderGames();
    window.scrollTo({ top: 0 });
  });
  loadComments();
}

// ============================================================
//  COMMENTAIRES (stockés sur le worker Cloudflare)
// ============================================================
function commentsBlock(g) {
  return `
    <div class="game-comments" data-game="${g.id}">
      <div class="recap-title">🗨️ Commentaires</div>
      <div class="comments-list"><span class="dim">${COMMENTS_API ? "Chargement..." : "Commentaires bientôt disponibles (serveur en cours d'installation)."}</span></div>
      ${COMMENTS_API ? `
      <form class="comment-form">
        <select name="author" required>
          <option value="" disabled selected>Qui es-tu ?</option>
          ${STATE.players.map((p) => `<option>${esc(p.name)}</option>`).join("")}
        </select>
        <input name="text" maxlength="300" required placeholder="Ton commentaire (reste poli, ou pas)" autocomplete="off" />
        <button type="submit">Envoyer</button>
      </form>` : ""}
    </div>`;
}

let commentsCache = null;
async function loadComments(force = false) {
  if (!COMMENTS_API) return;
  if (!commentsCache || force) {
    try {
      commentsCache = await (await fetch(`${COMMENTS_API}/comments`, { cache: "no-store" })).json();
    } catch {
      commentsCache = {};
    }
  }
  document.querySelectorAll(".game-comments").forEach((el) => {
    const list = commentsCache[el.dataset.game] || [];
    el.querySelector(".comments-list").innerHTML = list.length
      ? list.map((c) => `
          <div class="comment">
            <b class="player-cell" data-player="${esc(c.author)}">${esc(c.author)}</b>
            <span class="dim comment-date">${new Date(c.date).toLocaleDateString("fr-FR")}</span>
            <div class="comment-text">${esc(c.text)}</div>
          </div>`).join("")
      : `<span class="dim">Aucun commentaire. Personne n'ose.</span>`;
  });
}

document.addEventListener("submit", async (e) => {
  const form = e.target.closest(".comment-form");
  if (!form) return;
  e.preventDefault();
  const game = form.closest(".game-comments").dataset.game;
  const author = form.author.value;
  const text = form.text.value.trim();
  if (!author || !text) return;
  const btn = form.querySelector("button");
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const r = await fetch(`${COMMENTS_API}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game, author, text }),
    });
    if (!r.ok) throw new Error();
    form.text.value = "";
    await loadComments(true);
  } catch {
    alert("Erreur d'envoi du commentaire, réessaie.");
  }
  btn.disabled = false;
  btn.textContent = "Envoyer";
});

// ============================================================
//  PAGE : PROFILS
// ============================================================
function renderProfiles() {
  const el = $("#page-profiles");
  const cards = STATE.players.map((p, i) => {
    const s = STATS[p.name];
    const quip = QUIPS[i % QUIPS.length];
    const mini = s.games
      ? `<div class="mini-stats">
          <div class="mini-stat"><b>${s.games}</b><span>games</span></div>
          <div class="mini-stat"><b>${s.winrate}%</b><span>winrate</span></div>
          <div class="mini-stat"><b>${s.avgKda.toFixed(1)}</b><span>kda</span></div>
        </div>`
      : `<div class="mini-stats"><div class="mini-stat"><b>—</b><span>jamais vu en game</span></div></div>`;
    return `
      <div class="profile-card" data-player="${p.name}">
        <h3>${p.name}</h3>
        <div class="tag">${p.tag}</div>
        <div class="quip">« ${quip} »</div>
        ${mini}
      </div>`;
  }).join("");

  el.innerHTML = `
    <h2 class="page-title">Le roster</h2>
    <p class="page-sub">${STATE.players.length} âmes perdues. Le roster change, le niveau reste constant (bas).</p>
    <div class="profile-grid">${cards}</div>`;
}

function renderProfileDetail(name) {
  const el = $("#page-profiles");
  const s = STATS[name];
  const idx = STATE.players.findIndex((p) => p.name === name);
  const quip = QUIPS[idx % QUIPS.length];

  const games = STATE.games.filter((g) => g.players.some((p) => p.name === name)).reverse();
  const rows = games.map((g) => {
    const p = g.players.find((x) => x.name === name);
    const { mvp, noob } = mvpAndNoob(g);
    const tagIcon = p.name === mvp.name ? " 👑" : p.name === noob.name ? " 🤡" : "";
    return `
      <tr>
        <td style="color:${g.victory ? 'var(--win)' : 'var(--loss)'};font-weight:700">${g.victory ? "W" : "L"}</td>
        <td>${p.champion}${tagIcon}</td>
        <td class="dim"><span class="role-tag">${p.role}</span></td>
        <td class="mono">${p.kills} / ${p.deaths} / ${p.assists}</td>
        <td class="mono">${kdaStr(p)}</td>
        <td class="mono">${fmt(p.damage)}</td>
        <td class="dim">${new Date(g.date).toLocaleDateString("fr-FR")}</td>
      </tr>`;
  }).join("");

  const statBoxes = s.games ? `
    <div class="stat-row">
      <div class="stat-box"><b>${s.games}</b><span>Games</span></div>
      <div class="stat-box"><b>${s.winrate}%</b><span>Winrate</span></div>
      <div class="stat-box"><b>${s.avgKda.toFixed(2)}</b><span>KDA moyen</span></div>
      <div class="stat-box"><b>${s.mvps}</b><span>Titres de MVP</span></div>
      <div class="stat-box"><b>${s.noobs}</b><span>Titres de boulet</span></div>
      <div class="stat-box"><b>${s.mainChamp ? s.mainChamp[0] : "—"}</b><span>Champion fétiche</span></div>
      <div class="stat-box"><b>${(s.kills / s.games).toFixed(1)}</b><span>Kills / game</span></div>
      <div class="stat-box"><b>${(s.deaths / s.games).toFixed(1)}</b><span>Morts / game</span></div>
    </div>` : `<p class="page-sub" style="margin-top:16px">Aucune game enregistrée. Soit il dodge, soit il dort.</p>`;

  el.innerHTML = `
    <div class="profile-detail">
      <button class="back-btn" id="back-to-roster">← Retour au roster</button>
      <div class="profile-hero">
        <h2>${name} <span class="dim" style="font-size:0.9rem">${s.tag}</span></h2>
        <p class="quip">« ${quip} »</p>
        ${statBoxes}
      </div>
      ${s.games ? `
      <div class="table-card">
        <table>
          <thead><tr><th>W/L</th><th>Champion</th><th>Rôle</th><th>K / D / A</th><th>KDA</th><th>Dégâts</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : ""}
    </div>`;

  $("#back-to-roster").addEventListener("click", renderProfiles);
}

// ============================================================
//  PAGE : ROASTING
// ============================================================
function renderRoast() {
  const el = $("#page-roast");
  if (!ACTIVE.length) {
    el.innerHTML = `<h2 class="page-title">Le mur de la honte</h2><div class="empty-note">Pas encore de données à roaster. Patience.</div>`;
    return;
  }

  const by = (fn, dir = 1) => [...ACTIVE].sort((a, b) => dir * (fn(b) - fn(a)))[0];

  let bestPerf = null, worstPerf = null;
  STATE.games.forEach((g) => {
    g.players.forEach((p) => {
      const sc = perfScore(p, g);
      if (!bestPerf || sc > bestPerf.score) bestPerf = { ...p, score: sc, game: g };
      if (!worstPerf || sc < worstPerf.score) worstPerf = { ...p, score: sc, game: g };
    });
  });

  const mostDeaths = by((s) => s.deaths);
  const mostNoob = by((s) => s.noobs);
  const mostMvp = by((s) => s.mvps);
  const blind = by((s) => s.vision / s.games, -1);
  const pacifist = by((s) => s.kills / s.games, -1);
  const bestAvg = by((s) => s.avgScore);
  const worstAvg = by((s) => s.avgScore, -1);
  const csGod = by((s) => s.cs / s.games);

  const cards = [
    { cls: "gold",  emoji: "🏆", title: "La performance du siècle", who: bestPerf.name,
      detail: `${bestPerf.kills}/${bestPerf.deaths}/${bestPerf.assists} sur ${bestPerf.champion}. Encadrez ce screenshot, ça n'arrivera plus jamais.` },
    { cls: "shame", emoji: "💀", title: "La performance de la honte", who: worstPerf.name,
      detail: `${worstPerf.kills}/${worstPerf.deaths}/${worstPerf.assists} sur ${worstPerf.champion}. Le gris de l'écran était sa couleur principale.` },
    { cls: "gold",  emoji: "👑", title: "L'usine à MVP", who: mostMvp.name,
      detail: `${mostMvp.mvps} titres de MVP. Porte l'équipe ET son ego sans broncher.` },
    { cls: "shame", emoji: "🤡", title: "Le boulet en titre", who: mostNoob.name,
      detail: `${mostNoob.noobs} fois élu pire joueur de la game. La régularité, c'est important.` },
    { cls: "shame", emoji: "⚰️", title: "L'abonné au respawn", who: mostDeaths.name,
      detail: `${mostDeaths.deaths} morts au total (${(mostDeaths.deaths / mostDeaths.games).toFixed(1)}/game). L'écran gris n'a plus de secret pour lui.` },
    { cls: "shame", emoji: "🕶️", title: "Le non-voyant", who: blind.name,
      detail: `${(blind.vision / blind.games).toFixed(1)} de score de vision par game. Les wards, ça coûte 0 gold pourtant.` },
    { cls: "shame", emoji: "🕊️", title: "Le pacifiste", who: pacifist.name,
      detail: `${(pacifist.kills / pacifist.games).toFixed(1)} kill(s) par game. Il est venu pour l'ambiance.` },
    { cls: "gold",  emoji: "🌾", title: "Le fermier", who: csGod.name,
      detail: `${(csGod.cs / csGod.games).toFixed(0)} CS de moyenne. Les sbires le craignent, les humains beaucoup moins.` },
    { cls: "gold",  emoji: "📈", title: "Le meilleur en moyenne", who: bestAvg.name,
      detail: `Note moyenne de ${bestAvg.avgScore.toFixed(1)}/10. Statistiquement le plus utile. Statistiquement.` },
    { cls: "shame", emoji: "📉", title: "Le pire en moyenne", who: worstAvg.name,
      detail: `Note moyenne de ${worstAvg.avgScore.toFixed(1)}/10. Mais bon, l'important c'est de participer.` },
  ];

  el.innerHTML = `
    <h2 class="page-title">Le mur de la honte (et de la gloire)</h2>
    <p class="page-sub">Calculé automatiquement, donc objectif, donc indiscutable. Pas la peine de pleurer en vocal.</p>
    <div class="roast-grid">
      ${cards.map((c) => `
        <div class="roast-card ${c.cls}">
          <div class="emoji">${c.emoji}</div>
          <h3>${c.title}</h3>
          <div class="winner">${c.who}</div>
          <div class="detail">${c.detail}</div>
        </div>`).join("")}
    </div>`;
}

// ============================================================
//  PAGE : STATS
// ============================================================
function renderStats() {
  const el = $("#page-stats");
  if (!ACTIVE.length) {
    el.innerHTML = `<h2 class="page-title">Stats</h2><div class="empty-note">Pas encore de données.</div>`;
    return;
  }

  const totalGames = STATE.games.length;
  const totalWins = STATE.games.filter((g) => g.victory).length;
  const totalKills = ACTIVE.reduce((s, p) => s + p.kills, 0);
  const totalDeaths = ACTIVE.reduce((s, p) => s + p.deaths, 0);

  const champCount = {};
  STATE.games.forEach((g) => g.players.forEach((p) => { champCount[p.champion] = (champCount[p.champion] || 0) + 1; }));
  const topChamps = Object.entries(champCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const lineups = {};
  STATE.games.forEach((g) => {
    const key = g.players.map((p) => p.name).sort().join(" · ");
    if (!lineups[key]) lineups[key] = { games: 0, wins: 0 };
    lineups[key].games++;
    if (g.victory) lineups[key].wins++;
  });
  const lineupRows = Object.entries(lineups)
    .sort((a, b) => (b[1].wins / b[1].games) - (a[1].wins / a[1].games) || b[1].games - a[1].games)
    .map(([key, v]) => `
      <tr>
        <td style="max-width:420px">${key}</td>
        <td class="mono">${v.wins}W - ${v.games - v.wins}L</td>
        <td class="mono">${Math.round((v.wins / v.games) * 100)}%</td>
      </tr>`).join("");

  const ranking = [...ACTIVE].sort((a, b) => b.avgScore - a.avgScore);
  const maxScore = Math.max(...ranking.map((s) => s.avgScore), 1);
  const rankRows = ranking.map((s, i) => `
    <tr>
      <td class="dim mono">${i + 1}</td>
      <td class="player-cell" data-player="${s.name}">${s.name}</td>
      <td class="mono">${s.games}</td>
      <td class="mono">${s.winrate}%</td>
      <td class="mono">${s.avgKda.toFixed(2)}</td>
      <td class="mono">${s.avgScore.toFixed(1)}</td>
      <td><div class="bar-wrap"><div class="bar" style="width:${(s.avgScore / maxScore) * 100}%"></div></div></td>
    </tr>`).join("");

  el.innerHTML = `
    <h2 class="page-title">Les chiffres ne mentent pas</h2>
    <p class="page-sub">Eux.</p>

    <div class="stats-section">
      <h3>Vue d'ensemble</h3>
      <div class="big-stats">
        <div class="big-stat"><div class="value">${totalGames}</div><div class="label">Games jouées</div></div>
        <div class="big-stat"><div class="value">${Math.round((totalWins / totalGames) * 100)}%</div><div class="label">Winrate global</div><div class="sub">${totalWins}W - ${totalGames - totalWins}L</div></div>
        <div class="big-stat"><div class="value">${fmt(totalKills)}</div><div class="label">Kills cumulés</div></div>
        <div class="big-stat"><div class="value">${fmt(totalDeaths)}</div><div class="label">Morts cumulées</div><div class="sub">Repose en paix x${totalDeaths}</div></div>
        <div class="big-stat"><div class="value">${topChamps[0] ? topChamps[0][0] : "—"}</div><div class="label">Champion le plus pick</div><div class="sub">${topChamps[0] ? topChamps[0][1] + " picks" : ""}</div></div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Classement général (note moyenne /10)</h3>
      <div class="table-card">
        <table>
          <thead><tr><th>#</th><th>Joueur</th><th>Games</th><th>Winrate</th><th>KDA</th><th>Note</th><th></th></tr></thead>
          <tbody>${rankRows}</tbody>
        </table>
      </div>
    </div>

    <div class="stats-section">
      <h3>Les line-ups</h3>
      <div class="table-card">
        <table>
          <thead><tr><th>Composition</th><th>Bilan</th><th>Winrate</th></tr></thead>
          <tbody>${lineupRows}</tbody>
        </table>
      </div>
    </div>

    <div class="stats-section">
      <h3>Top picks</h3>
      <div class="big-stats">
        ${topChamps.map(([c, n]) => `
          <div class="big-stat"><div class="value" style="font-size:1.1rem">${c}</div><div class="label">${n} pick${n > 1 ? "s" : ""}</div></div>`).join("")}
      </div>
    </div>`;
}

// ============================================================
//  NAVIGATION
// ============================================================
const RENDERERS = { games: renderGames, profiles: renderProfiles, roast: renderRoast, stats: renderStats };

function renderAll() {
  Object.values(RENDERERS).forEach((fn) => fn());
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    const page = btn.dataset.page;
    $(`#page-${page}`).classList.add("active");
    RENDERERS[page]();
    window.scrollTo({ top: 0 });
  });
});

// ---------- tri des tableaux : clic sur un en-tête = croissant/décroissant ----------
document.addEventListener("click", (e) => {
  const th = e.target.closest("th");
  if (!th) return;
  const table = th.closest("table");
  if (!table || !table.tBodies[0]) return;

  const idx = [...th.parentNode.children].indexOf(th);
  const dir = th.dataset.dir === "desc" ? 1 : -1; // 1er clic : décroissant (logique leaderboard)
  table.querySelectorAll("th").forEach((h) => { delete h.dataset.dir; h.classList.remove("sort-asc", "sort-desc"); });
  th.dataset.dir = dir === 1 ? "asc" : "desc";
  th.classList.add(dir === 1 ? "sort-asc" : "sort-desc");

  const cellVal = (row) => (row.cells[idx] ? row.cells[idx].textContent.trim() : "");
  const toNum = (s) => {
    const dateM = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // dates fr
    if (dateM) return +(dateM[3] + dateM[2] + dateM[1]);
    const m = s.replace(/[\s  ]/g, "").replace("%", "").replace(",", ".").match(/^-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };

  const rows = [...table.tBodies[0].rows];
  rows.sort((a, b) => {
    const va = cellVal(a), vb = cellVal(b);
    const na = toNum(va), nb = toNum(vb);
    if (na !== null && nb !== null) return dir * (na - nb);
    return dir * va.localeCompare(vb, "fr");
  });
  rows.forEach((r) => table.tBodies[0].appendChild(r));
});

// clic sur un nom de joueur n'importe où → fiche profil
document.addEventListener("click", (e) => {
  const cell = e.target.closest("[data-player]");
  if (!cell) return;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === "profiles"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  $("#page-profiles").classList.add("active");
  renderProfileDetail(cell.dataset.player);
  window.scrollTo({ top: 0 });
});

$("#reload-btn").addEventListener("click", reloadData);

// rendu initial
recompute();
renderAll();
