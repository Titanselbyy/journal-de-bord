"use strict";
/* La collecte : interroger les flux, ne garder que ce qui touche aux SI,
   dédoublonner, insérer, diffuser à tous les utilisateurs.
   Trois précautions qui font la différence en production :
     — une seule collecte à la fois (un bouton « Actualiser » cliqué dix fois
       ne doit pas lancer dix rafales sur les serveurs des éditeurs) ;
     — requêtes conditionnelles (ETag / If-Modified-Since) : un flux qui n'a
       pas bougé répond 304 et ne coûte rien ;
     — une source en panne n'interrompt pas les dix autres.                    */

const { parseFeed, decodeBody } = require("./feed.js");
const D = require("./db.js");
const R = require("./rank.js");

const RANK_WINDOW_H = Number(process.env.RANK_WINDOW_H) || 168;   // vivier de sélection
const MAX_NOTIFS = Number(process.env.MAX_NOTIFS) || 10;          // notifications par passe

const UA = "veille-si/1.0 (collecte de veille, contact: admin@localhost)";
const TIMEOUT_MS = 15000;   // certains flux (The Register) dépassent 12 s aux heures chargées
const MAX_FAILS = 6;            // au-delà, la source est mise en sommeil

/* Ce qui compte comme « systèmes d'information ». Volontairement large sur les
   thèmes métier, strict sur le grand public : c'est ce filtre qui distingue une
   veille professionnelle d'un fil d'actualité tech. */
/* Les acronymes se cherchent EN RESPECTANT LA CASSE. En insensible, « AI »
   attrape le « ai » de « j'ai », « SI » le « si » conditionnel et « IT » le
   « it » anglais : la moitié du web devient une actualité SI. */
const ACRONYMS = /\b(DSI|SI|SIRH|ERP|PGI|CRM|ETL|API|SOC|MSP|PRA|PCA|RGPD|GDPR|NIS ?2|IT|IA|AI|LLM|VPN|EDR|XDR|SaaS|PaaS|IaaS)\b/;

const TOPIC = new RegExp([
  // thèmes métier, en français et en anglais — insensibles à la casse
  String.raw`syst[eè]mes? d.information`,
  String.raw`(infrastructure|datacenter|data ?center|cloud|virtualisation|kubernetes|devops)`,
  String.raw`(cybers[eé]curit[eé]|cybersecurity|ransomware|vuln[eé]rabilit|faille|piratage|breach|phishing)`,
  String.raw`(conformit[eé]|gouvernance|souverainet[eé]|h[eé]bergement)`,
  String.raw`(donn[eé]es|base de donn[eé]es|entrep[oô]t de donn[eé]es|data ?(lake|warehouse|center)?)`,
  String.raw`(architecture|int[eé]gration|migration|interop[eé]rabilit[eé])`,
  String.raw`(informatique|num[eé]rique|logiciel|software|progiciel|[eé]diteur|infog[eé]rance|prestataire)`,
  String.raw`(r[eé]seau|serveur|sauvegarde|supervision|observabilit[eé])`,
  String.raw`(intelligence artificielle|machine learning|open ?source)`
].join("|"), "i");

function relevant(item){
  const text = item.title + " " + (item.summary || "");
  return ACRONYMS.test(text) || TOPIC.test(text);
}

/* ---------------- une source ---------------- */
async function pullSource(src){
  const headers = { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" };
  if(src.etag) headers["if-none-match"] = src.etag;
  if(src.last_modified) headers["if-modified-since"] = src.last_modified;

  const res = await fetch(src.url, { headers, redirect: "follow",
                                     signal: AbortSignal.timeout(TIMEOUT_MS) });

  if(res.status === 304){
    D.sources.ok(src.id, src.etag, src.last_modified);
    return { source: src.name, status: 304, seen: 0, added: 0 };
  }
  if(!res.ok) throw new Error("HTTP " + res.status);

  const xml = decodeBody(await res.arrayBuffer(), res.headers.get("content-type"));
  const feed = parseFeed(xml);
  if(!feed.items.length) throw new Error("aucun article lisible dans le flux");

  let added = 0, kept = 0;
  for(const it of feed.items){
    if(src.filtered && !relevant(it)) continue;
    kept++;
    try{
      const isNew = D.articles.save({
        source_id: src.id, guid: it.guid, url_key: it.url_key, url: it.url,
        title: it.title, summary: it.summary, author: it.author,
        lang: it.lang || src.lang, published_at: it.published_at
      });
      if(isNew) added++;
    }catch(e){ /* un article fautif ne condamne pas la source */ }
  }
  D.sources.ok(src.id, res.headers.get("etag"), res.headers.get("last-modified"));
  return { source: src.name, status: res.status, seen: feed.items.length, kept, added };
}

/* ---------------- une passe complète ---------------- */
let inflight = null;
let lastEnded = 0;

async function runOnce(trigger){
  const runId = D.runs.start(trigger);
  const sources = D.sources.active();
  const detail = [];
  let added = 0, errors = 0;

  // En série et non en parallèle : onze flux d'un coup, c'est une rafale que
  // certains éditeurs prennent pour une attaque. La collecte n'est pas pressée.
  for(const src of sources){
    if(src.fail_count >= MAX_FAILS){
      detail.push({ source: src.name, status: "en sommeil (échecs répétés)" });
      continue;
    }
    try{
      const r = await pullSource(src);
      added += r.added;
      detail.push(r);
    }catch(e){
      errors++;
      D.sources.fail(src.id, e.message);
      detail.push({ source: src.name, error: e.message.slice(0, 120) });
    }
  }
  /* La sélection. Elle porte sur TOUT ce qui est récent, pas seulement sur les
     nouveautés de cette passe : un article d'hier devient majeur le jour où une
     deuxième rédaction le reprend. La promotion est idempotente — un article
     déjà notifié ne resonne pas. */
  let promus = 0;
  try{
    const pool = D.articles.recent(RANK_WINDOW_H);
    for(const art of R.select(pool, { max: MAX_NOTIFS })){
      if(D.articles.promote(art) > 0) promus++;
    }
  }catch(e){
    detail.push({ source: "sélection", error: e.message.slice(0, 120) });
    errors++;
  }

  const stats = { fetched: sources.length, added, promus, errors, detail };
  D.runs.end(runId, stats);
  lastEnded = Date.now();
  return stats;
}

/* Une seule collecte à la fois : les appels concurrents rejoignent celle en cours. */
function collect(trigger = "cron"){
  if(inflight) return inflight;
  inflight = runOnce(trigger).finally(() => { inflight = null; });
  return inflight;
}

function busy(){ return inflight !== null; }
function sinceLast(){ return Date.now() - lastEnded; }

module.exports = { collect, busy, sinceLast, relevant, TOPIC, ACRONYMS };
