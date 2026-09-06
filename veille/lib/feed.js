"use strict";
/* Lecture des flux : RSS 2.0, RSS 1.0 (RDF) et Atom, plus la question des
   encodages. Beaucoup de flux français sont encore servis en ISO-8859-1/15 —
   les décoder en UTF-8 par défaut transforme « système » en « systÃ¨me ».
   D'où le décodage explicite d'après l'en-tête HTTP puis la déclaration XML. */

/* Lettres accentuées : la casse de l'entité donne celle de la lettre
   (&Eacute; → É). Les traiter en vrac aurait mis des minuscules en tête de phrase. */
const LETTERS = {
  agrave:"à", aacute:"á", acirc:"â", atilde:"ã", auml:"ä", aring:"å", aelig:"æ",
  ccedil:"ç", egrave:"è", eacute:"é", ecirc:"ê", euml:"ë",
  igrave:"ì", iacute:"í", icirc:"î", iuml:"ï", ntilde:"ñ",
  ograve:"ò", oacute:"ó", ocirc:"ô", otilde:"õ", ouml:"ö", oslash:"ø", oelig:"œ",
  ugrave:"ù", uacute:"ú", ucirc:"û", uuml:"ü", yacute:"ý", yuml:"ÿ", szlig:"ß"
};
/* Ponctuation et symboles : ce que la presse en ligne emploie réellement. */
const SYMBOLS = {
  amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", ensp:" ", emsp:" ", thinsp:" ",
  laquo:"«", raquo:"»", lsquo:"‘", rsquo:"’", sbquo:"‚", ldquo:"“", rdquo:"”", bdquo:"„",
  hellip:"…", mdash:"—", ndash:"–", minus:"−", bull:"•", middot:"·", sect:"§",
  deg:"°", euro:"€", pound:"£", yen:"¥", cent:"¢", copy:"©", reg:"®", trade:"™",
  times:"×", divide:"÷", plusmn:"±", frac12:"½", frac14:"¼", sup2:"²", sup3:"³",
  permil:"‰", dagger:"†", prime:"′", eur:"€", shy:"", zwj:"", zwnj:""
};

function namedEntity(code){
  const low = code.toLowerCase();
  if(SYMBOLS[low] !== undefined) return SYMBOLS[low];
  const letter = LETTERS[low];
  if(letter === undefined) return undefined;
  // &Eacute; (majuscule initiale) → É ; &eacute; → é
  return code[0] === code[0].toUpperCase() ? letter.toUpperCase() : letter;
}

function unescapeXml(s){
  if(!s) return "";
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, code) => {
    if(code[0] === "#"){
      const n = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    const hit = namedEntity(code);
    return hit === undefined ? whole : hit;
  });
}

/* L'ordre compte. Les flux livrent leur HTML échappé (&lt;p&gt;) : retirer les
   balises avant de désarmer les entités ne retire rien du tout, et le résumé
   s'affiche avec ses <p> en clair. On désarme, on retire, puis on désarme une
   seconde fois — certains flux échappent deux fois (&amp;laquo;). */
function stripTags(s){
  let t = unescapeXml(String(s || ""));
  t = t.replace(/<[^>]*>/g, " ");
  t = unescapeXml(t);
  return t.replace(/\s+/g, " ").trim();
}

/* Décodage d'après le charset annoncé. On lit d'abord l'en-tête HTTP, puis la
   déclaration XML des premiers octets — l'un des deux ment souvent, jamais les deux. */
function decodeBody(buf, contentType){
  const bytes = Buffer.from(buf);
  let charset = null;
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || "");
  if(fromHeader) charset = fromHeader[1];
  if(!charset){
    const head = bytes.subarray(0, 200).toString("latin1");
    const fromXml = /encoding=["']([\w-]+)["']/i.exec(head);
    if(fromXml) charset = fromXml[1];
  }
  charset = (charset || "utf-8").toLowerCase();
  if(charset === "iso-8859-15") charset = "iso-8859-15";
  try{
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  }catch(e){
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);  // dernier recours
  }
}

/* Un bloc XML, un nom de balise (sans préfixe de namespace) → son contenu texte.
   Accepte <dc:date>, <content:encoded>, les CDATA et les balises auto-fermées. */
function tagText(block, ...names){
  for(const name of names){
    // String.raw : sans lui, les échappements du motif seraient mangés par la chaîne
    const re = new RegExp(
      String.raw`<(?:[\w-]+:)?` + name + String.raw`(?:\s[^>]*)?>([\s\S]*?)<` +
      String.raw`\/(?:[\w-]+:)?` + name + ">", "i");
    const m = re.exec(block);
    if(m){
      let v = m[1].trim();
      const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
      if(cdata) v = cdata[1].trim();
      if(v) return v;
    }
  }
  return "";
}

function tagAttr(block, name, attr){
  const re = new RegExp(String.raw`<(?:[\w-]+:)?` + name + String.raw`\s([^>]*)>`, "gi");
  let m;
  while((m = re.exec(block))){
    const at = new RegExp(attr + String.raw`\s*=\s*["']([^"']*)["']`, "i").exec(m[1]);
    if(at) return at[1];
  }
  return "";
}

/* Atom autorise plusieurs <link> : on veut celui qui mène à l'article. */
function atomLink(block){
  const links = block.match(/<(?:[\w-]+:)?link\s[^>]*>/gi) || [];
  let fallback = "";
  for(const l of links){
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(l);
    if(!href) continue;
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(l);
    if(!rel || rel[1].toLowerCase() === "alternate") return href[1];
    if(!fallback) fallback = href[1];
  }
  return fallback;
}

function toIso(raw){
  if(!raw) return null;
  const d = new Date(raw.trim());
  if(!isNaN(d.getTime())) return d.toISOString();
  // RFC 822 avec fuseau nommé que Date ne connaît pas toujours (CEST, MEZ…)
  const cleaned = raw.replace(/\s+\([^)]*\)\s*$/, "").replace(/\s+[A-Z]{2,5}$/, " GMT");
  const d2 = new Date(cleaned);
  return isNaN(d2.getTime()) ? null : d2.toISOString();
}

/* URL de comparaison : c'est elle qui empêche le même article d'apparaître
   trois fois parce que trois agrégateurs l'ont repris. */
function urlKey(raw){
  try{
    const u = new URL(raw);
    u.hash = "";
    u.host = u.host.toLowerCase().replace(/^www\./, "");
    u.protocol = "https:";
    for(const p of [...u.searchParams.keys()]){
      if(/^(utm_|fbclid|gclid|mc_|ref|source$)/i.test(p)) u.searchParams.delete(p);
    }
    let s = u.toString().replace(/^https:\/\//, "");
    return s.replace(/\/$/, "").toLowerCase();
  }catch(e){
    return String(raw || "").trim().toLowerCase();
  }
}

function parseFeed(xml){
  const feedTitle = stripTags(tagText(xml.replace(/<(?:item|entry)[\s\S]*$/i, ""), "title"));
  const feedLang = tagText(xml, "language") ||
                   tagAttr(xml, "feed", "xml:lang") || null;

  // RSS 1.0 place les <item> à la racine, RSS 2.0 dans <channel>, Atom utilise <entry>.
  const blocks = xml.match(/<(?:[\w-]+:)?(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w-]+:)?\1>/gi) || [];

  const items = [];
  for(const b of blocks){
    try{
      const url = (tagText(b, "link") && !/^</.test(tagText(b, "link")))
        ? unescapeXml(tagText(b, "link"))
        : (atomLink(b) || unescapeXml(tagAttr(b, "link", "href")) ||
           unescapeXml(tagText(b, "guid")));
      const title = stripTags(tagText(b, "title"));
      if(!url || !title) continue;                       // sans titre ni lien, inexploitable
      const guid = unescapeXml(tagText(b, "guid", "id")) || urlKey(url);
      const summary = stripTags(
        tagText(b, "description", "summary", "encoded", "content")).slice(0, 600);
      items.push({
        guid, url: url.trim(), url_key: urlKey(url), title: title.slice(0, 400),
        summary: summary || null,
        author: stripTags(tagText(b, "creator", "author", "name")).slice(0, 120) || null,
        published_at: toIso(tagText(b, "pubDate", "published", "updated", "date")),
        lang: feedLang
      });
    }catch(e){ /* un item malformé ne doit pas condamner tout le flux */ }
  }
  return { title: feedTitle, lang: feedLang, items };
}

module.exports = { parseFeed, decodeBody, urlKey, stripTags, unescapeXml, toIso };
