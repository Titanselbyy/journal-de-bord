"use strict";
/* Le stockage durable du journal.
   Les articles de veille se régénèrent seuls en une passe : leur base peut
   disparaître sans dommage. Vos textes, non. Ils vivent donc à part, dans une
   base qui survit aux redéploiements — Turso en ligne, un fichier en local.

   Le modèle est volontairement plat : une clé, une valeur. C'est exactement ce
   que le journal manipule déjà côté navigateur (« jdb:v1:2026 » pour une année,
   « jdb:img:xxx » pour une photo), si bien qu'il n'y a rien à traduire. Et le
   jour où le format des entrées changera, cette table n'aura pas à bouger.    */

const { createClient } = require("@libsql/client");

const URL = process.env.JOURNAL_DB_URL || "file:journal.db";
const TOKEN = process.env.JOURNAL_DB_TOKEN || undefined;
const distant = /^libsql:|^https:/.test(URL);

const client = createClient(TOKEN ? { url: URL, authToken: TOKEN } : { url: URL });

let pret = null;
function init(){
  if(pret) return pret;
  pret = (async () => {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS journal_kv (
        user_id    INTEGER NOT NULL,
        k          TEXT    NOT NULL,
        v          TEXT    NOT NULL,
        updated_at TEXT    NOT NULL,
        PRIMARY KEY (user_id, k)
      )`);
    await client.execute(
      "CREATE INDEX IF NOT EXISTS idx_kv_user ON journal_kv(user_id, updated_at DESC)");
  })();
  return pret;
}

async function get(userId, k){
  await init();
  const r = await client.execute({
    sql: "SELECT v FROM journal_kv WHERE user_id = ? AND k = ?", args: [userId, k] });
  return r.rows.length ? String(r.rows[0].v) : null;
}

async function set(userId, k, v){
  await init();
  await client.execute({
    sql: `INSERT INTO journal_kv (user_id, k, v, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, k) DO UPDATE SET v = excluded.v,
                                                 updated_at = excluded.updated_at`,
    args: [userId, k, v, new Date().toISOString()] });
  return true;
}

async function del(userId, k){
  await init();
  const r = await client.execute({
    sql: "DELETE FROM journal_kv WHERE user_id = ? AND k = ?", args: [userId, k] });
  return r.rowsAffected > 0;
}

/* Inventaire : les clés et leur poids, sans rapatrier les photos. Sert au
   diagnostic et à l'export. */
async function list(userId){
  await init();
  const r = await client.execute({
    sql: `SELECT k, length(v) AS taille, updated_at FROM journal_kv
           WHERE user_id = ? ORDER BY k`, args: [userId] });
  return r.rows.map(x => ({ cle: String(x.k), taille: Number(x.taille),
                            maj: String(x.updated_at) }));
}

async function etat(){
  try{
    await init();
    const r = await client.execute("SELECT COUNT(*) AS n, SUM(length(v)) AS o FROM journal_kv");
    return { ok: true, distant: distant, url: distant ? URL.replace(/\/\/.*@/, "//") : URL,
             cles: Number(r.rows[0].n || 0), octets: Number(r.rows[0].o || 0) };
  }catch(e){
    return { ok: false, distant: distant, erreur: String(e.message).slice(0, 160) };
  }
}

module.exports = { get, set, del, list, etat, distant };
