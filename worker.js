// ============================================================
//  WORKER.JS — serveur de commentaires (Cloudflare Workers)
//
//  Déploiement (une fois, ~5 min) :
//  1. Compte gratuit sur https://dash.cloudflare.com
//  2. Workers & Pages → Create → Worker → coller ce fichier → Deploy
//  3. Storage & Databases → KV → Create namespace : "flex-comments"
//  4. Dans le worker : Settings → Bindings → Add → KV namespace,
//     Variable name : COMMENTS, namespace : flex-comments
//  5. Settings → Variables → Add : ADMIN_KEY = un mot de passe de ton choix
//     (sert à supprimer les commentaires des imposteurs)
//  6. Copier l'URL du worker (https://xxx.workers.dev) dans la
//     constante COMMENTS_API en haut de app.js, commit, push.
//
//  Modération : pour supprimer un commentaire,
//  DELETE https://xxx.workers.dev/comments?id=<id>&key=<ADMIN_KEY>
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname !== "/comments") return json({ error: "not found" }, 404);

    if (req.method === "GET") {
      const data = (await env.COMMENTS.get("all", "json")) || {};
      return json(data);
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

    return json({ error: "méthode non gérée" }, 405);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
