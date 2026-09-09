"use strict";
/* La réécriture des résumés.

   Ce qui arrive du flux RSS est l'accroche du journal : tronquée, parfois
   commerciale, et en anglais une fois sur trois. `feed.js` en retire déjà les
   scories, mais nettoyer n'est pas rédiger. Ici, on demande à Claude deux ou
   trois phrases en français, factuelles, qui tiennent debout toutes seules.

   Trois garde-fous, parce que l'appel coûte de l'argent et que le site est
   public :
     · on ne réécrit qu'un article DÉJÀ EN BASE, désigné par son identifiant —
       jamais du texte libre envoyé par le navigateur ;
     · le résultat est mémorisé : deux clics sur la même actualité, un seul appel ;
     · un plafond horaire borne la casse si quelqu'un s'amuse avec l'URL.
   Sans clé d'API, tout cela s'efface proprement : le journal retombe sur le
   résumé nettoyé et l'utilisateur n'y voit qu'un texte un peu moins élégant.   */

const MODELE   = "claude-opus-5";
const PLAFOND  = Number(process.env.REDACTION_MAX_PAR_HEURE) || 40;
const TIMEOUT  = 25000;

const SYSTEME = [
  "Tu rédiges des résumés d'actualité pour le journal de bord professionnel",
  "d'un étudiant en systèmes d'information.",
  "",
  "Règles :",
  "— deux à trois phrases, en français, au présent, à la voix active ;",
  "— strictement factuel : uniquement ce que contiennent le titre et l'extrait",
  "  fournis. N'ajoute aucun chiffre, aucune date, aucun nom qui n'y figure pas ;",
  "— si l'extrait est trop maigre pour trois phrases, écris-en une seule ;",
  "— traduis en français si la source est anglophone ;",
  "— pas de formule d'accroche, pas de superlatif, pas de « cet article explique ».",
  "  On écrit ce qui s'est passé, pas ce que le journal en dit ;",
  "— aucun titre, aucune puce, aucun guillemet autour du tout : du texte courant."
].join("\n");

let client = null;
function clientOuNull(){
  if(!process.env.ANTHROPIC_API_KEY) return null;
  if(client) return client;
  try{
    const Anthropic = require("@anthropic-ai/sdk");
    client = new (Anthropic.default || Anthropic)();
    return client;
  }catch(e){ return null; }
}
const disponible = () => !!clientOuNull();

/* Mémoire : l'identifiant de l'article vers son texte rédigé. La base de veille
   étant éphémère sur l'offre gratuite, une simple Map suffit — elle disparaît
   avec les articles qu'elle décrit. */
const memoire = new Map();
let fenetre = { debut: Date.now(), n: 0 };

function quotaDepasse(){
  const uneHeure = 3600000;
  if(Date.now() - fenetre.debut > uneHeure) fenetre = { debut: Date.now(), n: 0 };
  return fenetre.n >= PLAFOND;
}

function texteDe(reponse){
  return (reponse.content || [])
    .filter(b => b.type === "text").map(b => b.text).join("").trim();
}

/* Rend { texte, origine } — origine vaut "claude" quand la phrase a été rédigée,
   "flux" quand on a dû s'en tenir au résumé d'origine. L'appelant affiche donc
   toujours quelque chose, et sait ce qu'il affiche. */
async function resumer(article){
  const brut = (article.summary || "").trim();
  const repli = { texte: brut, origine: "flux" };

  const c = clientOuNull();
  if(!c) return repli;
  if(memoire.has(article.id)) return { texte: memoire.get(article.id), origine: "claude" };
  if(quotaDepasse()) return repli;

  const demande = [
    "Source : " + (article.source || "inconnue"),
    "Langue d'origine : " + (article.lang || "fr"),
    "Titre : " + article.title,
    brut ? "Extrait du flux : " + brut : "Extrait du flux : (aucun)"
  ].join("\n");

  fenetre.n++;
  const reponse = await c.beta.messages.create({
    model: MODELE,
    max_tokens: 1000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },   // deux phrases factuelles : inutile de creuser
    system: SYSTEME,
    messages: [{ role: "user", content: demande }]
  }, { timeout: TIMEOUT });

  // Un refus de bout en bout laisse `content` inexploitable : on garde le flux.
  if(reponse.stop_reason === "refusal") return repli;
  const texte = texteDe(reponse);
  if(!texte) return repli;

  memoire.set(article.id, texte);
  return { texte: texte, origine: "claude" };
}

module.exports = { resumer, disponible, MODELE };
