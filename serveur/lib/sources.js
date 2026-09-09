"use strict";
/* Les flux, tous vérifiés en conditions réelles.
   trust : "officiel" = source primaire (autorité publique, CERT). Une information
           qui en vient est publiable seule : elle n'a personne à confirmer.
           "presse" = rédaction. Il en faut DEUX, indépendantes, pour promouvoir
           une information — c'est la seule fiabilité qu'une machine sait garantir.
   weight : poids éditorial, départage les sujets à mérite égal.
   filtered : flux généraliste dont on ne garde que ce qui touche aux SI.
   publisher : la rédaction derrière le flux, quand plusieurs flux la partagent.
           Deux fils d'un même journal ne se confirment pas l'un l'autre.        */

module.exports = [
  /* ---------- français · sources officielles ---------- */
  { url: "https://www.cert.ssi.gouv.fr/alerte/feed/",
    name: "CERT-FR · alertes", lang: "fr", trust: "officiel", weight: 3.0, filtered: false,
    publisher: "CERT-FR" },
  { url: "https://www.cert.ssi.gouv.fr/avis/feed/",
    name: "CERT-FR · avis", lang: "fr", trust: "officiel", weight: 2.0, filtered: false,
    publisher: "CERT-FR" },
  { url: "https://www.cert.ssi.gouv.fr/actualite/feed/",
    name: "CERT-FR · actualités", lang: "fr", trust: "officiel", weight: 1.8, filtered: false,
    publisher: "CERT-FR" },
  { url: "https://www.cnil.fr/fr/rss.xml",
    name: "CNIL", lang: "fr", trust: "officiel", weight: 2.4, filtered: false },

  /* ---------- français · presse spécialisée ---------- */
  { url: "https://www.lemondeinformatique.fr/flux-rss/thematique/toutes-les-actualites/rss.xml",
    name: "Le Monde Informatique", lang: "fr", trust: "presse", weight: 2.0, filtered: false },
  { url: "https://www.silicon.fr/feed",
    name: "Silicon.fr", lang: "fr", trust: "presse", weight: 1.8, filtered: false },
  { url: "https://www.usine-digitale.fr/rss",
    name: "L'Usine Digitale", lang: "fr", trust: "presse", weight: 1.7, filtered: false },
  { url: "https://next.ink/feed/",
    name: "Next", lang: "fr", trust: "presse", weight: 1.6, filtered: true },
  { url: "https://www.zdnet.fr/feeds/rss/actualites/",
    name: "ZDNet France", lang: "fr", trust: "presse", weight: 1.3, filtered: true },
  { url: "https://www.journaldunet.com/rss/",
    name: "Journal du Net", lang: "fr", trust: "presse", weight: 1.2, filtered: true,
    publisher: "Journal du Net" },
  { url: "https://www.journaldunet.com/solutions/rss/",
    name: "Journal du Net · DSI", lang: "fr", trust: "presse", weight: 1.5, filtered: false,
    publisher: "Journal du Net" },
  { url: "https://www.larevuedudigital.com/feed/",
    name: "La Revue du Digital", lang: "fr", trust: "presse", weight: 1.4, filtered: false },
  { url: "https://www.globalsecuritymag.fr/spip.php?page=backend",
    name: "Global Security Mag", lang: "fr", trust: "presse", weight: 1.3, filtered: true },
  { url: "https://actu-dsi.fr/feed",
    name: "Actu DSI", lang: "fr", trust: "presse", weight: 1.0, filtered: true },
  { url: "https://www.cigref.fr/feed",
    name: "Cigref", lang: "fr", trust: "presse", weight: 1.8, filtered: false },
  { url: "https://www.itforbusiness.fr/feed",
    name: "IT for Business", lang: "fr", trust: "presse", weight: 1.7, filtered: false },
  { url: "https://www.zataz.com/feed/",
    name: "ZATAZ", lang: "fr", trust: "presse", weight: 1.6, filtered: false },
  { url: "https://itsocial.fr/feed/",
    name: "IT Social", lang: "fr", trust: "presse", weight: 1.4, filtered: false },
  { url: "https://www.undernews.fr/feed",
    name: "UnderNews", lang: "fr", trust: "presse", weight: 1.4, filtered: false },
  { url: "https://www.developpez.com/index/rss",
    name: "Developpez.com", lang: "fr", trust: "presse", weight: 1.3, filtered: false },
  { url: "https://www.channelnews.fr/feed",
    name: "Channelnews", lang: "fr", trust: "presse", weight: 1.2, filtered: false },
  { url: "https://www.programmez.com/rss.xml",
    name: "Programmez!", lang: "fr", trust: "presse", weight: 1.2, filtered: false },

  /* ---------- français · presse généraliste, filtrée sur les SI ----------
     Ces rédactions ne parlent pas que d'informatique : `filtered` ne retient que
     ce qui touche aux systèmes d'information. Elles sont là pour une raison
     précise — ce sont elles qui reprennent les grands sujets, et c'est cette
     reprise qui fait passer une information de « unique » à « confirmé ». */
  { url: "https://www.lemonde.fr/pixels/rss_full.xml",
    name: "Le Monde · Pixels", lang: "fr", trust: "presse", weight: 1.8, filtered: true },
  { url: "https://www.numerama.com/feed/",
    name: "Numerama", lang: "fr", trust: "presse", weight: 1.5, filtered: true },
  { url: "https://www.usinenouvelle.com/rss",
    name: "L'Usine Nouvelle", lang: "fr", trust: "presse", weight: 1.5, filtered: true },
  { url: "https://www.latribune.fr/feed.xml",
    name: "La Tribune", lang: "fr", trust: "presse", weight: 1.4, filtered: true },
  { url: "https://www.lebigdata.fr/feed",
    name: "Le Big Data", lang: "fr", trust: "presse", weight: 1.2, filtered: true },
  { url: "https://korben.info/feed",
    name: "Korben", lang: "fr", trust: "presse", weight: 1.1, filtered: true },
  { url: "https://www.clubic.com/feed/news.rss",
    name: "Clubic", lang: "fr", trust: "presse", weight: 1.0, filtered: true },
  { url: "https://www.01net.com/feed/",
    name: "01net", lang: "fr", trust: "presse", weight: 1.0, filtered: true },
  { url: "https://linuxfr.org/news.atom",
    name: "LinuxFr", lang: "fr", trust: "presse", weight: 1.0, filtered: true },

  /* ---------- anglais · sources officielles ---------- */
  { url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    name: "CISA · advisories", lang: "en", trust: "officiel", weight: 2.6, filtered: false },
  { url: "https://www.ncsc.gov.uk/api/1/services/v1/report-rss-feed.xml",
    name: "NCSC UK", lang: "en", trust: "officiel", weight: 2.4, filtered: false },

  /* ---------- anglais · presse spécialisée ---------- */
  { url: "https://www.bleepingcomputer.com/feed/",
    name: "BleepingComputer", lang: "en", trust: "presse", weight: 2.0, filtered: false },
  { url: "https://feeds.feedburner.com/TheHackersNews",
    name: "The Hacker News", lang: "en", trust: "presse", weight: 1.8, filtered: false },
  { url: "https://www.ciodive.com/feeds/news/",
    name: "CIO Dive", lang: "en", trust: "presse", weight: 1.9, filtered: false },
  { url: "https://www.theregister.com/headlines.atom",
    name: "The Register", lang: "en", trust: "presse", weight: 1.7, filtered: true },
  { url: "https://feed.infoq.com/",
    name: "InfoQ", lang: "en", trust: "presse", weight: 1.6, filtered: false },
  { url: "https://www.computerworld.com/feed/",
    name: "Computerworld", lang: "en", trust: "presse", weight: 1.4, filtered: true },
  { url: "https://feeds.arstechnica.com/arstechnica/technology-lab",
    name: "Ars Technica · IT", lang: "en", trust: "presse", weight: 1.3, filtered: true }
];
