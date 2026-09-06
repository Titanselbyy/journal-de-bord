# Journal de bord — veille Systèmes d'information

Un arbre de l'année où l'on range ce qu'on lit, et une veille qui va chercher
l'actualité SI toute seule. Les deux sur la même page.

```
tronc                Les systèmes d'infos
 └─ 4 branches       les trimestres
     └─ 3 rameaux    les mois
         └─ fruits   les catégories (sécurité, données, réglementation…)
             └─ pépins   les actualités
```

## Démarrer

```bash
cd serveur
npm install
npm start
```

→ **http://localhost:4310**

## Le dossier

```
.
├── README.md                  ce fichier
├── render.yaml                déploiement (Render lit ce fichier)
├── .github/workflows/         maintien en éveil + collecte planifiée
└── serveur/                   toute l'application
    ├── server.js              API, planificateur, service des pages
    ├── README.md              documentation technique détaillée
    ├── .env.example           les réglages, commentés
    ├── lib/
    │   ├── db.js              base SQLite : schéma et requêtes
    │   ├── feed.js            lecture RSS / Atom / RDF, encodages
    │   ├── collector.js       interrogation des flux, dédoublonnage
    │   ├── rank.js            sélection du majeur, fiabilité, quota de langue
    │   └── sources.js         les 18 flux, avec leur niveau de confiance
    ├── public/
    │   ├── index.html          le site : l'arbre, l'écriture, la veille
    │   ├── widget.js          la cloche, embarquable sur n'importe quel site
    │   └── demo.html          exemple d'intégration sur une page tierce
    ├── scripts/
    │   ├── collect-once.js    une collecte manuelle, avec le détail
    │   └── reselect.js        rejoue la sélection sur toute la base
    └── test/veille.test.js    dix tests : lecture des flux, filtre
```

## Les adresses

| | |
|---|---|
| `/` et `/journal` | le site |
| `/widget.js` | la cloche, à embarquer ailleurs |
| `/demo.html` | exemple d'intégration |
| `/api/…` | l'API (voir `serveur/README.md`) |

## Mise en ligne

`render.yaml` décrit tout. Voir `serveur/README.md`, section
« Mise en ligne sur Render ».
