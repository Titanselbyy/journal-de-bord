"use strict";
/* Rejoue la sélection sur toute la base : remet à zéro ce qui a été notifié et
   ne rediffuse que le majeur. À lancer après un changement de seuil, de source
   ou de règle de fiabilité.                                                   */
const D = require("../lib/db.js");
const R = require("../lib/rank.js");
for(const s of require("../lib/sources.js"))
  D.sources.add(s.url, s.name, s.lang, s.filtered, s.trust, s.weight);

const avant = D.db.prepare("SELECT COUNT(*) c FROM article_user").get().c;
D.db.exec("DELETE FROM article_user");
D.db.exec("UPDATE articles SET major = 0, score = NULL, trust_level = NULL");

const pool = D.articles.recent(Number(process.env.RANK_WINDOW_H) || 168);
const sel = R.select(pool, { max: Number(process.env.MAX_NOTIFS) || 10 });
for(const a of sel) D.articles.promote(a);

const total = D.db.prepare("SELECT COUNT(*) c FROM articles").get().c;
const fr = sel.filter(a => a.lang !== "en").length;
console.log("Base        : " + total + " articles");
console.log("Vivier 7 j  : " + pool.length);
console.log("Notifié     : " + sel.length + "  (" + fr + " FR / " + (sel.length - fr) + " EN)");
console.log("Liaisons    : " + avant + " → " + D.db.prepare("SELECT COUNT(*) c FROM article_user").get().c);
console.log("");
for(const a of sel)
  console.log("  " + a.score.toFixed(1).padStart(5) + "  " + (a.lang || "??").toUpperCase() +
    "  " + a.trustLevel.padEnd(9) + (a.confirms + " src").padEnd(7) +
    a.source.slice(0, 18).padEnd(19) + a.title.slice(0, 50));
