"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("../lib/feed.js");

/* ---------------- lecture des flux ---------------- */
test("RSS 2.0 : titre, lien, date, résumé", () => {
  const xml = `<rss><channel><title>Flux</title><item>
    <title>Migration ERP</title><link>https://exemple.fr/erp?utm_source=rss</link>
    <description>&lt;p&gt;Un &amp;laquo; retour &amp;raquo; d'expérience&lt;/p&gt;</description>
    <pubDate>Tue, 02 Sep 2026 10:30:00 +0200</pubDate>
    <guid>https://exemple.fr/erp</guid></item></channel></rss>`;
  const f = F.parseFeed(xml);
  assert.equal(f.items.length, 1);
  const it = f.items[0];
  assert.equal(it.title, "Migration ERP");
  assert.equal(it.summary, "Un « retour » d'expérience");
  assert.equal(it.published_at, "2026-09-02T08:30:00.000Z");
  assert.equal(it.url_key, "exemple.fr/erp", "les paramètres utm doivent sauter");
});

test("Atom : link rel=alternate, pas le self", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>F</title><entry>
    <title>Kubernetes 1.33</title>
    <link rel="self" href="https://exemple.fr/self"/>
    <link rel="alternate" href="https://exemple.fr/k8s"/>
    <id>tag:exemple,2026:1</id><updated>2026-09-01T12:00:00Z</updated>
    <summary>Nouveautés</summary></entry></feed>`;
  const it = F.parseFeed(xml).items[0];
  assert.equal(it.url, "https://exemple.fr/k8s");
  assert.equal(it.guid, "tag:exemple,2026:1");
});

test("RSS 1.0 (RDF) : les items sont à la racine", () => {
  const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel><title>Flux</title></channel>
    <item rdf:about="https://exemple.fr/a"><title>Cybersécurité</title>
    <link>https://exemple.fr/a</link><dc:date>2026-08-30T09:00:00+02:00</dc:date>
    <dc:creator>Alice</dc:creator></item></rdf:RDF>`;
  const it = F.parseFeed(xml).items[0];
  assert.equal(it.title, "Cybersécurité");
  assert.equal(it.author, "Alice");
  assert.equal(it.published_at, "2026-08-30T07:00:00.000Z");
});

test("CDATA et balises HTML dans le titre", () => {
  const xml = `<rss><channel><item><title><![CDATA[Le <b>RGPD</b> & vous]]></title>
    <link>https://x.fr/1</link></item></channel></rss>`;
  assert.equal(F.parseFeed(xml).items[0].title, "Le RGPD & vous");
});

test("un item sans titre ni lien est ignoré, pas fatal", () => {
  const xml = `<rss><channel><item><description>orphelin</description></item>
    <item><title>Bon</title><link>https://x.fr/2</link></item></channel></rss>`;
  const f = F.parseFeed(xml);
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].title, "Bon");
});

test("décodage ISO-8859-15 d'après l'en-tête HTTP", () => {
  const latin = Buffer.from("<rss><item><title>syst\xE8me</title>" +
                            "<link>https://x.fr/3</link></item></rss>", "latin1");
  const xml = F.decodeBody(latin, "application/rss+xml; charset=ISO-8859-15");
  assert.match(xml, /système/);
});

test("décodage d'après la déclaration XML quand l'en-tête ment", () => {
  const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>' +
    "<rss><item><title>donn\xE9es</title><link>https://x.fr/4</link></item></rss>", "latin1");
  const xml = F.decodeBody(latin, "text/xml");   // aucun charset annoncé
  assert.match(xml, /données/);
});

test("normalisation d'URL : www, casse, fragment, traqueurs", () => {
  assert.equal(F.urlKey("https://WWW.Exemple.FR/Article/?utm_medium=x&id=7#top"),
               "exemple.fr/article/?id=7".replace("/?", "/?"));
  assert.equal(F.urlKey("http://exemple.fr/a/"), F.urlKey("https://www.exemple.fr/a"));
});

/* ---------------- pertinence ---------------- */
const C = require("../lib/collector.js");
test("le filtre retient les sujets SI", () => {
  for(const t of ["Migration ERP au CHU", "Le RGPD et les DSI", "Panne cloud chez OVH",
                  "Vulnérabilité critique dans Exim", "Kubernetes en production"])
    assert.ok(C.relevant({ title: t, summary: "" }), t);
});
test("le filtre écarte le grand public", () => {
  for(const t of ["Test : le meilleur aspirateur robot", "J'ai vu le dernier Marvel",
                  "Si vous aimez ce film, essayez celui-ci", "Recette de tarte"])
    assert.ok(!C.relevant({ title: t, summary: "" }), t);
});
