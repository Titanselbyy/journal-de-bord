# Veille SI — collecte passive et notifications

Un service autonome qui surveille l'actualité des **systèmes d'information**,
range ce qu'il trouve dans une base, et pousse le compte de ce qui reste à lire
dans une cloche que l'on embarque sur n'importe quelle page.

Un seul processus, une seule dépendance (`express`), une base qui tient dans un
fichier. Pas de broker, pas de worker, pas de serveur de base à administrer.

## Démarrage

```bash
cd serveur
npm install
cp .env.example .env      # facultatif : les valeurs par défaut suffisent
npm start
```

→ `http://localhost:4310/demo.html`

La première collecte part 1,5 s après le démarrage, puis toutes les 30 minutes.

## Ce que fait le système

```
   ┌──────────────┐   toutes les 30 min      ┌──────────────────┐
   │  11 flux RSS │ ───────────────────────► │   collector.js   │
   │  (FR + EN)   │   ou bouton Actualiser   │  filtre · dédoub.│
   └──────────────┘                          └────────┬─────────┘
                                                      │ un article neuf
                                                      ▼
                                    ┌─────────────────────────────┐
                                    │  articles                   │
                                    │  article_user  ← diffusion  │
                                    │   (non_traite = 1 par user) │
                                    └────────────┬────────────────┘
                                                 │
                    GET /api/state ◄─────────────┤
                    SSE /api/events ◄────────────┤  compteur en direct
                                                 ▼
                                        ┌────────────────┐
                                        │  widget.js     │  🔔 ③
                                        │  cloche+panneau│
                                        └────────────────┘
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `server.js` | API REST, flux SSE, service des pages, planificateur |
| `lib/entries.js` | Stockage durable du journal, à part de la veille |
| `lib/db.js` | Schéma SQLite et requêtes préparées |
| `lib/feed.js` | Lecture RSS 2.0 / RSS 1.0 (RDF) / Atom, encodages, entités |
| `lib/collector.js` | Interrogation des flux, filtre de pertinence, dédoublonnage |
| `lib/sources.js` | Les onze flux de départ (tous vérifiés en conditions réelles) |
| `public/widget.js` | La cloche embarquable, sans dépendance |
| `public/demo.html` | Page de démonstration |
| `scripts/collect-once.js` | Une collecte unique, pour un cron système |
| `test/veille.test.js` | Tests du lecteur de flux et du filtre |

## Base de données

```
users          (id, email, name, created_at)
sources        (id, url, name, lang, active, filtered, etag, last_modified,
                last_ok, last_error, fail_count)
articles       (id, source_id, guid, url_key, url, title, summary, author,
                lang, published_at, fetched_at)
article_user   (article_id, user_id, non_traite, traite_at)   ← le statut
runs           (id, started_at, ended_at, trigger, fetched, added, errors, detail)
```

Le compteur de la pastille s'appuie sur un **index partiel** :

```sql
CREATE INDEX idx_au_unread ON article_user(user_id, article_id DESC)
  WHERE non_traite = 1;
```

Il ne contient que le non-traité. Le jour où la base compte 200 000 articles
dont 12 non lus, l'index en contient 12 : le compteur reste instantané.

## Ce qui est notifié, et pourquoi

Collecter n'est pas notifier. Sur ~450 articles ramassés, **une dizaine** franchit
la barre. Deux règles, dans cet ordre :

### 1. La provenance, seule fiabilité qu'une machine sache garantir

Aucun programme ne sait dire si une information est **vraie**. Il sait dire d'où
elle vient — et c'est vérifiable :

| Niveau | Règle | Notifié |
|---|---|---|
| **officielle** | autorité publique ou CERT (CERT-FR, CNIL, CISA, NCSC UK) | oui, seule |
| **confirmée** | ≥ 2 rédactions indépendantes couvrent le même sujet | oui |
| **unique** | une seule source non officielle | **non** — gardé en base |

Le recoupement se calcule en regroupant les titres par mots significatifs
(accents et mots-outils retirés), puis en comptant les sources **distinctes** :
deux articles d'un même journal ne se confirment pas l'un l'autre. Le niveau est
affiché sur chaque notification : le lecteur voit sur quoi elle repose.

### 2. L'importance

Note lisible, chaque terme justifiable : poids éditorial de la source, `+2,2` si
officielle, `+1,6` par confirmation supplémentaire, `+2` sur un marqueur
d'actualité majeure (faille exploitée, panne, rachat, sanction, régulation),
`−3` sur un marqueur de bruit (test produit, guide d'achat, ordre du jour),
et un bonus de fraîcheur. Fenêtre dure : 72 h pour la presse, 7 jours pour un avis
officiel — au-delà, ce n'est plus une actualité.

Deux garde-fous : **2 articles maximum par source** (les trente avis du jour d'une
même autorité noieraient tout le reste) et un sujet confirmé n'est notifié
**qu'une fois**, avec son meilleur article et non ses trois reprises.

### 3. La parité des langues

Le quota prend la moitié des places de chaque côté. Si une langue est à court de
sujets *établis*, l'autre comble : mieux vaut dix actualités solides que cinq au
nom d'une parité stricte. Abaisser la barre de fiabilité pour atteindre 50/50
serait contradictoire.

Réglages : `MAX_NOTIFS` (10), `RANK_WINDOW_H` (168), et le seuil dans
`lib/rank.js`. Après tout changement : `node scripts/reselect.js` rejoue la
sélection sur la base entière.

## API

| Méthode | Route | Effet |
|---|---|---|
| `GET` | `/api/state` | utilisateur, nombre de non traités, dernière collecte |
| `GET` | `/api/articles?status=unread&limit=25&before=<id>` | liste paginée |
| `POST` | `/api/articles/:id/read` | `non_traite = false` |
| `POST` | `/api/articles/:id/unread` | annulation |
| `POST` | `/api/articles/read-all` | tout marquer traité |
| `POST` | `/api/refresh` | force une collecte immédiate |
| `GET` | `/api/events` | flux SSE : `unread`, `articles` |
| `GET`/`POST`/`DELETE` | `/api/sources` | gestion des flux |
| `GET` | `/api/journal` | inventaire des clés du journal |
| `GET`/`PUT`/`DELETE` | `/api/journal/:cle` | une année d'entrées, ou une photo |

La pagination se fait **par curseur** (`before=<id>`) et non par `OFFSET` : une
collecte qui insère pendant que l'utilisateur fait défiler ne décale pas la liste
et ne fait pas apparaître deux fois le même article.

## Intégrer la cloche à votre site

```html
<div id="veille"></div>
<script src="https://votre-service/widget.js"
        data-api="https://votre-service/api"></script>
```

Sans conteneur `#veille`, le widget se pose en haut à droite. Attributs :
`data-api`, `data-mount` (sélecteur CSS), `data-poll` (repli, en ms).
Si la page est servie depuis un autre domaine que l'API, ajoutez son origine à
`ALLOWED_ORIGINS`.

## Décisions, et les pièges qu'elles évitent

**Encodages.** Le Monde Informatique sert du RSS 1.0 en ISO-8859-15. Décoder en
UTF-8 par défaut transforme « système » en « systÃ¨me ». Le charset est lu dans
l'en-tête HTTP, puis dans la déclaration XML — l'un des deux ment souvent, jamais
les deux.

**Acronymes cherchés en respectant la casse.** En insensible à la casse, `\bAI\b`
attrape le « ai » de « j'ai » et `\bSI\b` le « si » conditionnel : la moitié du web
devient une actualité SI. Les acronymes (DSI, ERP, RGPD…) sont donc cherchés en
majuscules, les thèmes en toutes casses.

**Entités désarmées avant le retrait des balises.** Les flux livrent leur HTML
échappé (`&lt;p&gt;`) : retirer les balises d'abord ne retire rien, et le résumé
s'affiche avec ses `<p>` en clair. Deux passes, car certains flux échappent deux fois.

**Une seule collecte à la fois.** Dix clics sur « Actualiser » ne déclenchent pas
dix rafales : les appels concurrents rejoignent la collecte en cours. Un délai
minimal (20 s) protège en plus les serveurs des éditeurs.

**Requêtes conditionnelles.** `ETag` et `If-Modified-Since` sont conservés par
source : un flux inchangé répond `304` et ne coûte ni bande passante ni analyse.
Mesuré en conditions réelles : 4 sources sur 11 en `304` dès la deuxième passe.

**Une source en panne n'arrête pas les autres.** Chaque flux est isolé ; après six
échecs consécutifs il passe en sommeil. Observé : The Register a dépassé le délai
deux fois puis est revenu, sans que les dix autres en souffrent.

**Dédoublonnage par URL normalisée.** `url_key` retire `www.`, le fragment, les
paramètres de traçage (`utm_*`, `fbclid`…) et uniformise le protocole. Le même
article repris par trois agrégateurs n'apparaît qu'une fois.

**SSE plutôt que WebSocket.** Le trafic ne va que du serveur vers le navigateur.
SSE traverse les proxies, se reconnecte seul et tient en vingt lignes. Le widget
bascule sur une interrogation périodique si le flux est coupé — certains proxies
d'entreprise tuent les connexions persistantes.

**Lecture optimiste.** La pastille tombe avant la réponse du serveur, et remonte
si l'enregistrement échoue. Rien de plus agaçant qu'un compteur qui traîne.

## Passer en multi-utilisateurs

Le schéma est multi-utilisateurs depuis le premier jour : `article_user` porte le
statut par couple (article, utilisateur), et toutes les requêtes travaillent déjà
par `user_id`. Il n'y a **qu'une fonction à réécrire**, dans `server.js` :

```js
function currentUser(req){
  return me;                    // aujourd'hui : l'utilisateur unique
}
```

Elle devient, selon votre authentification :

```js
function currentUser(req){
  const id = req.session?.userId;             // ou un JWT vérifié, ou un en-tête
  if(!id) throw Object.assign(new Error("non connecté"), { status: 401 });
  return D.users.byId.get(id);
}
```

Un utilisateur créé après coup hérite de tout l'historique via
`D.users.inherit(id)` — déjà appelé au démarrage.

### La diffusion à l'écriture, et quand en changer

Chaque nouvel article crée une ligne dans `article_user` **par utilisateur**
(diffusion à l'écriture), conformément à la spécification. C'est simple, indexable,
et cela permettra plus tard d'y ranger un « traité par » ou un horodatage par
personne.

Le coût est un produit : `articles × utilisateurs`. À 300 articles par jour et
20 utilisateurs, cela fait 2,2 millions de lignes par an — SQLite n'en souffre pas.
Au-delà de quelques centaines d'utilisateurs, il faudra basculer sur la diffusion
**à la lecture** : ne stocker que les articles *traités* et calculer le non-traité
par différence. Le point de bascule n'est pas atteint ici ; le mentionner évite
d'avoir à le redécouvrir.

## Collecte par cron système

Si vous préférez un vrai cron au planificateur interne, mettez
`COLLECT_EVERY_MIN=0` et appelez :

```bash
# toutes les 30 minutes
*/30 * * * * cd /srv/veille && /usr/bin/node scripts/collect-once.js >> /var/log/veille.log 2>&1
```

ou, service déjà démarré :

```bash
curl -s -X POST -H "X-Veille-Token: $VEILLE_TOKEN" http://localhost:4310/api/refresh
```

## Vos textes : une base à part

Les articles de veille se recollectent seuls en une passe : leur base peut
disparaître sans dommage. **Vos textes, non.** Ils vivent donc dans une base
distincte et durable — sinon, les ranger sur le serveur les rendrait plus
fragiles qu'en restant dans le navigateur.

Créez une base gratuite sur [turso.tech](https://turso.tech) :

```bash
turso db create journal
turso db show journal --url          # → libsql://journal-xxx.turso.io
turso db tokens create journal       # → le jeton
```

Puis, dans Render → veille-si → *Environment* :

```
JOURNAL_DB_URL     libsql://journal-xxx.turso.io
JOURNAL_DB_TOKEN   le jeton
```

Sans ces variables, le journal écrit dans un fichier local `journal.db` :
parfait en développement, éphémère sur Render.

**Comment ça se comporte.** Toute écriture va au cache local *puis* au serveur.
Le serveur fait foi à la lecture : un navigateur neuf, cache vidé, retrouve tout.
Si le serveur ne répond pas, rien n'est perdu — le texte reste dans ce navigateur
et la page le dit franchement (« Serveur injoignable : enregistré dans ce
navigateur seulement »). Comme chaque enregistrement pousse l'année entière, le
premier enregistrement réussi après une coupure rattrape ce qui avait été écrit
hors ligne : pas de file d'attente à gérer.

**Ce que ça ne fait pas.** Deux appareils qui écrivent en même temps, chacun de
son côté, écrasent mutuellement leur version de l'année : le dernier
enregistrement gagne. Pour un journal personnel c'est sans conséquence ; à
plusieurs, il faudrait fusionner entrée par entrée.

## Mise en ligne sur Render

`render.yaml` est prêt : poussez le dépôt, Render lit le fichier et déploie. Le
service sert **tout** — l'API, la cloche et le journal (`/journal`) — donc une
seule application, une seule origine, aucun CORS à régler.

Trois points à connaître avant de choisir l'offre :

**Le disque.** SQLite écrit dans un fichier. Sans disque persistant, Render
repart d'un système de fichiers vierge à chaque déploiement : les articles
seraient recollectés (sans gravité, une passe suffit) mais les statuts
« traité » seraient perdus. Le bloc `disk` du manifeste règle la question et
suppose une offre payante. En offre gratuite, retirez-le et acceptez la remise
à zéro.

**La mise en veille.** Une instance gratuite s'endort après quinze minutes sans
trafic : le planificateur interne ne tourne plus. Deux réponses — un **Cron Job
Render** qui appelle l'API toutes les trente minutes, ou une offre payante :

```
curl -s -X POST -H "X-Veille-Token: $VEILLE_TOKEN" https://<votre-service>/api/refresh
```

**La version de Node.** `node:sqlite` exige Node ≥ 22.5 ; `NODE_VERSION` est
fixé dans le manifeste.

Et les entrées du journal ? Elles restent dans le **navigateur** (localStorage) :
un journal en ligne retient ce qu'on y écrit, mais chaque appareil a le sien.
Pour les partager entre postes, il faudrait les ranger dans SQLite comme les
articles — le schéma s'y prête, ce n'est pas fait.

## Mise en service

```ini
# /etc/systemd/system/veille.service
[Service]
WorkingDirectory=/srv/veille
ExecStart=/usr/bin/node server.js
Environment=PORT=4310
Restart=always
User=veille
```

Derrière nginx, ne pas tamponner le flux d'événements :

```nginx
location /api/events { proxy_pass http://127.0.0.1:4310; proxy_buffering off;
                       proxy_read_timeout 1h; }
location /            { proxy_pass http://127.0.0.1:4310; }
```

## Tests

```bash
node --test test/veille.test.js
```

Dix cas : les trois dialectes de flux, le CDATA, les items malformés, les deux
chemins de décodage d'encodage, la normalisation d'URL et le filtre de pertinence.

## Limites connues

- **`/api/refresh` n'est protégé par jeton que hors navigateur.** En mono-utilisateur
  local c'est sans conséquence (l'appel est idempotent et limité en fréquence). Dès
  qu'une authentification existe, protégez-le comme les autres routes.
- **NewsAPI n'est pas branché.** Les flux RSS suffisent et n'ont ni quota ni clé ;
  l'offre gratuite de NewsAPI interdit la production. `NEWSAPI_KEY` est réservé
  dans `.env` pour le jour où le besoin se présente.
- **Pas de purge automatique.** `D.articles.purge(iso)` existe et supprime les
  articles anciens *déjà traités par tout le monde*, mais n'est appelée nulle part.
- **Le filtre de pertinence est lexical.** Il se règle dans `lib/collector.js`
  (`ACRONYMS` et `TOPIC`). Sur les onze flux, il retient tout des sources
  spécialisées et écarte 40 % environ des généralistes.
