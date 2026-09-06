"use strict";
/* Le service de veille : API REST, flux d'événements (SSE) et fichiers du widget.
   Un seul processus : pas de broker, pas de worker, pas de serveur de base. */

const express = require("express");
const path = require("path");
const D = require("./lib/db.js");
const collector = require("./lib/collector.js");
const DEFAULT_SOURCES = require("./lib/sources.js");

const PORT = Number(process.env.PORT) || 4310;
const COOLDOWN_S = Number(process.env.REFRESH_COOLDOWN_S) || 20;
const EVERY_MIN = Number(process.env.COLLECT_EVERY_MIN) || 30;
const TOKEN = process.env.VEILLE_TOKEN || "";
const ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

/* ---------------- amorçage ---------------- */
const me = D.users.ensure(process.env.VEILLE_USER || "moi@local", "Moi");
for(const s of DEFAULT_SOURCES)
  D.sources.add(s.url, s.name, s.lang, s.filtered, s.trust, s.weight);
D.users.inherit(me.id);      // un utilisateur ajouté après coup hérite du passé

/* Mono-utilisateur pour l'instant. Le jour où une authentification arrive, c'est
   la seule fonction à réécrire : tout le reste travaille déjà par user_id. */
function currentUser(req){
  return me;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

// Le widget peut être servi depuis un autre domaine que l'API.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if(origin && ORIGINS.includes(origin)){
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Veille-Token");
    res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if(req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ---------------- flux d'événements ---------------- */
/* SSE plutôt que WebSocket : le trafic ne va que du serveur vers le navigateur,
   ça passe les proxies, ça se reconnecte tout seul, et c'est vingt lignes. */
const clients = new Set();

function broadcast(event, data){
  const payload = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  for(const res of clients){
    try{ res.write(payload); }catch(e){ clients.delete(res); }
  }
}
function pushUnread(userId){
  broadcast("unread", { unread: D.articles.unread(userId) });
}

app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"        // nginx : ne pas tamponner le flux
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  const user = currentUser(req);
  res.write("event: unread\ndata: " + JSON.stringify({ unread: D.articles.unread(user.id) }) + "\n\n");
  clients.add(res);

  // Battement : sans trafic, un proxy coupe une connexion inactive au bout d'une minute.
  const beat = setInterval(() => { try{ res.write(": ping\n\n"); }catch(e){} }, 25000);
  req.on("close", () => { clearInterval(beat); clients.delete(res); });
});

/* ---------------- API ---------------- */
app.get("/api/state", (req, res) => {
  const user = currentUser(req);
  const last = D.runs.last();
  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    unread: D.articles.unread(user.id),
    sources: D.sources.list().length,
    lastRun: last ? { at: last.ended_at || last.started_at, added: last.added,
                      errors: last.errors, trigger: last.trigger } : null,
    busy: collector.busy()
  });
});

app.get("/api/articles", (req, res) => {
  const user = currentUser(req);
  const { status = "unread", limit = 20, before = null } = req.query;
  res.json(D.articles.list(user.id, { status, limit, before }));
});

app.post("/api/articles/:id/read", (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  if(!D.articles.byId(id)) return res.status(404).json({ error: "article inconnu" });
  const changed = D.articles.markRead(id, user.id);
  const unread = D.articles.unread(user.id);
  if(changed) pushUnread(user.id);
  res.json({ ok: true, changed, unread });
});

app.post("/api/articles/:id/unread", (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  if(!D.articles.byId(id)) return res.status(404).json({ error: "article inconnu" });
  D.articles.markUnread(id, user.id);
  const unread = D.articles.unread(user.id);
  pushUnread(user.id);
  res.json({ ok: true, unread });
});

app.post("/api/articles/read-all", (req, res) => {
  const user = currentUser(req);
  const changed = D.articles.markAllRead(user.id);
  pushUnread(user.id);
  res.json({ ok: true, changed, unread: D.articles.unread(user.id) });
});

/* Le bouton « Actualiser ». Deux garde-fous :
   — si une collecte tourne déjà, on rejoint la sienne au lieu d'en lancer une ;
   — un délai minimal empêche de marteler les serveurs des éditeurs. */
app.post("/api/refresh", async (req, res) => {
  const user = currentUser(req);
  if(TOKEN && req.headers["x-veille-token"] !== TOKEN && req.headers.origin === undefined)
    return res.status(401).json({ error: "jeton invalide" });

  const wait = COOLDOWN_S * 1000 - collector.sinceLast();
  if(!collector.busy() && wait > 0){
    return res.status(429).json({
      error: "trop rapproché",
      retryAfter: Math.ceil(wait / 1000),
      unread: D.articles.unread(user.id)
    });
  }
  const joined = collector.busy();
  try{
    const stats = await collector.collect(joined ? "manuel (rejoint)" : "manuel");
    pushUnread(user.id);
    if(stats.added) broadcast("articles", { added: stats.added });
    res.json({ ok: true, joined, added: stats.added, errors: stats.errors,
               unread: D.articles.unread(user.id), detail: stats.detail });
  }catch(e){
    res.status(500).json({ error: String(e.message).slice(0, 200) });
  }
});

/* ---------------- sources ---------------- */
app.get("/api/sources", (req, res) => {
  res.json(D.sources.list().map(s => ({
    id: s.id, url: s.url, name: s.name, lang: s.lang,
    active: !!s.active, filtered: !!s.filtered,
    lastOk: s.last_ok, lastError: s.last_error, failCount: s.fail_count
  })));
});

app.post("/api/sources", (req, res) => {
  const { url, name, lang, filtered } = req.body || {};
  if(!url || !/^https?:\/\//i.test(url))
    return res.status(400).json({ error: "url http(s) attendue" });
  const s = D.sources.add(url, name || url, lang || null, !!filtered);
  res.json({ ok: true, source: { id: s.id, url: s.url, name: s.name } });
});

app.delete("/api/sources/:id", (req, res) => {
  D.sources.remove(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------------- widget + démonstration ---------------- */
app.use("/veille", express.static(path.join(__dirname, "public"), {
  maxAge: "5m", setHeaders: (res) => res.set("Access-Control-Allow-Origin", "*")
}));
/* Le journal, servi par le même service. Sans cela le widget ne pourrait pas
   l'ouvrir : un navigateur refuse qu'une page HTTP ouvre un fichier local. */
app.get("/journal", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "journal-de-bord.html"), (err) => {
    if(err) res.status(404).send("journal-de-bord.html introuvable à côté du dossier veille/");
  });
});
app.get("/", (req, res) => res.redirect("/veille/demo.html"));

app.use((err, req, res, next) => {
  console.error("[veille]", err);
  res.status(500).json({ error: "erreur interne" });
});

/* ---------------- collecte planifiée ---------------- */
/* setTimeout enchaîné plutôt que setInterval : une passe lente ne peut pas
   provoquer un empilement, et le décalage aléatoire évite de tomber à la
   seconde pile sur l'heure ronde comme tous les agrégateurs de la Terre. */
function schedule(){
  const base = EVERY_MIN * 60 * 1000;
  const jitter = Math.floor(Math.random() * 60 * 1000);
  setTimeout(async () => {
    try{
      const stats = await collector.collect("cron");
      if(stats.added){
        for(const res of clients){ /* rien à faire par client : compteur global */ }
        pushUnread(me.id);
        broadcast("articles", { added: stats.added });
      }
      console.log("[veille] collecte planifiée :", stats.added, "nouveaux,",
                  stats.errors, "erreurs");
    }catch(e){ console.error("[veille] collecte planifiée :", e.message); }
    schedule();
  }, base + jitter).unref?.();
}

const server = app.listen(PORT, () => {
  console.log("[veille] service prêt sur http://localhost:" + PORT);
  console.log("[veille] démonstration : http://localhost:" + PORT + "/veille/demo.html");
  console.log("[veille] " + D.sources.active().length + " sources actives, collecte toutes les "
              + EVERY_MIN + " min");
  // Première passe peu après le démarrage, pour ne pas retarder l'écoute du port.
  setTimeout(() => {
    collector.collect("demarrage")
      .then(s => { pushUnread(me.id); console.log("[veille] collecte initiale :", s.added, "nouveaux"); })
      .catch(e => console.error("[veille] collecte initiale :", e.message));
  }, 1500);
  schedule();
});

/* Un port occupé n'est pas un bug : c'est presque toujours le service qui tourne
   déjà. Le dire en une phrase vaut mieux qu'une pile d'appels de vingt lignes. */
server.on("error", (err) => {
  if(err.code === "EADDRINUSE"){
    console.error("\n[veille] Le port " + PORT + " est déjà pris.");
    console.error("[veille] Le service tourne sans doute déjà : ouvrez");
    console.error("[veille]   http://localhost:" + PORT + "/veille/demo.html");
    console.error("[veille] Pour en démarrer un second ailleurs :  PORT=4311 npm start");
    console.error("[veille] Pour arrêter celui qui tourne :");
    console.error("[veille]   Windows  netstat -ano | findstr :" + PORT + "   puis  taskkill /PID <pid> /F");
    console.error("[veille]   Linux    kill $(lsof -t -i:" + PORT + ")\n");
  } else if(err.code === "EACCES"){
    console.error("[veille] Port " + PORT + " interdit : sous 1024, il faut des droits élevés.");
  } else {
    console.error("[veille] Impossible d'écouter :", err.message);
  }
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n[veille] arrêt demandé");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();   // une connexion SSE ouverte ne doit pas retenir le processus
});
module.exports = app;
