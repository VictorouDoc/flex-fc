// ============================================================
//  APP.JS — toute la logique. Rien à toucher ici normalement.
// ============================================================

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const fmt = (n) => n.toLocaleString("fr-FR");
const kda = (p) => p.deaths === 0 ? p.kills + p.assists : (p.kills + p.assists) / p.deaths;
const kdaStr = (p) => kda(p).toFixed(1);
const playerTag = (name) => (PLAYERS.find((p) => p.name === name) || {}).tag || "";

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
function aggregateStats() {
  const map = {};
  PLAYERS.forEach((p) => {
    map[p.name] = {
      name: p.name, tag: p.tag, games: 0, wins: 0,
      kills: 0, deaths: 0, assists: 0, damage: 0, cs: 0, vision: 0,
      champs: {}, mvps: 0, noobs: 0, scoreSum: 0,
    };
  });
  GAMES.forEach((g) => {
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
  return map;
}

const STATS = aggregateStats();
const ACTIVE = Object.values(STATS).filter((s) => s.games > 0);

// ============================================================
//  PAGE : GAMES
// ============================================================
function renderGames() {
  const el = $("#page-games");
  let html = `
    <h2 class="page-title">Historique des flex</h2>
    <p class="page-sub">${GAMES.length} games enregistrées. Chacune avec son héros... et son coupable.</p>
  `;

  if (!GAMES.length) {
    html += `<div class="empty-note">Aucune game pour l'instant. Ajoutez-en dans <b>data.js</b> !</div>`;
    el.innerHTML = html;
    return;
  }

  [...GAMES].reverse().forEach((g) => {
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
      </div>`;
  });

  el.innerHTML = html;
}

// ============================================================
//  PAGE : PROFILS
// ============================================================
function renderProfiles() {
  const el = $("#page-profiles");
  const cards = PLAYERS.map((p, i) => {
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
    <p class="page-sub">${PLAYERS.length} âmes perdues. Le roster change, le niveau reste constant (bas).</p>
    <div class="profile-grid">${cards}</div>`;
}

function renderProfileDetail(name) {
  const el = $("#page-profiles");
  const s = STATS[name];
  const idx = PLAYERS.findIndex((p) => p.name === name);
  const quip = QUIPS[idx % QUIPS.length];

  const games = GAMES.filter((g) => g.players.some((p) => p.name === name)).reverse();
  const rows = games.map((g) => {
    const p = g.players.find((x) => x.name === name);
    const { mvp, noob } = mvpAndNoob(g);
    const tagIcon = p.name === mvp.name ? " 👑" : p.name === noob.name ? " 🤡" : "";
    return `
      <tr>
        <td class="${g.victory ? '' : 'dim'}" style="color:${g.victory ? 'var(--win)' : 'var(--loss)'};font-weight:700">${g.victory ? "W" : "L"}</td>
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

  // perfs individuelles par game
  let bestPerf = null, worstPerf = null;
  GAMES.forEach((g) => {
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

  const totalGames = GAMES.length;
  const totalWins = GAMES.filter((g) => g.victory).length;
  const totalKills = ACTIVE.reduce((s, p) => s + p.kills, 0);
  const totalDeaths = ACTIVE.reduce((s, p) => s + p.deaths, 0);

  // champion le plus joué
  const champCount = {};
  GAMES.forEach((g) => g.players.forEach((p) => { champCount[p.champion] = (champCount[p.champion] || 0) + 1; }));
  const topChamps = Object.entries(champCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // line-ups (composition exacte de 5)
  const lineups = {};
  GAMES.forEach((g) => {
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

  // classement joueurs
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

// rendu initial
Object.values(RENDERERS).forEach((fn) => fn());
