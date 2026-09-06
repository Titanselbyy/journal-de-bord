"use strict";
/* Collecte unique, pour un cron système ou une vérification à la main :
     node scripts/collect-once.js                                            */
const D = require("../lib/db.js");
const collector = require("../lib/collector.js");
const SOURCES = require("../lib/sources.js");

D.users.ensure(process.env.VEILLE_USER || "moi@local", "Moi");
for(const s of SOURCES)
  D.sources.add(s.url, s.name, s.lang, s.filtered, s.trust, s.weight);

collector.collect("manuel (cli)").then(function(stats){
  console.log("Sources interrogées :", stats.fetched);
  console.log("Nouveaux articles   :", stats.added);
  console.log("Erreurs             :", stats.errors);
  for(const d of stats.detail){
    console.log("  " + String(d.source).padEnd(24),
      d.error ? "ÉCHEC — " + d.error
              : (d.status === 304 ? "inchangé"
                 : (d.added + " nouveaux / " + (d.kept !== undefined ? d.kept : d.seen) + " retenus"))); 
  }
  process.exit(0);
}).catch(function(e){ console.error(e); process.exit(1); });
