"use strict";
/* La sélection : de tout ce qui a été ramassé, ne notifier que le majeur — et
   seulement ce dont la provenance tient debout.

   Aucun programme ne sait dire si une information est VRAIE. Ce qu'il sait
   établir, c'est d'où elle vient :
     · « officiel »  — autorité publique ou CERT. Source primaire : elle se
                       suffit à elle-même, personne n'a à la confirmer.
     · « confirmé »  — deux rédactions indépendantes au moins couvrent le sujet.
     · « unique »    — une seule source non officielle. Gardé en base, jamais
                       notifié : c'est peut-être vrai, ce n'est pas établi.
   C'est cette règle qui règle aussi le volume : sur trois cents articles par
   jour, une poignée franchit la barre.                                        */

const STOP = new Set(("le la les un une des du de au aux et ou mais donc or ni car " +
  "ce cet cette ces son sa ses leur leurs pour par sur sous dans avec sans vers " +
  "que qui quoi dont ou est sont etre avoir plus moins tres tout tous toute " +
  "the and for with from that this what which are was were has have had been " +
  "will would could should about into over after before their its his her they " +
  "you your our not but all can new now how why when who whom").split(" "));

/* Sujets qui font une actualité majeure : incident, décision, argent, régulation. */
const MAJOR = new RegExp([
  "faille critique", "zero.?day", "0.?day", "exploit[eé]e? activement",
  "actively exploited", "critical (flaw|vulnerability|bug)", "ran[cç]ongiciel",
  "ransomware", "cyberattaque", "cyberattack", "fuite de donn[eé]es", "data breach",
  "breach", "piratage", "hacked", "panne (mondiale|majeure|g[eé]n[eé]rale)",
  "outage", "rappel de s[eé]curit[eé]", "patch (tuesday|urgent)", "correctif urgent",
  "rachat", "acquisition", "fusion", "lev[eé]e de fonds", "acquires", "acquisition of",
  "amende", "sanction", "condamn", "fine[ds]?\b", "proc[eè]s", "lawsuit",
  "r[eé]glementation", "directive", "\bNIS ?2\b", "\bDORA\b", "AI Act",
  "\bRGPD\b", "\bGDPR\b", "loi\b", "d[eé]cret", "regulation",
  "souverainet[eé]", "sovereign", "abandonne", "ferme", "shuts? down",
  "fin de support", "end of (life|support)", "\bEOL\b"
].join("|"), "i");

/* Ce qui n'est pas de l'actualité : billets pratiques, promos, tests produits. */
const NOISE = new RegExp([
  "^test ?:", "^comparatif", "les meilleurs?", "top ?\d", "^tuto", "astuce",
  "bon plan", "promo", "^\-?\d+ ?%", "soldes", "black friday",
  "how to\b", "^best ", "guide (complet|pratique|d.achat)", "buying guide",
  "^\d+ (fa[cç]ons|mani[eè]res|astuces|things|ways|tips)", "deal[s]?\b",
  "sponsored", "publi.?r[eé]dactionnel", "webinar", "livre blanc",
  // vie administrative des autorités : utile en archive, ce n'est pas une actualité
  "ordre du jour", "s[eé]ance pl[eé]ni[eè]re", "calendrier", "nomination",
  "rapport annuel", "consultation publique", "appel [aà] (candidatures|projets)"
].join("|"), "i");

function tokens(text){
  return new Set(String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // sans accents : « données » ≈ « donnees »
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w)));
}

/* Deux titres parlent-ils du même sujet ? On exige des mots significatifs en
   commun ET une part suffisante — sinon deux articles sur « Microsoft » seraient
   déclarés identiques. */
function sameStory(a, b){
  const A = a._tok, B = b._tok;
  let inter = 0;
  for(const w of A) if(B.has(w)) inter++;
  if(inter < 2) return false;
  const union = A.size + B.size - inter;
  return union > 0 && inter / union >= 0.28;
}

/* Regroupe les articles par sujet et compte les rédactions DISTINCTES.
   Deux articles de la même source ne se confirment pas l'un l'autre. */
function cluster(articles){
  // Sur le TITRE seul : les résumés noient l'intersection sous des mots communs
  // et deux articles sur le même sujet cessent de se ressembler.
  for(const a of articles) a._tok = tokens(a.title);
  const groups = [];
  for(const a of articles){
    let placed = false;
    for(const g of groups){
      if(sameStory(a, g[0])){ g.push(a); placed = true; break; }
    }
    if(!placed) groups.push([a]);
  }
  const map = new Map();
  for(const g of groups){
    const sources = new Set(g.map(x => x.source_id));
    for(const a of g) map.set(a, { size: g.length, sources: sources.size, group: g });
  }
  return map;
}

function hoursSince(iso){
  if(!iso) return 48;
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  return isNaN(h) ? 48 : h;
}

/* Note d'importance. Volontairement lisible : chaque terme est justifiable
   devant quelqu'un qui demande « pourquoi celui-là et pas l'autre ? ». */
function score(a, info){
  const text = a.title + " " + (a.summary || "");
  let s = a.weight || 1.5;

  if(a.trust === "officiel") s += 2.2;              // source primaire
  s += Math.max(0, info.sources - 1) * 1.6;         // chaque confirmation pèse

  if(MAJOR.test(text)) s += 2.0;
  if(NOISE.test(a.title)) s -= 3.0;

  const h = hoursSince(a.published_at || a.fetched_at);
  if(h <= 12) s += 1.2;
  else if(h <= 24) s += 0.6;
  else if(h > 72) s -= 2.5;        // une actualité de la semaine dernière n'en est plus une

  // Les CERT publient des mises à jour d'alertes anciennes : utile en base,
  // ce n'est pas une notification.
  if(/^\[?M[àa]J\]?|^\[?Update\]?/i.test(a.title)) s -= 2.0;

  if(a.title.length < 25) s -= 0.5;                 // titres tronqués, peu exploitables
  return Math.round(s * 100) / 100;
}

/* Sélection finale : le seuil écarte le tout-venant, le quota impose la parité
   des langues, et la règle de provenance ne laisse passer que l'établi. */
function select(articles, opts){
  const o = Object.assign({ min: 4.6, max: 10, quota: true,
                            maxAgeH: 72, maxAgeOfficialH: 168, perSource: 2 }, opts || {});
  // Fenêtre dure : au-delà, ce n'est plus une actualité, quel que soit le score.
  // Plus longue pour l'officiel : un avis de sécurité reste opposable une semaine,
  // là où une dépêche de presse est périmée en trois jours.
  articles = articles.filter(a => {
    const h = hoursSince(a.published_at || a.fetched_at);
    return h <= (a.trust === "officiel" ? o.maxAgeOfficialH : o.maxAgeH);
  });
  const info = cluster(articles);

  const graded = articles.map(a => {
    const i = info.get(a);
    const confirms = i.sources;
    const trust = a.trust === "officiel" ? "officiel"
                : (confirms >= 2 ? "confirmé" : "unique");
    return Object.assign({}, a, { score: score(a, i), confirms, trustLevel: trust });
  });

  // Un sujet confirmé ne doit être notifié qu'UNE fois : on garde le meilleur
  // article de chaque groupe, pas les trois reprises du même communiqué.
  const best = new Map();
  for(const a of graded){
    const g = info.get(articles.find(x => x.id === a.id) || articles[0]);
    const key = g && g.group ? g.group[0].id : a.id;
    const cur = best.get(key);
    if(!cur || a.score > cur.score) best.set(key, a);
  }

  const eligible = [...best.values()]
    .filter(a => a.trustLevel !== "unique")          // fiabilité : provenance établie
    .filter(a => a.score >= o.min)
    .sort((x, y) => y.score - x.score);

  // Aucune source ne monopolise la notification : les trente avis du jour d'une
  // même autorité noieraient tout le reste.
  const perSrc = new Map();
  const spread = eligible.filter(a => {
    const n = (perSrc.get(a.source_id) || 0) + 1;
    perSrc.set(a.source_id, n);
    return n <= o.perSource;
  });

  if(!o.quota) return spread.slice(0, o.max);

  const half = Math.ceil(o.max / 2);
  const isEn = a => String(a.lang || "").slice(0, 2).toLowerCase() === "en";
  const fr = spread.filter(a => !isEn(a)).slice(0, half);
  const en = spread.filter(isEn).slice(0, half);
  // Si une langue est à court, l'autre comble — mieux vaut dix articles utiles
  // que cinq au nom d'une parité stricte.
  const rest = spread.filter(a => !fr.includes(a) && !en.includes(a));
  const out = fr.concat(en);
  while(out.length < o.max && rest.length) out.push(rest.shift());
  return out.sort((x, y) => y.score - x.score);
}

module.exports = { select, cluster, score, tokens, sameStory, MAJOR, NOISE };
