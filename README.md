# Journal de bord — veille SI

Deux morceaux qui se répondent :

| | |
|---|---|
| `journal-de-bord.html` | le journal : un arbre de l'année (tronc → trimestres → mois → catégories → actualités), la fenêtre d'écriture, les photos |
| `veille/` | le service de veille : collecte RSS planifiée, sélection du majeur, API et cloche de notification |

## En local

```bash
cd veille
npm install
npm start
```

→ le journal : http://localhost:4310/journal
→ la démonstration de la cloche : http://localhost:4310/veille/demo.html

Le service sert les deux : une seule application, une seule origine.

## En ligne

`render.yaml` à la racine décrit le déploiement. Voir `veille/README.md`,
section « Mise en ligne sur Render », pour les trois points qui décident de
l'offre à choisir (disque, mise en veille, version de Node).
