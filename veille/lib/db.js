"use strict";
/* Base SQLite : schéma, migrations et requêtes préparées.
   node:sqlite est intégré à Node (>= 22.5), donc aucune dépendance native à
   compiler — l'installation ne peut pas échouer sur une machine sans toolchain. */

/* node:sqlite est intégré à Node, mais son exposition a changé de version en
   version : présent dès 22.5 derrière --experimental-sqlite, accessible sans
   drapeau à partir de 23.4. Si le module manque, un message clair vaut mieux
   qu'une pile d'appels sur un serveur distant. */
let DatabaseSync;
try{
  ({ DatabaseSync } = require("node:sqlite"));
}catch(e){
  console.error("\n[veille] node:sqlite indisponible sur " + process.version + ".");
  console.error("[veille] Lancez avec  node --experimental-sqlite server.js");
  console.error("[veille] ou passez à Node 24 (NODE_VERSION=24 sur Render).\n");
  throw e;
}
const path = require("path");
const fs = require("fs");

const FILE = process.env.VEILLE_DB
  ? path.resolve(__dirname, "..", process.env.VEILLE_DB)
  : path.join(__dirname, "..", "veille.db");

fs.mkdirSync(path.dirname(FILE), { recursive: true });
const db = new DatabaseSync(FILE);

db.exec("PRAGMA journal_mode = WAL");     // lectures concurrentes pendant une collecte
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY,
  url           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  lang          TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  filtered      INTEGER NOT NULL DEFAULT 0,   -- 1 : ne garder que ce qui touche aux SI
  etag          TEXT,               -- requêtes conditionnelles : on ne retélécharge
  last_modified TEXT,               -- pas un flux qui n'a pas bougé
  last_ok       TEXT,
  last_error    TEXT,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id           INTEGER PRIMARY KEY,
  source_id    INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  guid         TEXT NOT NULL,       -- identité telle que donnée par le flux
  url_key      TEXT NOT NULL,       -- URL normalisée : déduplication entre sources
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  author       TEXT,
  lang         TEXT,
  published_at TEXT,                -- ISO 8601, ou NULL si le flux n'en donne pas
  fetched_at   TEXT NOT NULL,
  UNIQUE (source_id, guid)
);

-- Un même article repris par trois agrégateurs ne doit apparaître qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_urlkey ON articles(url_key);
CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(published_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS article_user (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  non_traite INTEGER NOT NULL DEFAULT 1,
  traite_at  TEXT,
  PRIMARY KEY (article_id, user_id)
);

-- Index partiel : le compteur de la pastille ne balaie que le non-traité.
CREATE INDEX IF NOT EXISTS idx_au_unread
  ON article_user(user_id, article_id DESC) WHERE non_traite = 1;

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  trigger     TEXT NOT NULL,        -- 'cron' | 'manuel' | 'demarrage'
  fetched     INTEGER NOT NULL DEFAULT 0,
  added       INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  detail      TEXT
);
`);

/* Migrations : ajouter une colonne à une base déjà en service. SQLite ne connaît
   pas ADD COLUMN IF NOT EXISTS, on regarde donc ce qui existe avant d'ajouter. */
function addColumn(table, name, decl){
  const cols = db.prepare("PRAGMA table_info(" + table + ")").all();
  if(cols.some(c => c.name === name)) return;
  db.exec("ALTER TABLE " + table + " ADD COLUMN " + name + " " + decl);
}
addColumn("sources",  "trust",       "TEXT NOT NULL DEFAULT 'presse'");
addColumn("sources",  "weight",      "REAL NOT NULL DEFAULT 1.5");
addColumn("articles", "score",       "REAL");
addColumn("articles", "confirms",    "INTEGER NOT NULL DEFAULT 1");
addColumn("articles", "trust_level", "TEXT");
addColumn("articles", "major",       "INTEGER NOT NULL DEFAULT 0");

const now = () => new Date().toISOString();

/* ---------------- utilisateurs ---------------- */
const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById:    db.prepare("SELECT * FROM users WHERE id = ?"),
  addUser:     db.prepare("INSERT INTO users(email, name, created_at) VALUES (?, ?, ?)"),
  allUserIds:  db.prepare("SELECT id FROM users")
};

function ensureUser(email, name){
  const found = q.userByEmail.get(email);
  if(found) return found;
  q.addUser.run(email, name || null, now());
  return q.userByEmail.get(email);
}

/* ---------------- sources ---------------- */
const s = {
  all:      db.prepare("SELECT * FROM sources ORDER BY name"),
  active:   db.prepare("SELECT * FROM sources WHERE active = 1 ORDER BY id"),
  byUrl:    db.prepare("SELECT * FROM sources WHERE url = ?"),
  add:      db.prepare(`INSERT INTO sources(url, name, lang, active, filtered, trust, weight, created_at)
                        VALUES (?, ?, ?, 1, ?, ?, ?, ?)`),
  tune:     db.prepare("UPDATE sources SET trust = ?, weight = ?, filtered = ?, lang = ? WHERE url = ?"),
  setState: db.prepare("UPDATE sources SET active = ? WHERE id = ?"),
  remove:   db.prepare("DELETE FROM sources WHERE id = ?"),
  ok:       db.prepare(`UPDATE sources SET etag = ?, last_modified = ?, last_ok = ?,
                        last_error = NULL, fail_count = 0 WHERE id = ?`),
  fail:     db.prepare(`UPDATE sources SET last_error = ?, fail_count = fail_count + 1
                        WHERE id = ?`)
};

function addSource(url, name, lang, filtered, trust, weight){
  const found = s.byUrl.get(url);
  if(found){
    // une source déjà connue voit ses réglages rafraîchis au démarrage
    s.tune.run(trust || "presse", weight || 1.5, filtered ? 1 : 0, lang || null, url);
    return s.byUrl.get(url);
  }
  s.add.run(url, name || url, lang || null, filtered ? 1 : 0,
            trust || "presse", weight || 1.5, now());
  return s.byUrl.get(url);
}

/* ---------------- articles ---------------- */
const a = {
  insert: db.prepare(`INSERT INTO articles
    (source_id, guid, url_key, url, title, summary, author, lang, published_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare("SELECT * FROM articles WHERE id = ?"),
  // Diffusion : tout nouvel article part non traité chez chacun.
  fanOut: db.prepare(`INSERT OR IGNORE INTO article_user(article_id, user_id, non_traite)
                      SELECT ?, id, 1 FROM users`),
  // Rattrapage d'un nouvel utilisateur : il hérite du MAJEUR déjà retenu, pas de
  // toute la base. Sans ce « WHERE major = 1 », chaque démarrage rediffusait les
  // centaines d'articles collectés et la pastille repartait à zéro de sélection.
  fanIn: db.prepare(`INSERT OR IGNORE INTO article_user(article_id, user_id, non_traite)
                     SELECT id, ?, 1 FROM articles WHERE major = 1`),
  countUnread: db.prepare(`SELECT COUNT(*) AS n FROM article_user
                           WHERE user_id = ? AND non_traite = 1`),
  markRead: db.prepare(`UPDATE article_user SET non_traite = 0, traite_at = ?
                        WHERE article_id = ? AND user_id = ? AND non_traite = 1`),
  markUnread: db.prepare(`UPDATE article_user SET non_traite = 1, traite_at = NULL
                          WHERE article_id = ? AND user_id = ?`),
  markAllRead: db.prepare(`UPDATE article_user SET non_traite = 0, traite_at = ?
                           WHERE user_id = ? AND non_traite = 1`),
  // Le vivier de sélection : tout ce qui est récent, avec les attributs de sa
  // source. C'est sur cet ensemble que se calcule la corroboration.
  recent: db.prepare(`SELECT a.id, a.title, a.summary, a.published_at, a.fetched_at,
                             a.source_id, s.name AS source, s.lang, s.trust, s.weight
                        FROM articles a JOIN sources s ON s.id = a.source_id
                       WHERE a.fetched_at >= ?`),
  promote: db.prepare(`UPDATE articles SET score = ?, confirms = ?, trust_level = ?, major = 1
                       WHERE id = ?`),
  purge: db.prepare(`DELETE FROM articles WHERE id IN (
                       SELECT ar.id FROM articles ar
                       LEFT JOIN article_user au
                         ON au.article_id = ar.id AND au.non_traite = 1
                       WHERE ar.fetched_at < ? AND au.article_id IS NULL)`)
};

/* Insertion d'un article + diffusion, en une transaction.
   Renvoie true s'il est nouveau, false si le flux nous l'avait déjà donné. */
function saveArticle(art){
  const tx = db.prepare("BEGIN IMMEDIATE");
  try{
    tx.run();
    let info;
    try{
      // Langue normalisée sur deux lettres : les flux annoncent « en-US »,
      // « fr-FR », « en_GB »… et un quota qui compare à « en » les rangerait
      // tous du mauvais côté.
      const lang = art.lang ? String(art.lang).slice(0, 2).toLowerCase() : null;
      info = a.insert.run(art.source_id, art.guid, art.url_key, art.url, art.title,
                          art.summary || null, art.author || null, lang,
                          art.published_at || null, now());
    }catch(e){
      // UNIQUE(source_id,guid) ou UNIQUE(url_key) : déjà connu, ce n'est pas une erreur
      db.prepare("ROLLBACK").run();
      if(String(e.message).includes("UNIQUE")) return false;
      throw e;
    }
    // Pas de diffusion ici : un article collecté n'est pas encore une actualité.
    // C'est la sélection, en fin de collecte, qui décidera de le notifier.
    db.prepare("COMMIT").run();
    return true;
  }catch(e){
    try{ db.prepare("ROLLBACK").run(); }catch(_){}
    throw e;
  }
}

/* Liste paginée. status : 'unread' (défaut) ou 'all'.
   Pagination par curseur : plus stable qu'un OFFSET quand la collecte insère
   pendant que l'utilisateur fait défiler. */
function listArticles(userId, { status = "unread", limit = 20, before = null } = {}){
  limit = Math.max(1, Math.min(100, Number(limit) || 20));
  const where = ["au.user_id = ?"];
  const args = [userId];
  if(status === "unread") where.push("au.non_traite = 1");
  if(before){ where.push("ar.id < ?"); args.push(Number(before)); }
  const rows = db.prepare(`
    SELECT ar.id, ar.title, ar.url, ar.summary, ar.author, ar.lang,
           ar.published_at, ar.fetched_at, ar.score, ar.confirms, ar.trust_level,
           au.non_traite, s.name AS source, s.id AS source_id
      FROM article_user au
      JOIN articles ar ON ar.id = au.article_id
      JOIN sources  s  ON s.id  = ar.source_id
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(ar.published_at, ar.fetched_at) DESC, ar.id DESC
     LIMIT ?`).all(...args, limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit).map(r => ({ ...r, non_traite: !!r.non_traite }));
  return { articles: page, next: more ? page[page.length - 1].id : null };
}

/* ---------------- journal des collectes ---------------- */
const r = {
  start: db.prepare("INSERT INTO runs(started_at, trigger) VALUES (?, ?)"),
  end:   db.prepare(`UPDATE runs SET ended_at = ?, fetched = ?, added = ?, errors = ?,
                     detail = ? WHERE id = ?`),
  last:  db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1")
};

module.exports = {
  db, now,
  users: { ensure: ensureUser, byId: q.userById, allIds: () => q.allUserIds.all().map(u => u.id),
           inherit: (userId) => a.fanIn.run(userId) },
  sources: { list: () => s.all.all(), active: () => s.active.all(),
             add: (u, n, l, f, t, w) => addSource(u, n, l, f, t, w),
             setState: (id, on) => s.setState.run(on ? 1 : 0, id),
             remove: (id) => s.remove.run(id),
             ok: (id, etag, lastMod) => s.ok.run(etag || null, lastMod || null, now(), id),
             fail: (id, msg) => s.fail.run(String(msg).slice(0, 300), id) },
  articles: { save: saveArticle, list: listArticles, byId: (id) => a.byId.get(id),
              unread: (userId) => a.countUnread.get(userId).n,
              markRead: (id, userId) => a.markRead.run(now(), id, userId).changes > 0,
              markUnread: (id, userId) => a.markUnread.run(id, userId).changes > 0,
              markAllRead: (userId) => a.markAllRead.run(now(), userId).changes,
              purge: (isoBefore) => a.purge.run(isoBefore).changes,
              recent: (hours) => a.recent.all(
                new Date(Date.now() - hours * 3600000).toISOString()),
              /* Promotion : l'article devient notifiable et part chez tous les
                 utilisateurs. La diffusion n'a lieu QUE là — un article collecté
                 mais non retenu reste en base sans jamais sonner. */
              promote: (art) => {
                a.promote.run(art.score, art.confirms, art.trustLevel, art.id);
                return a.fanOut.run(art.id).changes;
              },
              majors: (userId, limit) => db.prepare(`
                SELECT ar.id, ar.title, ar.url, ar.summary, ar.score, ar.confirms,
                       ar.trust_level, ar.published_at, ar.lang, au.non_traite, s.name AS source
                  FROM article_user au
                  JOIN articles ar ON ar.id = au.article_id
                  JOIN sources  s  ON s.id  = ar.source_id
                 WHERE au.user_id = ? AND ar.major = 1
                 ORDER BY ar.score DESC LIMIT ?`).all(userId, limit || 50) },
  runs: { start: (trigger) => Number(r.start.run(now(), trigger).lastInsertRowid),
          end: (id, st) => r.end.run(now(), st.fetched, st.added, st.errors,
                                     JSON.stringify(st.detail || []), id),
          last: () => r.last.get() }
};
