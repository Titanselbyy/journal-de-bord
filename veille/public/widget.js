"use strict";
/* Widget de veille : une cloche, une pastille, un panneau.
   Aucune dépendance, aucun build, aucun style global — tout est préfixé .vl-
   pour ne pas entrer en collision avec la feuille de style du site hôte.

   Emploi :
     <div id="veille"></div>
     <script src="https://votre-service/veille/widget.js" data-api="https://votre-service/api"></script>
*/
(function(){
  var script = document.currentScript;
  var API = (script && script.dataset.api) || "/api";
  var MOUNT = (script && script.dataset.mount) || "#veille";
  /* data-dock : au lieu d'un menu déroulant sous la cloche, le panneau se pose
     dans un conteneur à soi et reste ouvert. La cloche garde son compteur et
     sert d'interrupteur. C'est ce que fait le journal, où veille et arbre
     doivent tenir côte à côte. */
  var DOCK = (script && script.dataset.dock) || "";
  var POLL_MS = Number(script && script.dataset.poll) || 60000;
  var JOURNAL = (script && script.dataset.journal) || "";   // vide : pas de bouton

  var state = { unread: 0, open: false, items: [], loading: false, cursor: null,
                busy: false, docked: false };
  var el = {};

  /* ---------------- styles ---------------- */
  var CSS = [
    ".vl-wrap{position:relative;display:inline-block;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
    ".vl-bell{position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;",
      "background:transparent;border:1px solid rgba(130,165,205,.28);border-radius:10px;cursor:pointer;",
      "color:inherit;transition:border-color .2s,background .2s}",
    ".vl-bell:hover{border-color:rgba(130,165,205,.6);background:rgba(130,165,205,.08)}",
    ".vl-bell svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;",
      "stroke-linecap:round;stroke-linejoin:round}",
    ".vl-dot{position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;",
      "display:flex;align-items:center;justify-content:center;border-radius:10px;",
      "background:#e5484d;color:#fff;font-size:11px;font-weight:700;line-height:1;",
      "box-shadow:0 0 0 2px rgba(0,0,0,.25)}",
    ".vl-dot[hidden]{display:none}",
    ".vl-panel{position:absolute;top:calc(100% + 10px);right:0;z-index:9999;width:380px;",
      "max-width:calc(100vw - 24px);max-height:min(70vh,560px);display:flex;flex-direction:column;",
      "background:#1b2431;color:#e7eff9;border:1px solid rgba(130,165,205,.28);border-radius:12px;",
      "box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden}",
    ".vl-panel[hidden]{display:none}",
    ".vl-panel.vl-docked{position:static;width:100%;max-height:none;height:100%;",
      "pointer-events:auto;backdrop-filter:blur(6px);background:rgba(24,32,44,.9)}",
    ".vl-head{display:flex;align-items:center;gap:10px;padding:12px 14px;",
      "border-bottom:1px solid rgba(130,165,205,.16)}",
    ".vl-title{flex:1;font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}",
    ".vl-title small{display:block;margin-top:3px;font-weight:400;letter-spacing:.04em;",
      "text-transform:none;color:#93a3b8}",
    ".vl-btn{background:transparent;border:1px solid rgba(130,165,205,.28);border-radius:7px;",
      "color:#93a3b8;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;",
      "padding:7px 9px;cursor:pointer;transition:.18s;white-space:nowrap}",
    ".vl-btn:hover:not(:disabled){color:#fff;border-color:rgba(130,165,205,.6);background:rgba(130,165,205,.1)}",
    ".vl-btn:disabled{opacity:.5;cursor:default}",
    ".vl-list{flex:1;overflow-y:auto;margin:0;padding:0;list-style:none}",
    ".vl-item{display:block;padding:11px 14px;border-bottom:1px solid rgba(130,165,205,.1);cursor:pointer}",
    ".vl-item:hover{background:rgba(130,165,205,.07)}",
    ".vl-item h4{margin:0 0 4px;font-size:13.5px;font-weight:600;line-height:1.35;color:#e7eff9}",
    ".vl-item p{margin:0;font-size:12px;line-height:1.45;color:#93a3b8;",
      "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
    ".vl-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:6px;",
      "font-size:10.5px;color:#65748a}",
    ".vl-src{color:#56b7e8;font-weight:600}",
    ".vl-tag{padding:1px 6px;border-radius:4px;font-size:9.5px;font-weight:700;",
      "letter-spacing:.05em;text-transform:uppercase}",
    ".vl-tag.off{background:rgba(86,215,140,.16);color:#5fd07f;border:1px solid rgba(95,208,127,.35)}",
    ".vl-tag.conf{background:rgba(86,183,232,.14);color:#56b7e8;border:1px solid rgba(86,183,232,.32)}",
    ".vl-lang{border:1px solid rgba(130,165,205,.25);border-radius:3px;padding:0 4px;font-size:9.5px}",
    ".vl-item.vl-read{opacity:.45}",
    ".vl-add{margin-left:auto;background:transparent;border:1px solid rgba(130,165,205,.3);",
      "border-radius:5px;color:#93a3b8;font-size:9.5px;font-weight:700;letter-spacing:.07em;",
      "text-transform:uppercase;padding:3px 7px;cursor:pointer;transition:.16s;white-space:nowrap}",
    ".vl-add:hover{color:#0d131c;background:#5fd07f;border-color:#5fd07f}",
    ".vl-empty{padding:26px 16px;text-align:center;color:#65748a;font-size:13px}",
    ".vl-foot{padding:9px 14px;border-top:1px solid rgba(130,165,205,.16);display:flex;gap:8px;align-items:center}",
    ".vl-foot span{flex:1;font-size:10.5px;color:#65748a}",
    ".vl-spin{display:inline-block;width:11px;height:11px;border:1.6px solid rgba(255,255,255,.25);",
      "border-top-color:#fff;border-radius:50%;animation:vl-turn .7s linear infinite;vertical-align:-1px}",
    "@keyframes vl-turn{to{transform:rotate(360deg)}}",
    "@media (prefers-reduced-motion:reduce){.vl-spin{animation:none}}"
  ].join("");

  function style(){
    if(document.getElementById("vl-style")) return;
    var s = document.createElement("style");
    s.id = "vl-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------------- réseau ---------------- */
  function api(path, opts){
    return fetch(API + path, Object.assign({ credentials: "include" }, opts || {}))
      .then(function(r){
        return r.json().catch(function(){ return {}; }).then(function(body){
          if(!r.ok){ var e = new Error(body.error || ("HTTP " + r.status));
                     e.status = r.status; e.body = body; throw e; }
          return body;
        });
      });
  }

  /* ---------------- rendu ---------------- */
  function ago(iso){
    if(!iso) return "";
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if(isNaN(s)) return "";
    if(s < 3600) return "il y a " + Math.max(1, Math.round(s / 60)) + " min";
    if(s < 86400) return "il y a " + Math.round(s / 3600) + " h";
    if(s < 604800) return "il y a " + Math.round(s / 86400) + " j";
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  }

  function paintBadge(){
    el.dot.textContent = state.unread > 99 ? "99+" : String(state.unread);
    el.dot.hidden = state.unread === 0;
    el.bell.setAttribute("aria-label",
      state.unread ? state.unread + " actualité(s) en attente" : "Aucune actualité en attente");
  }

  function paintList(){
    el.list.textContent = "";
    if(!state.items.length){
      var empty = document.createElement("li");
      empty.className = "vl-empty";
      empty.textContent = state.loading ? "Chargement…" : "Rien de neuf. La veille tourne.";
      el.list.appendChild(empty);
      return;
    }
    state.items.forEach(function(a){
      var li = document.createElement("li");
      li.className = "vl-item" + (a.non_traite ? "" : " vl-read");
      li.dataset.id = a.id;
      li.dataset.url = a.url;
      li.setAttribute("role", "button");
      li.tabIndex = 0;

      var h = document.createElement("h4");
      h.textContent = a.title;
      li.appendChild(h);

      if(a.summary){
        var p = document.createElement("p");
        p.textContent = a.summary;
        li.appendChild(p);
      }
      var meta = document.createElement("div");
      meta.className = "vl-meta";

      /* La provenance, affichée sans détour : « officiel » pour une autorité,
         « confirmé · N sources » pour une information recoupée. Le lecteur voit
         sur quoi repose ce qu'on lui pousse. */
      var tag = document.createElement("span");
      if(a.trust_level === "officiel"){
        tag.className = "vl-tag off"; tag.textContent = "source officielle";
        tag.title = "Autorité publique ou CERT : source primaire";
      } else {
        tag.className = "vl-tag conf";
        tag.textContent = "confirmé · " + (a.confirms || 2) + " sources";
        tag.title = (a.confirms || 2) + " rédactions indépendantes couvrent ce sujet";
      }
      meta.appendChild(tag);

      var lang = document.createElement("span");
      lang.className = "vl-lang";
      lang.textContent = (a.lang || "fr").toUpperCase();
      meta.appendChild(lang);

      var src = document.createElement("span");
      src.className = "vl-src";
      src.textContent = a.source;
      meta.appendChild(src);
      var when = document.createElement("span");
      when.textContent = ago(a.published_at || a.fetched_at);
      meta.appendChild(when);

      /* Verser l'actualité au journal : la fiche s'ouvrira déjà remplie. */
      if(JOURNAL || window.__veilleJournalHost){
        var add = document.createElement("button");
        add.className = "vl-add";
        add.type = "button";
        add.dataset.add = a.id;
        add.textContent = "+ journal";
        add.title = "Ouvrir le journal avec cette actualité déjà saisie";
        meta.appendChild(add);
      }
      li.appendChild(meta);
      el.list.appendChild(li);
    });
  }

  function paintFoot(txt){
    el.info.textContent = txt || (state.unread + " en attente");
  }

  /* ---------------- actions ---------------- */
  function load(){
    state.loading = true; paintList();
    return api("/articles?status=unread&limit=25").then(function(d){
      state.items = d.articles; state.cursor = d.next; state.loading = false;
      paintList(); paintFoot();
    }).catch(function(e){
      state.loading = false; state.items = [];
      paintList(); paintFoot("Service injoignable");
    });
  }

  /* Lecture optimiste : la pastille tombe tout de suite, on annule si le
     serveur refuse. Rien de plus agaçant qu'un compteur qui traîne. */
  function markRead(id){
    var item = state.items.filter(function(a){ return a.id === id; })[0];
    if(!item || !item.non_traite) return Promise.resolve();
    item.non_traite = false;
    state.unread = Math.max(0, state.unread - 1);
    paintBadge(); paintList(); paintFoot();
    return api("/articles/" + id + "/read", { method: "POST" })
      .then(function(d){ state.unread = d.unread; paintBadge(); paintFoot(); })
      .catch(function(){
        item.non_traite = true; state.unread++;
        paintBadge(); paintList(); paintFoot("Échec de l'enregistrement");
      });
  }

  function refresh(){
    if(state.busy) return;
    state.busy = true;
    el.refresh.disabled = true;
    paintFoot("Analyse des flux…");
    el.refresh.innerHTML = '<span class="vl-spin"></span>';
    api("/refresh", { method: "POST" })
      .then(function(d){
        state.unread = d.unread; paintBadge();
        return load().then(function(){
          paintFoot(d.added ? d.added + " nouvelle(s) actualité(s)" : "Rien de neuf");
        });
      })
      .catch(function(e){
        if(e.status === 429){
          state.unread = (e.body && e.body.unread) || state.unread;
          paintBadge();
          paintFoot("Patientez " + (e.body.retryAfter || 20) + " s avant un nouveau scan");
        } else {
          paintFoot("Échec du scan : " + e.message);
        }
      })
      .then(function(){
        state.busy = false;
        el.refresh.disabled = false;
        el.refresh.textContent = "Actualiser";
      });
  }

  function markAll(){
    api("/articles/read-all", { method: "POST" }).then(function(d){
      state.unread = d.unread;
      state.items.forEach(function(a){ a.non_traite = false; });
      paintBadge(); paintList(); paintFoot(d.changed + " marquée(s) comme traitée(s)");
    });
  }

  function toggle(force){
    state.open = force === undefined ? !state.open : force;
    el.panel.hidden = !state.open;
    el.bell.setAttribute("aria-expanded", String(state.open));
    // amarré, le panneau fait partie de la page : il ne vole pas le curseur
    if(state.open){ load(); if(!state.docked) el.refresh.focus(); }
  }

  /* ---------------- construction ---------------- */
  function build(){
    var host = document.querySelector(MOUNT);
    if(!host){                                  // pas de conteneur : on se pose en haut à droite
      host = document.createElement("div");
      host.style.cssText = "position:fixed;top:16px;right:16px;z-index:9999";
      document.body.appendChild(host);
    }
    var wrap = document.createElement("div");
    wrap.className = "vl-wrap";

    el.bell = document.createElement("button");
    el.bell.className = "vl-bell";
    el.bell.type = "button";
    el.bell.setAttribute("aria-haspopup", "dialog");
    el.bell.setAttribute("aria-expanded", "false");
    el.bell.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

    el.dot = document.createElement("span");
    el.dot.className = "vl-dot";
    el.dot.hidden = true;
    el.dot.setAttribute("aria-live", "polite");
    el.bell.appendChild(el.dot);
    wrap.appendChild(el.bell);

    var dockHost = DOCK ? document.querySelector(DOCK) : null;
    el.panel = document.createElement("div");
    el.panel.className = "vl-panel" + (dockHost ? " vl-docked" : "");
    el.panel.hidden = !dockHost;          // amarré : ouvert d'emblée
    state.open = state.docked = !!dockHost;
    el.panel.setAttribute("role", "dialog");
    el.panel.setAttribute("aria-label", "Veille Systèmes d'information");

    var head = document.createElement("div");
    head.className = "vl-head";
    var title = document.createElement("div");
    title.className = "vl-title";
    title.innerHTML = "Veille SI<small>Systèmes d'information</small>";
    head.appendChild(title);

    el.refresh = document.createElement("button");
    el.refresh.className = "vl-btn";
    el.refresh.type = "button";
    el.refresh.textContent = "Actualiser";
    head.appendChild(el.refresh);

    el.all = document.createElement("button");
    el.all.className = "vl-btn";
    el.all.type = "button";
    el.all.textContent = "Tout traiter";
    head.appendChild(el.all);
    el.panel.appendChild(head);

    el.list = document.createElement("ul");
    el.list.className = "vl-list";
    el.panel.appendChild(el.list);

    var foot = document.createElement("div");
    foot.className = "vl-foot";
    el.info = document.createElement("span");
    foot.appendChild(el.info);
    el.panel.appendChild(foot);

    if(dockHost) dockHost.appendChild(el.panel);
    else wrap.appendChild(el.panel);
    host.appendChild(wrap);

    /* ---------------- écoutes ---------------- */
    el.bell.addEventListener("click", function(){ toggle(); });
    el.refresh.addEventListener("click", refresh);
    el.all.addEventListener("click", markAll);

    function openItem(li){
      var id = Number(li.dataset.id), url = li.dataset.url;
      markRead(id);
      window.open(url, "_blank", "noopener,noreferrer");
    }
    /* Le fragment d'URL plutôt qu'un appel serveur : le journal peut être un
       simple fichier ouvert en local, sans origine ni API à interroger. */
    function pack(o){
      var bytes = new TextEncoder().encode(JSON.stringify(o));
      var bin = "";
      for(var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function toJournal(id){
      var a = state.items.filter(function(x){ return x.id === id; })[0];
      if(!a) return;
      /* La page hôte peut vouloir traiter l'actualité elle-même plutôt que
         d'ouvrir un onglet : si elle écoute et annule, on lui laisse la main.
         C'est ce que fait le journal de bord, qui ouvre sa fiche sur place. */
      var say = new CustomEvent("veille:journal", { detail: a, cancelable: true });
      if(!window.dispatchEvent(say)){ markRead(id); return; }
      if(!JOURNAL) return;
      var sep = JOURNAL.indexOf("#") >= 0 ? "&" : "#";
      window.open(JOURNAL + sep + "veille=" + pack({
        t: a.title, u: a.url, s: a.summary || "", src: a.source,
        d: a.published_at || a.fetched_at, l: a.lang || "fr",
        conf: a.confirms || 1, trust: a.trust_level || "confirmé"
      }), "_blank", "noopener");
      markRead(id);
    }
    el.list.addEventListener("click", function(ev){
      var addBtn = ev.target.closest("[data-add]");
      if(addBtn){ ev.stopPropagation(); toJournal(Number(addBtn.dataset.add)); return; }
      var li = ev.target.closest(".vl-item");
      if(li) openItem(li);
    });
    el.list.addEventListener("keydown", function(ev){
      if(ev.key !== "Enter" && ev.key !== " ") return;
      var li = ev.target.closest(".vl-item");
      if(li){ ev.preventDefault(); openItem(li); }
    });
    document.addEventListener("keydown", function(ev){
      if(ev.key === "Escape" && state.open){ toggle(false); el.bell.focus(); }
    });
    // Amarré, le panneau ne se referme pas quand on clique ailleurs : il fait
    // partie de la page, il n'est pas un menu.
    document.addEventListener("click", function(ev){
      if(dockHost) return;
      if(state.open && !wrap.contains(ev.target)) toggle(false);
    });
  }

  /* ---------------- temps réel ---------------- */
  /* SSE quand c'est possible, interrogation régulière sinon. Le repli n'est pas
     un luxe : certains proxies d'entreprise coupent les flux persistants. */
  function live(){
    var poll = null;
    function startPolling(){
      if(poll) return;
      poll = setInterval(function(){
        api("/state").then(function(d){
          if(d.unread !== state.unread){ state.unread = d.unread; paintBadge(); }
        }).catch(function(){});
      }, POLL_MS);
    }
    if(typeof EventSource !== "function"){ startPolling(); return; }
    try{
      var es = new EventSource(API + "/events", { withCredentials: true });
      es.addEventListener("unread", function(ev){
        try{
          var d = JSON.parse(ev.data);
          state.unread = d.unread; paintBadge();
          if(state.open) paintFoot();
        }catch(e){}
      });
      es.addEventListener("articles", function(){ if(state.open) load(); });
      es.onerror = function(){
        // EventSource se reconnecte seul ; au bout de deux échecs, on double
        // avec l'interrogation régulière pour ne pas rester muet.
        startPolling();
      };
    }catch(e){ startPolling(); }
  }

  /* ---------------- démarrage ---------------- */
  function boot(){
    style(); build();
    api("/state").then(function(d){
      state.unread = d.unread; paintBadge(); paintFoot();
      if(state.open) load();               // amarré : la liste s'affiche d'emblée
    }).catch(function(){ paintFoot("Service injoignable"); });
    live();
  }

  if(document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
