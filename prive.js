/* =====================================================================
   LA FIOLE ET LA MARMITE — ESPACE PRIVÉ
   Elvara (gérante) : l'alchimie. Edmond (cuisinier) : la cuisine.
   Tous deux : la carte, la validation des accords, les offres d'achat.
   Employés : voient tout ; enregistrent leurs ventes (dans leur propre
   onglet de trésorerie), proposent des accords, acceptent les offres d'achat.
   Données partagées via le serveur Google (config.js), sinon mode
   démonstration enregistré dans le navigateur.
   ===================================================================== */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const norm = s => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nb = n => Number(n || 0).toLocaleString("fr-FR");
  const M = BOUTIQUE.monnaie;
  const API = (typeof FIOLE_EN_LIGNE === "string" && FIOLE_EN_LIGNE.trim()) || "";
  const local = {
    get(k, d) { try { const v = localStorage.getItem("fiole-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("fiole-" + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("fiole-" + k); sessionStorage.removeItem("fiole-" + k); } catch (e) {} },
  };
  const sess = {
    get(k, d) { try { const v = sessionStorage.getItem("fiole-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem("fiole-" + k, JSON.stringify(v)); } catch (e) {} },
  };

  const byIng = Object.fromEntries(INGREDIENTS.map(i => [i.id, i]));
  const byPot = Object.fromEntries(POTIONS.map(p => [p.id, p]));
  const CATS = ["Breuvages", "Soins et restauration", "Endurance", "Renforts", "Protections", "Poisons", "Nourriture"];
  const VIDE = () => ({ ingredients: {}, potions: {}, carte: {}, accords: {}, ventes: {}, achats: {}, offres: {}, mouvements: {}, notes: {}, reglages: {}, eaunoire: {} });
  // Mode démonstration (sans serveur) : mots de passe de test
  const MDP_DEMO = { "demo-amaury": "gerante", "demo-gerante": "gerante", "demo-employe": "employe", "demo-cuisinier": "cuisinier" };
  // Ce que le cuisinier peut modifier : nourriture et denrées de cuisine
  const CUISINE = { potions: new Set(POTIONS.filter(p => p.categorie === "Nourriture").map(p => p.id)), ingredients: new Set(INGREDIENTS.filter(i => i.cuisine).map(i => i.id)) };

  let session = null;            // { nom, mdp, role, demo }
  let D = VIDE();                // données du serveur (modifications)
  let infoSync = { maj: "", par: "" };
  let enCours = 0;

  /* =================================================================
     ACCÈS AU SERVEUR (ou au mode démonstration)
     ================================================================= */
  async function appel(corps) {
    if (session && session.demo) return demo(corps);
    let d;
    try {
      const r = await fetch(API, { method: "POST", body: JSON.stringify(corps) });
      d = await r.json();
    } catch (e) {
      throw new Error("Le serveur Google ne répond pas correctement (voir « Exécutions » dans Apps Script).");
    }
    if (d.maintenance) { maintenance(d.erreur); throw new Error(d.erreur); }
    if (d.erreur) throw new Error(d.erreur);
    return d;
  }
  // Mode maintenance (décidé par le serveur Google) : tout est fermé, la session est oubliée
  function maintenance(msg) {
    if (msg) $("#maintenance-msg").textContent = msg;
    $("#maintenance").hidden = false; document.body.classList.add("en-maintenance");
    session = null; local.del("session");
  }
  if (API) fetch(API + (API.includes("?") ? "&" : "?") + "t=" + Date.now()).then(r => r.json()).then(d => { if (d && d.maintenance) maintenance(d.message); }).catch(() => {});
  function demo(c) {
    const db = local.get("demo", null) || { donnees: VIDE(), maj: "", par: "" };
    if (["vendre", "acheter", "ajouter", "retirer"].includes(c.action)) {
      const mvt = c.action === "ajouter" || c.action === "retirer", plus = c.action === "acheter" || c.action === "ajouter";
      const achat = c.action === "acheter" || mvt, dom = c.domaine;
      if (mvt) c.stock = true;
      if (c.action === "acheter" && !responsable()) throw new Error("Les achats sont réservés à Elvara, Amaury et Edmond.");
      const partie = responsable() ? dom : "alchimie";
      if (mvt && partie !== dom) throw new Error("Opération non autorisée pour cette partie.");
      if (!achat && partie !== dom) throw new Error("Vente non autorisée pour cette partie.");
      const nc = mvt ? "mouvements" : achat ? "achats" : "ventes", coll = db.donnees[nc] || (db.donnees[nc] = {});
      (c.lignes || []).forEach((l, i) => {
        const rec = { date: c.date, type: l.type, article: l.article, qte: l.qte, prix: l.prix, domaine: dom, cree: new Date().toISOString() };
        if (mvt) { rec.sens = plus ? "ajout" : "retrait"; rec.motif = c.tiers || ""; rec.par = c.nom; delete rec.prix; }
        else if (achat) { rec.fournisseur = c.tiers || ""; rec.acheteur = c.nom; } else { rec.client = c.tiers || ""; rec.vendeur = c.nom; }
        if (l.type === "nourriture") rec.reserve = c.reserve === "edmond" ? "edmond" : "eau-noire";
        coll[(mvt ? "mvt-" : achat ? "achat-" : "vente-") + Date.now().toString(36) + i] = rec;
        if (c.stock) {
          const col = db.donnees[l.type === "ingredient" ? "ingredients" : "potions"];
          const o = col[l.article] || (col[l.article] = {});
          const ch = champStockDe(l.type, l.article, dom, c.reserve);
          o[ch] = Math.max(0, (+o[ch] || 0) + (plus ? l.qte : -l.qte));
        }
      });
      db.maj = new Date().toISOString(); db.par = c.nom;
      local.set("demo", db);
    }
    if (c.action === "proposer") {
      const o = Object.assign({}, c.accord, { statut: "propose", proposePar: c.nom, proposeLe: new Date().toISOString() });
      (db.donnees.accords || (db.donnees.accords = {}))["accord-" + Date.now().toString(36)] = o;
      db.maj = new Date().toISOString(); db.par = c.nom; local.set("demo", db);
    }
    if (["offrir", "prendre", "lacher", "valider"].includes(c.action)) {
      const of = db.donnees.offres || (db.donnees.offres = {});
      if (c.action === "offrir") {
        if (!responsable()) throw new Error("Seul le responsable de cette partie peut créer une offre d'achat.");
        of["offre-" + Date.now().toString(36)] = { domaine: c.domaine, lignes: c.lignes, fournisseur: c.tiers || "", note: c.note || "", reserve: c.reserve, statut: "ouverte", creePar: c.nom, cree: new Date().toISOString() };
      } else {
        const o = of[c.offre]; if (!o) throw new Error("Cette offre n'existe plus.");
        if (c.action === "prendre") {
          if (o.statut !== "ouverte") throw new Error("Cette offre a déjà été prise par " + (o.preneur || "quelqu'un") + ".");
          Object.assign(o, { statut: "en-cours", preneur: c.nom, prisLe: new Date().toISOString() });
        } else if (c.action === "lacher") {
          if (o.preneur !== c.nom && !responsable()) throw new Error("Seul " + o.preneur + " ou le responsable peut libérer cette offre.");
          o.statut = "ouverte"; delete o.preneur; delete o.prisLe;
        } else {
          if (!responsable()) throw new Error("Seuls Elvara, Amaury et Edmond peuvent valider une offre.");
          if (o.statut !== "en-cours") throw new Error("L'offre doit d'abord être acceptée (statut « en cours »).");
          const ach = db.donnees.achats || (db.donnees.achats = {}), date = aujourdhui();
          o.lignes.forEach((l, i) => {
            const r = { date, type: l.type, article: l.article, qte: l.qte, prix: l.prix, domaine: o.domaine, cree: new Date().toISOString(), fournisseur: o.fournisseur, acheteur: o.preneur, offre: c.offre };
            if (l.type === "nourriture") r.reserve = o.reserve;
            ach[c.offre + "-" + i] = r;
            const col = db.donnees[l.type === "ingredient" ? "ingredients" : "potions"], x = col[l.article] || (col[l.article] = {});
            const ch = champStockDe(l.type, l.article, o.domaine, o.reserve); x[ch] = (+x[ch] || 0) + l.qte;
          });
          Object.assign(o, { statut: "validee", validePar: c.nom, valideLe: new Date().toISOString(), date });
        }
      }
      db.maj = new Date().toISOString(); db.par = c.nom; local.set("demo", db);
    }
    if (c.action === "noter") {
      (db.donnees.notes || (db.donnees.notes = {}))["note-" + Date.now().toString(36)] = { titre: c.titre || "", texte: c.texte, categorie: c.categorie || "idee", auteur: c.nom, cree: new Date().toISOString(), statut: "nouvelle" };
      db.maj = new Date().toISOString(); db.par = c.nom; local.set("demo", db);
    }
    if (c.action === "ecrire") {
      if (c.collection === "eaunoire" && !accesEN()) throw new Error("Le stock de l'Eau Noire est réservé à Elvara, Amaury et Edmond.");
      if (session.role === "employe") throw new Error("Les employés peuvent seulement enregistrer des ventes.");
      if (c.collection === "potions" && Object.keys(c.changements).some(id => byPot[id] && byPot[id].interdit && c.changements[id] && c.changements[id].vitrine === true)) throw new Error("Un objet interdit ne peut pas aller sur la vitrine.");
      const col = db.donnees[c.collection] || (db.donnees[c.collection] = {});
      for (const id in c.changements) {
        const ch = c.changements[id];
        if (ch === null) { delete col[id]; continue; }
        const o = col[id] || (col[id] = {});
        for (const k in ch) { if (ch[k] === null) delete o[k]; else o[k] = ch[k]; }
      }
      db.maj = new Date().toISOString(); db.par = c.nom;
      local.set("demo", db);
    }
    const donnees = Object.assign(VIDE(), JSON.parse(JSON.stringify(db.donnees)));
    if (session.role === "employe") Object.keys(donnees.notes).forEach(id => { if (donnees.notes[id].auteur !== session.nom) delete donnees.notes[id]; });
    if (!accesEN()) donnees.eaunoire = {};
    return Promise.resolve({ role: session.role, donnees, maj: db.maj, par: db.par });
  }
  function accepter(r) {
    D = Object.assign(VIDE(), r.donnees || {});
    infoSync = { maj: r.maj || "", par: r.par || "" };
  }
  async function charger(silencieux) {
    try {
      accepter(await appel({ action: "lire", nom: session.nom, mdp: session.mdp }));
      renderTout();
    } catch (e) {
      if (!silencieux) toast(e.message || "Serveur injoignable", true);
      if (/mot de passe/i.test(e.message)) quitter();
    }
  }

  // Enregistre des changements { id: {champ: valeur} | null } dans une collection
  async function enregistrer(col, changements, message) {
    // Mise à jour immédiate à l'écran
    const c = D[col] || (D[col] = {});
    for (const id in changements) {
      const ch = changements[id];
      if (ch === null) { delete c[id]; continue; }
      const o = c[id] || (c[id] = {});
      for (const k in ch) { if (ch[k] === null) delete o[k]; else o[k] = ch[k]; }
    }
    renderTout();
    enCours++; renderSync();
    try {
      const r = await appel({ action: "ecrire", mdp: session.mdp, nom: session.nom, collection: col, changements });
      enCours--;
      if (!enCours) accepter(r);
      renderTout();
      if (message) toast(message);
    } catch (e) {
      enCours--;
      toast((e.message || "Échec de l'enregistrement") + " — modification annulée.", true);
      charger(true);
    }
  }

  /* =================================================================
     VALEURS COURANTES
     ================================================================= */
  // prix = prix de vente ; prixAchat = prix de rachat (tant qu'il n'est pas fixé : le prix de vente)
  const avecRachat = v => { if (v.prixAchat == null || v.prixAchat === "") v.prixAchat = v.prix; return v; };
  const ingV = id => avecRachat(Object.assign({ stock: 0, seuil: 0, stockCuisine: 0, seuilCuisine: 0, prix: byIng[id].prix, prixAchat: byIng[id].prixAchat, accord: false, accordTexte: "", chatellerie: "" }, D.ingredients[id] || {}));
  const potV = id => avecRachat(Object.assign({ stock: 0, seuil: 0, stockEdmond: 0, seuilEdmond: 0, prix: byPot[id].prix, prixAchat: byPot[id].prixAchat, vitrine: byPot[id].vitrine }, D.potions[id] || {}));
  // Ingrédients communs : deux stocks indépendants, alchimie (champ stock) et cuisine (champ stockCuisine)
  const champsIng = (id, dom) => COMMUN.has(id) && dom === "cuisine" ? { stock: "stockCuisine", seuil: "seuilCuisine" } : { stock: "stock", seuil: "seuil" };
  const vueIng = (id, dom) => { const v = ingV(id), c = champsIng(id, dom); return Object.assign({}, v, { stock: +v[c.stock] || 0, seuil: +v[c.seuil] || 0, _cs: c.stock, _ce: c.seuil }); };
  const champStockDe = (type, article, dom, res) => type === "ingredient" ? champsIng(article, dom).stock : type === "nourriture" && res === "edmond" ? "stockEdmond" : "stock";
  // Lignes du tableau des ingrédients : un ingrédient commun a une ligne par partie
  const lignesIng = () => INGREDIENTS.flatMap(i => domainesDe("ingredients", i.id).map(dom => ({ i, dom })));
  // Plats : deux stocks séparés, celui de l'Eau Noire (champ stock) et celui d'Edmond (champ stockEdmond)
  const RESERVES = { "eau-noire": { stock: "stock", seuil: "seuil", nom: "Eau Noire" }, edmond: { stock: "stockEdmond", seuil: "seuilEdmond", nom: "Edmond" } };
  let reserve = "eau-noire";
  const estPlat = id => byPot[id] && byPot[id].categorie === "Nourriture";
  const champsDe = (id, res) => estPlat(id) ? RESERVES[res || reserve] : RESERVES["eau-noire"];
  const vueRes = (id, res) => { const v = potV(id), c = champsDe(id, res); return Object.assign({}, v, { stock: +v[c.stock] || 0, seuil: +v[c.seuil] || 0, _cs: c.stock, _ce: c.seuil }); };
  // Nom d'un ingrédient de recette (ingrédient, ou boisson de la boutique)
  const nomIng = id => (byIng[id] || byPot[id] || { nom: id }).nom;
  const ligneRecette = r => r.map(([id, q]) => `<span class="ing">${esc(nomIng(id))} <b>×${q == null ? "?" : q}</b></span>`).join("");
  const blocRecettes = recs => !recs || !recs.length ? "" : `<div class="recettes">${recs.map((r, i) =>
    `<div class="recette"><em>${i ? "Variante" : "Recette"}</em>${ligneRecette(r)}</div>`).join("")}</div>`;
  const motsRecettes = recs => (recs || []).flat().map(([id]) => nomIng(id)).join(" ");
  // Marge de la boutique sur un article : prix de vente − prix de rachat (et en % du prix de vente)
  function margeHTML(v) {
    const pv = +v.prix || 0, pa = +v.prixAchat || 0, m = Math.round((pv - pa) * 100) / 100;
    const pc = pv ? Math.round(m / pv * 100) : 0;
    return `<span class="marge ${m > 0 ? "pos" : m < 0 ? "neg" : "nul"}" title="Vente ${nb(pv)} − rachat ${nb(pa)}">${m > 0 ? "+" : ""}${nb(m)}<small>${pv ? pc + " %" : "—"}</small></span>`;
  }
  const etat = v => v.seuil > 0 ? (v.stock <= 0 ? "rupture" : v.stock < v.seuil ? "bas" : "ok") : (v.stock > 0 ? "ok" : "vide");
  const ETAT = { ok: "En stock", bas: "Stock bas", rupture: "Rupture", vide: "Vide" };
  // Accueil de la vitrine : 4 potions (Elvara) et 4 plats (Edmond)
  const MAX_VEDETTES = 4;
  const vedettesDe = dom => {
    const r = D.reglages.vitrine || {}, k = dom === "cuisine" ? "plats" : "potions";
    const l = Array.isArray(r[k]) ? r[k] : (r.vedettes || []).filter(id => domaineDe("potions", id) === dom);
    return l.filter(id => byPot[id]);
  };
  function points() {
    const out = [];
    CARTE_DEPART.forEach(p => { const o = D.carte[p.id]; if (o && o.supprime) return; out.push(Object.assign({}, p, o || {})); });
    Object.keys(D.carte).forEach(id => { if (!CARTE_DEPART.some(p => p.id === id) && !D.carte[id].supprime) out.push(Object.assign({ id, ingredients: [] }, D.carte[id])); });
    return out;
  }
  const accords = () => Object.keys(D.accords).map(id => Object.assign({ id }, D.accords[id]));
  const gerante = () => session && session.role === "gerante";      // Elvara : alchimie
  const cuisinier = () => session && session.role === "cuisinier";  // Edmond : cuisine
  const responsable = () => gerante() || cuisinier();
  // Stock de l'Eau Noire : réservé aux comptes d'Elvara (potions) et d'Edmond (plats)
  const accesEN = () => responsable();
  // Partie(s) d'un article : alchimie, cuisine, ou les deux (ingrédients communs)
  const COMMUN = new Set(INGREDIENTS.filter(i => i.commun).map(i => i.id));
  const domainesDe = (col, id) => col === "ingredients" && COMMUN.has(id) ? ["alchimie", "cuisine"] : [CUISINE[col] && CUISINE[col].has(id) ? "cuisine" : "alchimie"];
  const domaineDe = (col, id) => domainesDe(col, id)[0];
  // Elvara, Amaury et Edmond ont les mêmes droits sur toute la boutique (alchimie et cuisine)
  const monDomaine = () => null;
  const voit = () => true;
  const peutModifier = () => responsable();
  const peutStock = peutModifier;
  const peutStockIng = () => responsable();

  /* =================================================================
     CONNEXION
     ================================================================= */
  function entrer(s) {
    session = s;
    $("#ecran-connexion").hidden = true; $("#registre").hidden = false;
    $("#r-nom").textContent = s.nom;
    $("#r-role").textContent = { gerante: s.nom === "Amaury" ? "Gérant" : "Gérante", employe: "Employé", cuisinier: "Cuisinier" }[s.role] || s.role;
    $("#r-role").className = "badge " + s.role;
    document.body.classList.toggle("lecture-seule", s.role === "employe");
    // Elvara ne voit que l'alchimie, Edmond que la cuisine ; les employés voient tout
    const cats = CATS;
    $("#p-cat").innerHTML = (cats.length > 1 ? `<option value="">Toutes catégories</option>` : "") + cats.map(c => `<option>${c}</option>`).join("");
    $$('#i-filtre option[value="alchimie"], #i-filtre option[value="cuisine"]').forEach(o => o.hidden = false);
    $("#i-filtre").value = "";
    $("#panneau-potions h2").textContent = "Potions et nourriture";
    $('[data-p="potions"]').textContent = $("#panneau-potions h2").textContent;
    $("#a-ajouter").textContent = s.role === "employe" ? "+ Proposer un accord" : "+ Nouvel accord";
    $('[data-p="eaunoire"]').hidden = !accesEN();
    if (onglet === "eaunoire" && !accesEN()) onglet = "accueil";
    $("#panneau-ingredients h2").textContent = "Ingrédients";
    montrer(onglet);
    if (s.demo) demo({ action: "lire" }).then(r => { accepter(r); renderTout(); });
    else charger();
  }
  function quitter() {
    session = null; local.del("session");
    $("#registre").hidden = true; $("#ecran-connexion").hidden = false;
  }
  $("#form-connexion").onsubmit = async e => {
    e.preventDefault();
    const nom = $("#c-nom").value.trim(), mdp = $("#c-mdp").value.trim();
    $("#c-erreur").textContent = "";
    if (!API) {
      const role = MDP_DEMO[mdp];
      if (!role) { $("#c-erreur").textContent = "Mot de passe incorrect."; return; }
      const s = { nom: nom || ({ gerante: "Elvara", cuisinier: "Edmond" }[role] || "Employé"), mdp, role, demo: true };
      if ($("#c-souvenir").checked) local.set("session", s); else sess.set("session", s);
      entrer(s); return;
    }
    $("#c-entrer").disabled = true; $("#c-entrer").textContent = "Ouverture…";
    try {
      const r = await fetch(API, { method: "POST", body: JSON.stringify({ action: "lire", nom, mdp }) }).then(x => x.json());
      if (r.maintenance) maintenance(r.erreur);
      if (r.erreur) throw new Error(r.erreur);
      const s = { nom: r.nom || nom, mdp, role: r.role, demo: false };
      if ($("#c-souvenir").checked) local.set("session", s); else sess.set("session", s);
      accepter(r); entrer(s); renderTout();
    } catch (err) {
      $("#c-erreur").textContent = err.message === "Failed to fetch" ? "Serveur injoignable, réessayez." : err.message;
    }
    $("#c-entrer").disabled = false; $("#c-entrer").textContent = "Ouvrir le registre";
  };
  $("#r-quitter").onclick = quitter;
  $("#r-actualiser").onclick = () => session && (session.demo ? renderTout() : charger());

  function renderSync() {
    const el = $("#r-sync");
    if (!session) return;
    el.className = "etat-sync " + (session.demo ? "demo" : "direct");
    if (enCours) { el.textContent = "Enregistrement…"; return; }
    const quand = infoSync.maj ? new Date(infoSync.maj).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
    el.textContent = (session.demo ? "Mode démonstration (données de ce navigateur)" : "● En direct")
      + (quand ? " · modifié le " + quand + (infoSync.par ? " par " + infoSync.par : "") : "");
  }

  /* =================================================================
     ONGLETS
     ================================================================= */
  let onglet = "accueil";
  $$("#onglets-prive [data-p]").forEach(b => b.onclick = () => { $("#menu-tresor").hidden = true; $("#o-tresor").setAttribute("aria-expanded", "false"); montrer(b.dataset.p); });
  // Onglet « Trésorerie » : menu déroulant (alchimie / cuisine)
  $("#o-tresor").onclick = e => {
    e.stopPropagation();
    const choix = $$("#menu-tresor [data-p]").filter(b => !b.hidden);
    if (choix.length === 1) { montrer(choix[0].dataset.p); return; }
    const m = $("#menu-tresor"); m.hidden = !m.hidden; $("#o-tresor").setAttribute("aria-expanded", String(!m.hidden));
  };
  document.addEventListener("click", e => { if (!e.target.closest(".onglet-menu")) { $("#menu-tresor").hidden = true; $("#o-tresor").setAttribute("aria-expanded", "false"); } });
  function montrer(p) {
    if (p === "ventes" || p === "achats") p = cuisinier() ? "tresor-cuisine" : "tresor-alchimie";
    if (p === "eaunoire" && !accesEN()) p = "accueil";
    onglet = p;
    // En arrivant sur une trésorerie : d'abord la sélection (ensemble, offres, personne)
    if (p.startsWith("tresor-")) { tresorDom = p.slice(7); tresorQui = null; }
    const panneau = p.startsWith("tresor-") ? "tresor" : p;
    $$("#onglets-prive [data-p]").forEach(b => b.setAttribute("aria-selected", b.dataset.p === p));
    $("#o-tresor").setAttribute("aria-selected", String(p.startsWith("tresor-")));
    $("#o-tresor-dom").textContent = p === "tresor-alchimie" ? "alchimie" : p === "tresor-cuisine" ? "cuisine" : "";
    $$(".panneau").forEach(x => x.hidden = x.id !== "panneau-" + panneau);
    if (p === "carte") initCarte();
    renderTout();
  }

  function renderTout() {
    if (!session) return;
    renderSync();
    renderAccueil();
    if (onglet === "ingredients") renderIngredients();
    if (onglet === "potions") renderPotions();
    if (onglet === "carte") renderCarte();
    if (onglet === "accords") renderAccords();
    if (onglet === "notes") renderNotes();
    if (onglet === "eaunoire") renderEauNoire();
    const nn = responsable() ? Object.values(D.notes || {}).filter(n => n.statut === "nouvelle").length : 0;
    $("#p-notes").hidden = !nn; $("#p-notes").textContent = nn;
    if (onglet.startsWith("tresor-")) renderTresor();
    // Pastille : achats à valider dans ma partie + offres ouvertes que je peux accepter
    const no = offres().filter(o => responsable() ? o.statut === "en-cours" : o.statut === "ouverte").length;
    $("#p-offres").hidden = !no; $("#p-offres").textContent = no;
    $("#k-ajouter").hidden = !responsable();
  }

  /* =================================================================
     TABLEAU DE BORD
     ================================================================= */
  // Notifications du tableau de bord, rangées en trois colonnes : alchimie, cuisine, accords
  function alertesListe() {
    const out = [];
    INGREDIENTS.forEach(i => domainesDe("ingredients", i.id).forEach((dom, n) => {
      const v = vueIng(i.id, dom), e = etat(v);
      if (v.accord && n === 0) out.push({ cat: "accords", type: "accord", ico: "🔔", titre: i.nom + " : accord requis", detail: [v.chatellerie, v.accordTexte].filter(Boolean).join(" · ") || "Voir avec la gérante", aller: "ingredients" });
      if (e === "rupture" || e === "bas") out.push({ cat: dom, type: e, ico: e === "rupture" ? "⚠" : "◔", titre: "Ingrédient — " + i.nom, detail: `${ETAT[e]} : ${nb(v.stock)} / ${nb(v.seuil)}`, aller: "ingredients" });
    }));
    POTIONS.forEach(p => (estPlat(p.id) ? ["eau-noire", "edmond"] : ["eau-noire"]).forEach(res => {
      const v = vueRes(p.id, res), e = etat(v);
      if (e === "rupture" || e === "bas") out.push({ cat: estPlat(p.id) ? "cuisine" : "alchimie", type: e, ico: e === "rupture" ? "⚠" : "◔", titre: (estPlat(p.id) ? "Plat — " : "Potion — ") + p.nom + (estPlat(p.id) ? " (stock " + RESERVES[res].nom + ")" : ""), detail: `${ETAT[e]} : ${nb(v.stock)} / ${nb(v.seuil)}`, aller: "potions" });
    }));
    offres().forEach(o => {
      const titre = (o.lignes || []).map(l => nomArticle(l) + " ×" + l.qte).join(", ");
      if (o.statut === "en-cours" && responsable()) out.push({ cat: o.domaine, type: "accord", ico: "🛒", titre: "Achat à valider — pris par " + o.preneur, detail: titre, aller: "tresor-" + o.domaine, qui: "offres" });
      if (o.statut === "ouverte" && !responsable()) out.push({ cat: o.domaine, type: "accord", ico: "🛒", titre: "Offre d'achat ouverte", detail: titre + " · " + nb(totalOffre(o)) + " " + M, aller: "tresor-" + o.domaine, qui: "offres" });
    });
    if (responsable()) accords().filter(a => a.statut === "propose").forEach(a => out.push({ cat: "accords", type: "accord", ico: "✒", titre: "Accord proposé par " + (a.proposePar || "l'équipe"), detail: a.partenaire + " — à valider", aller: "accords" }));
    points().filter(p => p.accord).forEach(p => out.push({ cat: "accords", type: "accord", ico: "🗺", titre: "Carte — " + p.titre, detail: p.accordTexte || ("Accord requis (" + (p.chatellerie || "châtellerie") + ")"), aller: "carte" }));
    const rang = { rupture: 0, accord: 1, bas: 2 };
    return out.sort((a, b) => rang[a.type] - rang[b.type]);
  }
  function renderAccueil() {
    const ING = INGREDIENTS.filter(i => voit("ingredients", i.id)), POT = POTIONS.filter(p => voit("potions", p.id));
    const ingEnStock = ING.filter(i => lignesIng().some(x => x.i === i && vueIng(i.id, x.dom).stock > 0)).length;
    const qteTot = id => { const v = potV(id); return (+v.stock || 0) + (estPlat(id) ? (+v.stockEdmond || 0) : 0); };
    const potEnStock = POT.filter(p => qteTot(p.id) > 0).length;
    const valeurPot = POT.reduce((a, p) => a + qteTot(p.id) * potV(p.id).prix, 0);
    const al = alertesListe();
    const nAlerte = al.filter(a => a.type !== "accord").length;
    const ac = accords();
    $("#resume").innerHTML = `
      <div class="bloc cadre"><strong>${ingEnStock}</strong><span>ingrédients en stock sur ${ING.length}</span></div>
      <div class="bloc cadre"><strong>${potEnStock}</strong><span>produits en stock sur ${POT.length}</span></div>
      <div class="bloc cadre"><strong>${nb(valeurPot)}</strong><span>${M} de produits en réserve</span></div>
      <div class="bloc cadre ${nAlerte ? "bas" : ""}"><strong>${nAlerte}</strong><span>stocks bas ou en rupture</span></div>
      <div class="bloc cadre"><strong>${ac.filter(a => a.statut === "actif").length}</strong><span>accords actifs</span></div>
      <div class="bloc cadre" data-aller="${cuisinier() ? "tresor-cuisine" : "tresor-alchimie"}" style="cursor:pointer"><strong>${nb(totalJour(aujourdhui()))}</strong><span>${M} vendus aujourd'hui${monDomaine() ? "" : " (alchimie + cuisine)"}</span></div>`;
    // Trésoreries : la Fiole (alchimie), la Marmite (cuisine), l'Eau Noire, et la Boutique (Fiole + Marmite)
    const tF = tresorDe("alchimie"), tM = tresorDe("cuisine"), tE = Math.round(cumul(ventes()).forge * 100) / 100, tB = Math.round((tF + tM) * 100) / 100;
    const carteT = (v, nom, detail, aller, lis) => `<div class="bloc cadre tresor-boutique lis ${lis} ${v < 0 ? "rupture" : ""}"${aller ? ` data-aller="${aller}" data-aller-qui="ensemble" style="cursor:pointer"` : ""} title="${detail}"><strong>${nb(v)}</strong><span>${M} — trésorerie ${nom}</span></div>`;
    $("#resume-tresors").innerHTML = carteT(tF, "de la Fiole", TAUX.boutique + " % des ventes d'alchimie, moins les achats d'alchimie", "tresor-alchimie", "lis-fiole")
      + carteT(tM, "de la Marmite", TAUX.boutique + " % des ventes de cuisine, moins les achats de cuisine", "tresor-cuisine", "lis-marmite")
      + carteT(tE, "de l'Eau Noire", TAUX.forge + " % de toutes les ventes (alchimie et cuisine)", "", "lis-forge")
      + carteT(tB, "de la Boutique", "La Fiole + la Marmite", "", "lis-boutique");
    const carteAlerte = a => `
      <div class="alerte ${a.type}" data-aller="${a.aller}"${a.qui ? ` data-aller-qui="${a.qui}"` : ""} style="cursor:pointer"><span class="ico">${a.ico}</span><div><b>${esc(a.titre)}</b><small>${esc(a.detail)}</small></div></div>`;
    const liste = (l, vide) => l.length ? l.slice(0, 30).map(carteAlerte).join("") + (l.length > 30 ? `<p class="mute">… et ${l.length - 30} autres.</p>` : "") : `<p class="mute"><i>${vide}</i></p>`;
    ["alchimie", "cuisine"].forEach(c => {
      const l = al.filter(a => a.cat === c);
      $("#n-" + c).textContent = l.length || "";
      $("#alertes-" + c).innerHTML = liste(l, "Aucune notification. Fixez des seuils dans les onglets Ingrédients et Potions pour être prévenu des stocks bas.");
    });
    const alAc = al.filter(a => a.cat === "accords");
    $("#n-accords").textContent = alAc.length || "";
    $("#alertes-accords").innerHTML = alAc.length ? liste(alAc, "") : "";
    const enCoursAc = ac.filter(a => a.statut === "actif" || a.statut === "negociation");
    $("#accords-resume").innerHTML = enCoursAc.length ? enCoursAc.map(a => `
      <div class="alerte" data-aller="accords" style="cursor:pointer;border-left-color:${a.statut === "actif" ? "var(--ok)" : "var(--bas)"}"><span class="ico">✒</span>
      <div><b>${esc(a.partenaire)}</b><small>${esc([a.type, a.lieu || a.chatellerie, a.statut === "negociation" ? "en négociation" : ""].filter(Boolean).join(" · "))}</small></div></div>`).join("")
      : `<p class="mute"><i>Aucun accord en cours.</i></p>`;
    const n = al.length;
    $("#p-alertes").hidden = !n; $("#p-alertes").textContent = n;
  }
  document.addEventListener("click", e => { const a = e.target.closest("[data-aller]"); if (!a) return; montrer(a.dataset.aller); if (a.dataset.allerQui) { tresorQui = a.dataset.allerQui; renderTresor(); } });

  /* =================================================================
     INGRÉDIENTS
     ================================================================= */
  function stockCell(col, id, v, champ) {
    champ = champ || "stock";
    if (!peutStock(col, id)) return `<b>${nb(v.stock)}</b>`;
    return `<div class="stock-edit"><button type="button" data-col="${col}" data-id="${id}" data-champ="${champ}" data-d="-1" aria-label="Retirer">−</button>
      <input type="number" min="0" inputmode="numeric" value="${v.stock}" data-col="${col}" data-id="${id}" data-champ="${champ}" aria-label="Stock">
      <button type="button" data-col="${col}" data-id="${id}" data-champ="${champ}" data-d="1" aria-label="Ajouter">+</button></div>`;
  }
  const champNum = (col, id, champ, val) => peutModifier(col, id)
    ? `<input class="prix-edit" type="number" min="0" step="any" value="${val}" data-col="${col}" data-id="${id}" data-champ="${champ}">`
    : `<span>${nb(val)}</span>`;

  function renderIngredients() {
    const mots = norm($("#i-recherche").value).split(/\s+/).filter(Boolean);
    const f = $("#i-filtre").value;
    const rows = lignesIng().filter(({ i, dom }) => {
      const v = vueIng(i.id, dom), e = etat(v);
      if (f === "alerte" && !(e === "bas" || e === "rupture")) return false;
      if (f === "accord" && !v.accord) return false;
      if (f === "cuisine" && dom !== "cuisine") return false;
      if (f === "alchimie" && dom !== "alchimie") return false;
      if (f === "stock" && !(v.stock > 0)) return false;
      return mots.every(m => norm(i.nom + " " + (i.en || "") + " " + i.effets.join(" ") + " " + i.source + " " + (i.dlc || "")).includes(m));
    });
    $("#t-ingredients").innerHTML = `<thead><tr><th class="ic"></th><th>Ingrédient</th><th>Effets</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">Prix rachat<small>${M}</small></th><th class="num">Prix vente<small>${M}</small></th><th class="num">Marge<small>vente − rachat</small></th><th>Accord</th><th>État</th></tr></thead>
      <tbody>${rows.map(({ i, dom }) => {
        const v = vueIng(i.id, dom), e = etat(v), ps = peutStockIng(i.id, dom);
        return `<tr>
          <td class="ic"><img src="images/ingredients/${i.id}.webp" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
          <td class="nom">${esc(i.nom)}${i.en ? ` <span class="en">${esc(i.en)}</span>` : ""}${i.dlc ? ` <span class="mute" style="font-size:.8rem">(${i.dlc})</span>` : ""}${i.interdit ? ` <span class="interdit-tag">Interdit</span>` : ""}<small>${esc(i.source)}</small>${i.recette ? blocRecettes([i.recette]) : ""}</td>
          <td><div class="effets">${i.cuisine ? `<span>Denrée de cuisine</span>` : ""}${i.commun ? `<span class="commun">${dom === "cuisine" ? "Stock cuisine" : "Stock alchimie"} (commun)</span>` : ""}${i.effets.map(x => `<span>${esc(x)}</span>`).join("")}</div></td>
          <td class="num">${ps ? stockCell("ingredients", i.id, v, v._cs) : `<b>${nb(v.stock)}</b>`}</td>
          <td class="num">${ps ? champNum("ingredients", i.id, v._ce, v.seuil) : `<span>${nb(v.seuil)}</span>`}</td>
          <td class="num p-rachat">${champNum("ingredients", i.id, "prixAchat", v.prixAchat)}</td>
          <td class="num p-vente">${champNum("ingredients", i.id, "prix", v.prix)}</td>
          <td class="num">${margeHTML(v)}</td>
          <td><button class="cloche ${v.accord ? "on" : ""}" type="button" data-cloche="${i.id}" title="${peutModifier("ingredients", i.id) ? "Indiquer un accord requis" : v.accord ? "Accord requis" : ""}" ${peutModifier("ingredients", i.id) ? "" : "disabled"}>🔔</button>
            ${v.accord ? `<span class="cloche-texte">${esc([v.chatellerie, v.accordTexte].filter(Boolean).join(" · ") || "Accord requis")}</span>` : ""}</td>
          <td><span class="etat ${e}">${ETAT[e]}</span></td></tr>`;
      }).join("")}</tbody>`;
    if (!rows.length) $("#t-ingredients").innerHTML += `<tbody><tr><td colspan="10" class="vide">Aucun ingrédient.</td></tr></tbody>`;
  }
  $("#i-recherche").addEventListener("input", renderIngredients);
  $("#i-filtre").onchange = renderIngredients;

  /* =================================================================
     POTIONS
     ================================================================= */
  $("#p-cat").innerHTML = `<option value="">Toutes catégories</option>` + CATS.map(c => `<option>${c}</option>`).join("");
  function renderPotions() {
    const mots = norm($("#p-recherche").value).split(/\s+/).filter(Boolean);
    const cat = $("#p-cat").value, f = $("#p-filtre").value;
    $("#p-aide").textContent = responsable()
      ? "Le prix de vente et la case « Vitrine » sont publiés sur la page des clients ; le prix de rachat sert aux offres d'achat. ★ = sur l'accueil de la vitrine (" + MAX_VEDETTES + " potions et " + MAX_VEDETTES + " plats au maximum)."
      : "Consultation seule : Elvara, Amaury et Edmond gèrent les prix et les stocks.";
    // Onglets de stock des plats (Eau Noire / Edmond), visibles quand des plats sont affichés
    const avecPlats = (cat === "" || cat === "Nourriture") && POTIONS.some(p => estPlat(p.id) && voit("potions", p.id));
    $("#p-reserves").hidden = !avecPlats;
    $$("#p-reserves button").forEach(b => b.setAttribute("aria-selected", b.dataset.reserve === reserve));
    if (avecPlats) $("#p-aide").textContent += " Plats : vous consultez le stock " + (reserve === "edmond" ? "personnel d'Edmond." : "de l'Eau Noire.");
    const rows = POTIONS.filter(p => {
      if (!voit("potions", p.id)) return false;
      const v = vueRes(p.id), e = etat(v);
      if (cat && p.categorie !== cat) return false;
      if (f === "alerte" && !(e === "bas" || e === "rupture")) return false;
      if (f === "vitrine" && (!v.vitrine || p.interdit)) return false;
      if (f === "interdit" && !p.interdit) return false;
      if (f === "cachee" && v.vitrine) return false;
      return mots.every(m => norm(p.nom + " " + (p.en || "") + " " + p.famille + " " + p.effet + " " + motsRecettes(p.recettes)).includes(m));
    });
    $("#t-potions").innerHTML = `<thead><tr><th class="ic"></th><th>Article</th><th class="num">Stock${avecPlats ? `<small style="display:block;font-size:.72rem">plats : ${RESERVES[reserve].nom}</small>` : ""}</th><th class="num">Seuil</th><th class="num">Prix rachat<small>${M}</small></th><th class="num">Prix vente<small>${M}</small></th><th class="num">Marge<small>vente − rachat</small></th><th>Vitrine</th><th>Accueil</th><th>État</th></tr></thead>
      <tbody>${rows.map(p => {
        const v = vueRes(p.id), e = etat(v), iv = vedettesDe(domaineDe("potions", p.id)).indexOf(p.id), pm = peutModifier("potions", p.id);
        return `<tr>
          <td class="ic"><img src="images/potions/${p.img}" alt="" loading="lazy"></td>
          <td class="nom">${esc(p.nom)}${p.en ? ` <span class="en">${esc(p.en)}</span>` : ""}${p.interdit ? ` <span class="interdit-tag" title="Jamais affiché sur la vitrine">Interdit</span>` : ""}<small>${esc(p.famille)} · ${esc(p.effet)}</small>${blocRecettes(p.recettes)}</td>
          <td class="num">${stockCell("potions", p.id, v, v._cs)}</td>
          <td class="num">${champNum("potions", p.id, v._ce, v.seuil)}</td>
          <td class="num p-rachat">${champNum("potions", p.id, "prixAchat", v.prixAchat)}</td>
          <td class="num p-vente">${champNum("potions", p.id, "prix", v.prix)}</td>
          <td class="num">${margeHTML(v)}</td>
          <td>${p.interdit ? `<span class="mute" title="Objet interdit : jamais sur la vitrine">—</span>` : pm ? `<label class="case"><input type="checkbox" data-vitrine="${p.id}" ${v.vitrine ? "checked" : ""}></label>` : (v.vitrine ? "✓" : `<span class="mute">—</span>`)}</td>
          <td>${p.interdit ? "" : pm ? `<button class="cloche ${iv >= 0 ? "on" : ""}" type="button" data-vedette="${p.id}" title="Mettre sur l'accueil de la vitrine">★</button>` : (iv >= 0 ? "★" : "")}</td>
          <td><span class="etat ${e}">${ETAT[e]}</span></td></tr>`;
      }).join("")}</tbody>`;
  }
  $("#p-recherche").addEventListener("input", renderPotions);
  $$("#p-reserves button").forEach(b => b.onclick = () => { reserve = b.dataset.reserve; renderPotions(); });
  $("#p-cat").onchange = $("#p-filtre").onchange = renderPotions;

  /* ---------- Fiche de fabrication ----------
     Potions (hors nourriture) en stock bas ou en rupture, AVEC un seuil, hors
     invisibilité (cœurs de daedra interdits) : quantité à fabriquer jusqu'au
     seuil et total des ingrédients de la recette principale. */
  const EXCLUS_FICHE = p => p.famille === "Invisibilité";
  function calculFiche(rendement) {
    rendement = Math.max(1, Math.round(+rendement || 1));
    const aFaire = [], sansRecette = [], besoins = {}, inconnus = new Set();
    POTIONS.filter(p => !estPlat(p.id) && !EXCLUS_FICHE(p)).forEach(p => {
      const v = potV(p.id), seuil = +v.seuil || 0, stock = +v.stock || 0;
      if (!seuil || stock >= seuil) return;              // pas de seuil, ou stock suffisant
      const qte = seuil - stock, rec = (p.recettes || [])[0];
      if (!rec || !rec.length) { sansRecette.push({ p, stock, seuil, qte }); return; }
      const fois = Math.ceil(qte / rendement);
      rec.forEach(([id, q]) => {
        if (q == null) { inconnus.add(id); besoins[id] = besoins[id] || 0; return; }
        besoins[id] = (besoins[id] || 0) + q * fois;
      });
      aFaire.push({ p, stock, seuil, qte, fois, rec });
    });
    const dispo = id => byIng[id] ? vueIng(id, "alchimie").stock : byPot[id] ? (+potV(id).stock || 0) : 0;
    const ingr = Object.keys(besoins).map(id => ({ id, nom: nomIng(id), q: besoins[id], inconnu: inconnus.has(id), stock: dispo(id) }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    // Faisable avec le stock actuel : les ingrédients sont partagés entre les potions,
    // on sert d'abord les ruptures, puis les plus gros manques
    const reste = Object.fromEntries(Object.keys(besoins).map(id => [id, dispo(id)]));
    const faisables = aFaire.slice().sort((a, b) => (a.stock > 0) - (b.stock > 0) || b.qte - a.qte).map(x => {
      const connus = x.rec.filter(([, q]) => q != null && q > 0);
      const inconnu = x.rec.some(([, q]) => q == null);
      let fois = connus.length ? Math.min(x.fois, ...connus.map(([id, q]) => Math.floor((reste[id] || 0) / q))) : 0;
      if (fois < 0) fois = 0;
      connus.forEach(([id, q]) => reste[id] = (reste[id] || 0) - q * fois);
      const faisable = Math.min(x.qte, fois * rendement);
      const manque = faisable < x.qte ? connus.map(([id, q]) => ({ id, nom: nomIng(id), q: q * (x.fois - fois) - Math.max(0, reste[id] || 0) })).filter(m => m.q > 0) : [];
      return Object.assign({}, x, { faisable, manque, inconnu });
    });
    return { aFaire, sansRecette, ingr, rendement, faisables };
  }
  function renderFiche() {
    const F = calculFiche($("#fiche-rendement").value);
    $("#fiche-date").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (!F.aFaire.length && !F.sansRecette.length) { $("#fiche-corps").innerHTML = `<p class="vide">Rien à fabriquer : aucune potion avec un seuil n'est en stock bas ou en rupture.</p>`; return; }
    const nbPot = F.aFaire.reduce((t, x) => t + x.qte, 0), manque = F.ingr.filter(x => !x.inconnu && x.stock < x.q).length;
    $("#fiche-corps").innerHTML = `
      <div class="resume fiche-resume">
        <div class="bloc cadre lis lis-fiole"><strong>${nb(nbPot)}</strong><span>potion${nbPot > 1 ? "s" : ""} à fabriquer (${F.aFaire.length} sorte${F.aFaire.length > 1 ? "s" : ""})</span></div>
        <div class="bloc cadre"><strong>${nb(F.ingr.reduce((t, x) => t + x.q, 0))}</strong><span>ingrédients à prendre (${F.ingr.length} sorte${F.ingr.length > 1 ? "s" : ""})</span></div>
        <div class="bloc cadre ${manque ? "bas" : ""}"><strong>${manque}</strong><span>ingrédient${manque > 1 ? "s" : ""} en stock insuffisant</span></div>
      </div>
      <h4 class="fiche-h4">Ingrédients à prendre sur soi</h4>
      <div class="table-wrap"><table class="registre fiche-table">
        <thead><tr><th class="ic"></th><th>Ingrédient</th><th class="num">À prendre</th><th class="num">En stock<small>alchimie</small></th><th class="num">Manque</th></tr></thead>
        <tbody>${F.ingr.map(x => { const m = Math.max(0, x.q - x.stock);
          return `<tr class="${!x.inconnu && m ? "fiche-manque" : ""}">
            <td class="ic">${byIng[x.id] ? `<img src="images/ingredients/${x.id}.webp" alt="" onerror="this.style.visibility='hidden'">` : byPot[x.id] ? `<img src="images/potions/${byPot[x.id].img}" alt="">` : ""}</td>
            <td class="nom">${esc(x.nom)}${(byIng[x.id] || byPot[x.id] || {}).en ? ` <span class="en">${esc((byIng[x.id] || byPot[x.id]).en)}</span>` : ""}</td>
            <td class="num"><b>${x.inconnu ? (x.q ? nb(x.q) + " + ?" : "?") : nb(x.q)}</b></td>
            <td class="num">${nb(x.stock)}</td>
            <td class="num">${x.inconnu ? `<span class="mute">quantité inconnue</span>` : m ? `<b class="rouge">${nb(m)}</b>` : `<span class="ok">—</span>`}</td></tr>`; }).join("")}</tbody>
      </table></div>
      <h4 class="fiche-h4">Potions à fabriquer</h4>
      <div class="table-wrap"><table class="registre fiche-table">
        <thead><tr><th class="ic"></th><th>Potion</th><th class="num">Stock / seuil</th><th class="num">À faire</th><th>Recette${F.rendement > 1 ? " (× nombre de fois)" : " (par potion)"}</th></tr></thead>
        <tbody>${F.aFaire.map(x => `<tr>
          <td class="ic"><img src="images/potions/${x.p.img}" alt=""></td>
          <td class="nom">${esc(x.p.nom)}${x.p.en ? ` <span class="en">${esc(x.p.en)}</span>` : ""}</td>
          <td class="num">${nb(x.stock)} / ${nb(x.seuil)}</td>
          <td class="num"><b>${nb(x.qte)}</b>${F.rendement > 1 ? `<small class="mute"> (${x.fois}×)</small>` : ""}</td>
          <td><div class="recette">${ligneRecette(x.rec)}</div></td></tr>`).join("")}</tbody>
      </table></div>
      <h4 class="fiche-h4">Faisable avec le stock actuel</h4>
      <p class="mute fiche-note" style="margin:0 0 8px">Les ingrédients en stock sont répartis entre les potions (ruptures d'abord) : ce que l'on peut fabriquer tout de suite, sans rien acheter ni récolter.</p>
      <div class="table-wrap"><table class="registre fiche-table">
        <thead><tr><th class="ic"></th><th>Potion</th><th class="num">Faisable</th><th class="num">À faire</th><th>État</th><th>Il manque pour le reste</th></tr></thead>
        <tbody>${F.faisables.map(x => { const e = x.faisable >= x.qte ? "ok" : x.faisable > 0 ? "bas" : "rupture";
          return `<tr>
          <td class="ic"><img src="images/potions/${x.p.img}" alt=""></td>
          <td class="nom">${esc(x.p.nom)}${x.p.en ? ` <span class="en">${esc(x.p.en)}</span>` : ""}</td>
          <td class="num"><b class="${e === "ok" ? "ok" : e === "rupture" ? "rouge" : ""}">${nb(x.faisable)}</b></td>
          <td class="num">${nb(x.qte)}</td>
          <td><span class="etat ${e}">${e === "ok" ? "Faisable" : e === "bas" ? "En partie" : "Pas faisable"}</span>${x.inconnu ? ` <span class="mute" title="Une quantité de la recette est inconnue">(?)</span>` : ""}</td>
          <td>${x.manque.length ? `<div class="recette">${x.manque.map(m => `<span class="ing">${esc(m.nom)} <b>×${nb(m.q)}</b></span>`).join("")}</div>` : `<span class="mute">—</span>`}</td></tr>`; }).join("")}</tbody>
      </table></div>
      ${F.sansRecette.length ? `<p class="mute fiche-note">Sans recette enregistrée (non comptées dans les ingrédients) : ${F.sansRecette.map(x => esc(x.p.nom) + " ×" + x.qte).join(", ")}.</p>` : ""}`;
  }
  function texteFiche() {
    const F = calculFiche($("#fiche-rendement").value), l = [`⚗ **Fiche de fabrication — ${BOUTIQUE.nom}** (${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })})`, ""];
    if (!F.aFaire.length) return l[0] + "\nRien à fabriquer pour le moment.";
    if (F.rendement > 1) l.push(`*Une recette produit ${F.rendement} potions.*`, "");
    l.push("**Potions à fabriquer :**");
    F.aFaire.forEach(x => l.push(`- ${x.p.nom} ×${x.qte} (stock ${x.stock} / seuil ${x.seuil})`));
    l.push("", "**Ingrédients à prendre sur soi :**");
    F.ingr.forEach(x => { const m = Math.max(0, x.q - x.stock); l.push(`- ${x.nom} ×${x.inconnu ? (x.q ? x.q + " + ?" : "?") : x.q}${!x.inconnu && m ? ` (manque ${m})` : ""}`); });
    const ok = F.faisables.filter(x => x.faisable > 0);
    l.push("", "**Faisable tout de suite avec le stock :**");
    if (ok.length) ok.forEach(x => l.push(`- ${x.p.nom} ×${x.faisable}${x.faisable < x.qte ? ` (sur ${x.qte})` : ""}`)); else l.push("- Rien pour le moment");
    if (F.sansRecette.length) l.push("", "*Sans recette : " + F.sansRecette.map(x => x.p.nom + " ×" + x.qte).join(", ") + "*");
    return l.join("\n");
  }
  $("#p-fiche").onclick = () => { renderFiche(); ouvrirF("#f-fiche"); };
  $("#fiche-rendement").addEventListener("input", renderFiche);
  $("#fiche-copier").onclick = async () => { const ok = await copier(texteFiche()); toast(ok ? "Fiche copiée : collez-la sur Discord (Ctrl+V)" : "Impossible de copier", !ok); };
  $("#fiche-imprimer").onclick = () => { document.body.classList.add("impression-fiche"); window.print(); setTimeout(() => document.body.classList.remove("impression-fiche"), 500); };

  /* ---------- Modifications des tableaux ---------- */
  const attente = {};
  function planifier(col, id, champs, delai) {
    const k = col + "|" + id;
    attente[k] = Object.assign(attente[k] || {}, champs);
    // affichage immédiat
    const o = D[col][id] || (D[col][id] = {}); Object.assign(o, champs);
    clearTimeout(attente[k]._t);
    const t = setTimeout(() => { const c = Object.assign({}, attente[k]); delete c._t; delete attente[k]; enregistrer(col, { [id]: c }); }, delai);
    Object.defineProperty(attente[k], "_t", { value: t, enumerable: false, writable: true });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".stock-edit button[data-col]");
    if (b) {
      const { col, id } = b.dataset, champ = b.dataset.champ || "stock", v = col === "ingredients" ? ingV(id) : potV(id);
      const s = Math.max(0, (+v[champ] || 0) + (+b.dataset.d));
      planifier(col, id, { [champ]: s }, 700);
      const inp = b.parentElement.querySelector("input"); if (inp) inp.value = s;
      return;
    }
    const v = e.target.closest("[data-vedette]");
    if (v) {
      const id = v.dataset.vedette, dom = domaineDe("potions", id);
      if (!peutModifier("potions", id)) return;
      let l = vedettesDe(dom), mot = dom === "cuisine" ? "plats" : "potions";
      if (l.includes(id)) l = l.filter(x => x !== id);
      else { if (l.length >= MAX_VEDETTES) { toast(MAX_VEDETTES + " " + mot + " au maximum sur l'accueil : retirez-en un d'abord.", true); return; } l.push(id); }
      enregistrer("reglages", { vitrine: { [dom === "cuisine" ? "plats" : "potions"]: l } }, "Accueil de la vitrine mis à jour");
      return;
    }
    const c = e.target.closest("[data-cloche]");
    if (c && peutModifier("ingredients", c.dataset.cloche)) ouvrirCloche(c.dataset.cloche);
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.matches("input[data-champ]")) {
      const n = Math.max(0, +String(t.value).replace(",", ".") || 0);
      const val = t.dataset.champ === "prix" || t.dataset.champ === "prixAchat" ? Math.round(n * 100) / 100 : Math.round(n);
      enregistrer(t.dataset.col, { [t.dataset.id]: { [t.dataset.champ]: val } });
    }
    if (t.matches("[data-vitrine]")) enregistrer("potions", { [t.dataset.vitrine]: { vitrine: t.checked } }, t.checked ? "Ajoutée à la vitrine" : "Retirée de la vitrine");
  });

  /* ---------- Accord requis sur un ingrédient ---------- */
  const optCh = sel => `<option value="">—</option>` + CHATELLERIES.map(c => `<option${c === sel ? " selected" : ""}>${esc(c)}</option>`).join("");
  let clocheId = null;
  function ouvrirCloche(id) {
    clocheId = id; const v = ingV(id), f = $("#form-cloche");
    $("#f-cloche-nom").textContent = byIng[id].nom;
    f.accord.checked = !!v.accord; f.chatellerie.innerHTML = optCh(v.chatellerie); f.accordTexte.value = v.accordTexte || "";
    ouvrirF("#f-cloche");
  }
  $("#form-cloche").onsubmit = e => {
    e.preventDefault(); const f = e.target;
    enregistrer("ingredients", { [clocheId]: { accord: f.accord.checked, chatellerie: f.chatellerie.value, accordTexte: f.accordTexte.value.trim() } }, "Accord enregistré");
    fermerF();
  };

  /* =================================================================
     CARTE (Leaflet)
     ================================================================= */
  const W = 1600, H = 1200;
  let carte = null, calque = null, modeAjout = false, editId = null, posAjout = null;
  const versLL = (x, y) => [H - y, x];
  $("#k-ch").innerHTML += CHATELLERIES.map(c => `<option>${esc(c)}</option>`).join("");
  $("#k-ing").innerHTML += INGREDIENTS.map(i => `<option value="${i.id}">${esc(i.nom)}</option>`).join("");
  $("#k-aide").textContent = "Cliquez sur un sceau pour voir ce qu'on y récolte. « Ajouter un lieu » puis cliquez sur la carte pour placer un nouveau point.";

  function initCarte() {
    if (carte || typeof L === "undefined") return;
    carte = L.map("carte", { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomSnap: .25, attributionControl: false });
    const b = [[0, 0], [H, W]];
    L.imageOverlay("images/carte-bordeciel.jpg", b).addTo(carte);
    carte.fitBounds(b); carte.setMaxBounds([[-200, -200], [H + 200, W + 200]]);
    calque = L.layerGroup().addTo(carte);
    carte.on("click", ev => {
      if (!modeAjout) return;
      modeAjout = false; document.body.classList.remove("mode-ajout");
      posAjout = { x: Math.round(ev.latlng.lng), y: Math.round(H - ev.latlng.lat) };
      ouvrirLieu(null);
    });
    setTimeout(() => carte.invalidateSize(), 50);
  }
  function filtrePoints() {
    const ing = $("#k-ing").value, ch = $("#k-ch").value, ac = $("#k-accord").checked;
    return points().filter(p => (!ing || (p.ingredients || []).includes(ing)) && (!ch || p.chatellerie === ch) && (!ac || p.accord));
  }
  function popupHtml(p) {
    return `<div class="pop"><h4>${esc(p.titre)}</h4><div class="lieu">${esc(p.chatellerie || "")}</div>
      ${p.accord ? `<div class="accord-txt">🔔 ${esc(p.accordTexte || "Accord de la châtellerie requis")}</div>` : ""}
      ${(p.ingredients || []).length ? `<ul>${p.ingredients.filter(id => byIng[id]).map(id => `<li><img src="images/ingredients/${id}.webp" alt="">${esc(byIng[id].nom)}</li>`).join("")}</ul>` : ""}
      ${p.note ? `<p style="margin:6px 0 0;font-size:.9rem">${esc(p.note)}</p>` : ""}
      ${responsable() ? `<div class="actions"><button class="btn-sobre btn-petit" type="button" data-pt-edit="${p.id}">Modifier</button>
      <button class="btn-sobre btn-petit" type="button" data-pt-move="${p.id}">Déplacer</button>
      ${p.type === "boutique" ? "" : `<button class="btn-sobre btn-petit" type="button" data-pt-del="${p.id}">Supprimer</button>`}</div>` : ""}</div>`;
  }
  function renderCarte() {
    const liste = filtrePoints();
    $("#k-aide").textContent = responsable()
      ? "Cliquez sur un sceau pour voir ce qu'on y récolte. « Ajouter un lieu » puis cliquez sur la carte pour placer un nouveau point."
      : "Cliquez sur un sceau pour voir ce qu'on y récolte. Les lieux sont tenus à jour par Elvara et Edmond.";
    $("#k-n").textContent = "(" + liste.length + ")";
    $("#k-liste").innerHTML = liste.map(p => `<li data-pt="${p.id}">${p.accord ? "🔔 " : ""}${esc(p.titre)} <span class="mute">· ${esc(p.chatellerie || "")}</span></li>`).join("") || `<li class="mute">Aucun lieu.</li>`;
    if (!carte) return;
    calque.clearLayers();
    liste.forEach(p => {
      const cls = p.type === "boutique" ? "boutique" : p.accord ? "accord" : "";
      const ic = L.divIcon({ className: "", html: `<div class="sceau ${cls}"><span>${p.type === "boutique" ? "⚗" : p.accord ? "!" : "✿"}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 34], popupAnchor: [0, -32] });
      const m = L.marker(versLL(p.x, p.y), { icon: ic, title: p.titre }).addTo(calque).bindPopup(popupHtml(p));
      m._fioleId = p.id;
    });
  }
  ["#k-ing", "#k-ch", "#k-accord"].forEach(s => $(s).onchange = renderCarte);
  $("#k-ajouter").onclick = () => {
    modeAjout = true; document.body.classList.add("mode-ajout");
    toast("Cliquez sur la carte à l'endroit du nouveau lieu");
  };
  document.addEventListener("click", e => {
    const li = e.target.closest("[data-pt]");
    if (li && carte) {
      const p = points().find(x => x.id === li.dataset.pt); if (!p) return;
      carte.setView(versLL(p.x, p.y), Math.max(carte.getZoom(), 0.5));
      calque.eachLayer(m => { if (m._fioleId === p.id) m.openPopup(); });
      return;
    }
    const ed = e.target.closest("[data-pt-edit]"); if (ed) { ouvrirLieu(ed.dataset.ptEdit); return; }
    const del = e.target.closest("[data-pt-del]");
    if (del) {
      const id = del.dataset.ptDel, p = points().find(x => x.id === id);
      if (!confirm("Supprimer « " + (p ? p.titre : id) + " » de la carte ?")) return;
      const seed = CARTE_DEPART.some(x => x.id === id);
      enregistrer("carte", { [id]: seed ? { supprime: true } : null }, "Lieu supprimé");
      return;
    }
    const mv = e.target.closest("[data-pt-move]");
    if (mv) {
      const id = mv.dataset.ptMove; carte.closePopup();
      calque.eachLayer(m => {
        if (m._fioleId !== id) return;
        m.dragging.enable(); toast("Faites glisser le sceau à sa nouvelle place");
        m.once("dragend", ev => {
          const ll = ev.target.getLatLng();
          enregistrer("carte", { [id]: { x: Math.round(ll.lng), y: Math.round(H - ll.lat) } }, "Lieu déplacé");
        });
      });
    }
  });

  function ouvrirLieu(id) {
    editId = id;
    const p = id ? points().find(x => x.id === id) : { titre: "", chatellerie: "", ingredients: [], accord: false, accordTexte: "", note: "" };
    const f = $("#form-lieu");
    $("#f-lieu-titre").textContent = id ? "Modifier le lieu" : "Nouveau lieu de récolte";
    f.titre.value = p.titre || ""; f.chatellerie.innerHTML = optCh(p.chatellerie); f.accord.checked = !!p.accord;
    f.accordTexte.value = p.accordTexte || ""; f.note.value = p.note || ""; $("#f-lieu-filtre").value = "";
    const sel = new Set(p.ingredients || []);
    $("#f-lieu-ing").innerHTML = INGREDIENTS.map(i => `<label data-n="${esc(norm(i.nom))}"><input type="checkbox" value="${i.id}" ${sel.has(i.id) ? "checked" : ""}>${esc(i.nom)}</label>`).join("");
    if (carte) carte.closePopup();
    ouvrirF("#f-lieu");
  }
  $("#f-lieu-filtre").addEventListener("input", e => {
    const q = norm(e.target.value);
    $$("#f-lieu-ing label").forEach(l => l.hidden = q && !l.dataset.n.includes(q));
  });
  $("#form-lieu").onsubmit = e => {
    e.preventDefault(); const f = e.target;
    const o = { titre: f.titre.value.trim(), chatellerie: f.chatellerie.value, accord: f.accord.checked, accordTexte: f.accordTexte.value.trim(), note: f.note.value.trim(),
      ingredients: $$("#f-lieu-ing input:checked").map(x => x.value) };
    let id = editId;
    if (!id) { id = "lieu-" + Date.now().toString(36); Object.assign(o, posAjout, { auteur: session.nom }); }
    enregistrer("carte", { [id]: o }, editId ? "Lieu modifié" : "Lieu ajouté");
    fermerF();
  };

  /* =================================================================
     ACCORDS COMMERCIAUX
     ================================================================= */
  // Accords : les employés PROPOSENT (statut « propose ») ; Elvara, Amaury et Edmond valident
  const STATUT = { propose: "Proposé — à valider", actif: "Actif", negociation: "En négociation", suspendu: "Suspendu", expire: "Expiré", refuse: "Refusé" };
  let accordId = null;
  function renderAccords() {
    const f = $("#a-filtre").value;
    const rang = a => a.statut === "propose" ? 0 : 1;
    const l = accords().filter(a => !f || a.statut === f).sort((a, b) => rang(a) - rang(b) || (a.partenaire || "").localeCompare(b.partenaire || ""));
    $("#a-aide").textContent = responsable() ? "Les accords proposés par l'équipe attendent votre validation." : "Vous pouvez proposer un accord : Elvara, Amaury ou Edmond le valideront.";
    $("#accords").innerHTML = l.length ? l.map(a => `
      <article class="accord-carte cadre">
        <span class="statut ${a.statut}">${STATUT[a.statut] || ""}</span>
        <h3>${esc(a.partenaire)}</h3>
        <div class="lieu">${esc([a.type, a.lieu, a.chatellerie].filter(Boolean).join(" · "))}</div>
        <dl>
          ${a.produits ? `<dt>Produits</dt><dd>${esc(a.produits)}</dd>` : ""}
          ${a.conditions ? `<dt>Conditions</dt><dd>${esc(a.conditions)}</dd>` : ""}
          ${a.debut || a.fin ? `<dt>Durée</dt><dd>${esc([a.debut && "depuis le " + a.debut, a.fin && "jusqu'au " + a.fin].filter(Boolean).join(", "))}</dd>` : ""}
          ${a.contact ? `<dt>Contact</dt><dd>${esc(a.contact)}</dd>` : ""}
        </dl>
        ${a.proposePar || a.validePar ? `<p class="accord-qui">${a.proposePar ? "Proposé par " + esc(a.proposePar) : ""}${a.proposePar && a.validePar ? " · " : ""}${a.validePar ? (a.statut === "refuse" ? "refusé" : "validé") + " par " + esc(a.validePar) : ""}</p>` : ""}
        <div class="actions">${responsable() && a.statut === "propose" ? `<button class="btn btn-petit" type="button" data-ac-valider="${a.id}">Valider</button><button class="btn-sobre btn-petit" type="button" data-ac-refuser="${a.id}">Refuser</button>` : ""}<button class="btn-sobre btn-petit" type="button" data-ac-copier="${a.id}" title="Copier l'accord pour le coller sur Discord">Copier pour Discord</button>${responsable() ? `<button class="btn-sobre btn-petit" type="button" data-ac-edit="${a.id}">Modifier</button><button class="btn-sobre btn-petit" type="button" data-ac-del="${a.id}">Supprimer</button>` : ""}</div>
      </article>`).join("")
      : `<p class="vide">${f ? "Aucun accord dans cette catégorie." : "Aucun accord pour le moment." + (responsable() ? " Ajoutez le premier avec « Nouvel accord »." : " Proposez-en un avec « Proposer un accord ».")}</p>`;
  }
  $("#a-filtre").onchange = renderAccords;
  function ouvrirAccord(id) {
    accordId = id;
    const a = id ? D.accords[id] : { statut: responsable() ? "negociation" : "propose", type: "Fournisseur" };
    const f = $("#form-accord");
    $("#f-accord-titre").textContent = id ? "Modifier l'accord" : responsable() ? "Nouvel accord commercial" : "Proposer un accord commercial";
    $("#f-accord-statut").hidden = !responsable();
    f.chatellerie.innerHTML = optCh(a.chatellerie);
    ["partenaire", "lieu", "type", "statut", "produits", "conditions", "debut", "fin", "contact"].forEach(k => { if (f[k]) f[k].value = a[k] || (k === "statut" ? "negociation" : k === "type" ? "Fournisseur" : ""); });
    ouvrirF("#f-accord");
  }
  $("#a-ajouter").onclick = () => ouvrirAccord(null);
  $("#form-accord").onsubmit = e => {
    e.preventDefault(); const f = e.target, o = {};
    ["partenaire", "lieu", "chatellerie", "type", "statut", "produits", "conditions", "debut", "fin", "contact"].forEach(k => o[k] = f[k].value.trim());
    fermerF();
    if (!responsable()) { proposerAccord(o); return; }
    const avant = accordId && D.accords[accordId];
    if (avant && avant.statut === "propose" && o.statut !== "propose") Object.assign(o, { validePar: session.nom });
    enregistrer("accords", { [accordId || "accord-" + Date.now().toString(36)]: o }, accordId ? "Accord modifié" : "Accord ajouté");
  };
  // Employé : la proposition passe par le serveur (statut « propose » imposé)
  async function proposerAccord(o) {
    delete o.statut;
    D.accords["tmp-" + Date.now().toString(36)] = Object.assign({ statut: "propose", proposePar: session.nom }, o);
    renderTout(); enCours++; renderSync();
    try { const r = await appel({ action: "proposer", mdp: session.mdp, nom: session.nom, accord: o }); enCours--; if (!enCours) accepter(r); renderTout(); toast("Accord proposé : Elvara, Amaury ou Edmond doivent le valider"); }
    catch (err) { enCours--; toast((err.message || "Échec") + " — proposition non enregistrée.", true); charger(true); }
  }
  // Texte prêt à coller sur Discord (mise en forme Markdown de Discord)
  const fmtDateCourte = d => { const x = new Date(d + "T12:00:00"); return isNaN(x) ? d : x.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); };
  function texteDiscord(a) {
    const l = [`📜 **Accord commercial — ${BOUTIQUE.nom}**`, `**Partenaire :** ${a.partenaire || "—"}`];
    if (a.type) l.push(`**Type :** ${a.type}`);
    if (a.lieu || a.chatellerie) l.push(`**Lieu :** ${[a.lieu, a.chatellerie].filter(Boolean).join(", ")}`);
    l.push(`**Statut :** ${STATUT[a.statut] || a.statut || "—"}`);
    if (a.produits) l.push(`**Produits :** ${a.produits}`);
    if (a.conditions) l.push(`**Conditions :** ${a.conditions}`);
    if (a.debut || a.fin) l.push(`**Durée :** ${[a.debut && "du " + fmtDateCourte(a.debut), a.fin && "au " + fmtDateCourte(a.fin)].filter(Boolean).join(" ")}`);
    if (a.contact) l.push(`**Contact :** ${a.contact}`);
    l.push(`*${BOUTIQUE.nom} · ${BOUTIQUE.lieu}*`);
    return l.join("\n");
  }
  async function copier(txt) {
    try { await navigator.clipboard.writeText(txt); return true; }
    catch (e) { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; }
  }
  document.addEventListener("click", async e => {
    const cp = e.target.closest("[data-ac-copier]");
    if (cp) { const a = D.accords[cp.dataset.acCopier]; if (!a) return; const ok = await copier(texteDiscord(a)); toast(ok ? "Accord copié : collez-le sur Discord (Ctrl+V)" : "Impossible de copier", !ok); return; }
    const ed = e.target.closest("[data-ac-edit]"); if (ed) { ouvrirAccord(ed.dataset.acEdit); return; }
    const va = e.target.closest("[data-ac-valider]");
    if (va) { enregistrer("accords", { [va.dataset.acValider]: { statut: "actif", validePar: session.nom } }, "Accord validé"); return; }
    const rf = e.target.closest("[data-ac-refuser]");
    if (rf && confirm("Refuser cet accord ?")) { enregistrer("accords", { [rf.dataset.acRefuser]: { statut: "refuse", validePar: session.nom } }, "Accord refusé"); return; }
    const del = e.target.closest("[data-ac-del]");
    if (del && confirm("Supprimer l'accord avec « " + (D.accords[del.dataset.acDel] || {}).partenaire + " » ?")) enregistrer("accords", { [del.dataset.acDel]: null }, "Accord supprimé");
  });

  /* =================================================================
     TRÉSORERIE — ventes et achats, séparés entre alchimie et cuisine
     ================================================================= */
  const aujourdhui = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const ventes = () => Object.keys(D.ventes || {}).map(id => Object.assign({ id }, D.ventes[id]));
  const achats = () => Object.keys(D.achats || {}).map(id => Object.assign({ id }, D.achats[id]));
  const mouvements = sens => Object.keys(D.mouvements || {}).map(id => Object.assign({ id }, D.mouvements[id])).filter(m => m.sens === sens);
  // Partie d'une vente ou d'un achat (enregistrée ; sinon déduite de l'article)
  const domaineMouv = m => m.domaine || (m.type === "ingredient" ? (byIng[m.article] && byIng[m.article].cuisine ? "cuisine" : "alchimie") : (estPlat(m.article) ? "cuisine" : "alchimie"));
  const totalJour = j => ventes().filter(v => v.date === j && (!monDomaine() || domaineMouv(v) === monDomaine())).reduce((a, v) => a + (v.qte || 0) * (v.prix || 0), 0);
  const article = v => v.type === "ingredient" ? byIng[v.article] : byPot[v.article];
  const nomArticle = v => (article(v) || {}).nom || v.nomArticle || v.article;
  const enArticle = v => (article(v) || {}).en || "";
  const imgArticle = v => v.type === "ingredient" ? `images/ingredients/${v.article}.webp` : (byPot[v.article] ? `images/potions/${byPot[v.article].img}` : "");
  const typeVente = v => {
    if (v.type === "ingredient") return "Ingrédient";
    const c = (byPot[v.article] || {}).categorie;
    return c === "Nourriture" ? "Nourriture" : c === "Breuvages" ? "Breuvage" : "Potion";
  };
  const fmtJour = j => { const d = new Date(j + "T12:00:00"); return isNaN(d) ? j : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
  const fmtMois = m => { const d = new Date(m + "-01T12:00:00"); return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); };

  // Parts d'une vente (septims entiers, arrondis en dessous) : vendeur 50 %,
  // responsable de la partie 18 % (Elvara / Edmond), Fiole ou Marmite 18 %,
  // l'Eau Noire le reste (12 % + 2 % + arrondis).
  const cts = n => Math.round(n * 100);
  const sept = (c, t) => Math.floor(c * t / 10000) * 100;
  function parts(total) {
    const c = cts(total), v = sept(c, TAUX.vendeur), g = sept(c, TAUX.responsable), b = sept(c, TAUX.boutique);
    return { total: c / 100, vendeur: v / 100, gerante: g / 100, boutique: b / 100, forge: (c - v - g - b) / 100 };
  }
  const LIB = d => PARTAGE[d === "cuisine" ? "cuisine" : "alchimie"];
  const totalVente = v => (v.qte || 0) * (v.prix || 0);
  const cumul = a => a.reduce((s, v) => { const p = parts(totalVente(v));
    s.total += p.total; s.vendeur += p.vendeur; s.gerante += p.gerante; s.boutique += p.boutique; s.forge += p.forge; s.n += (v.qte || 0); return s; },
    { total: 0, vendeur: 0, gerante: 0, boutique: 0, forge: 0, n: 0 });
  // Trésorerie d'une partie : sa part (18 %) de toutes ses ventes, moins tous ses achats
  const tresorDe = d => Math.round((cumul(ventes().filter(v => domaineMouv(v) === d)).boutique - somme(achats().filter(a => domaineMouv(a) === d))) * 100) / 100;
  const lundi = j => { const d = new Date(j + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const fmtSemaine = l => { const a = new Date(l + "T12:00:00"), b = new Date(a); b.setDate(a.getDate() + 6);
    const o = { day: "numeric", month: "long" };
    return "Semaine du lundi " + a.toLocaleDateString("fr-FR", o) + " au dimanche " + b.toLocaleDateString("fr-FR", Object.assign({ year: "numeric" }, o)); };
  const partsHTML = (c, titre) => `<div class="parts">
      <div class="part total"><span>${titre}</span><strong>${nb(c.total)} ${M}</strong></div>
      <div class="part vendeur"><span>${esc(PARTAGE.vendeur)}s · ${TAUX.vendeur} %</span><strong>${nb(c.vendeur)}</strong></div>
      <div class="part gerante"><span>${esc(LIB(tresorDom).responsable)} · ${TAUX.responsable} %</span><strong>${nb(c.gerante)}</strong></div>
      <div class="part boutique"><span>${esc(LIB(tresorDom).boutique)} · ${TAUX.boutique} %</span><strong>${nb(c.boutique)}</strong></div>
      <div class="part forge"><span>${esc(PARTAGE.forge)} · ${TAUX.forge} %</span><strong>${nb(c.forge)}</strong></div>
    </div>`;
  const parVendeur = a => { const o = {}; a.forEach(v => { const k = v.vendeur || "—"; o[k] = (o[k] || 0) + parts(totalVente(v)).vendeur; });
    return Object.entries(o).sort((x, y) => y[1] - x[1]); };


  const totalAchat = a => Math.round((a.qte || 0) * (a.prix || 0) * 100) / 100;
  const somme = l => l.reduce((s, a) => s + totalAchat(a), 0);
  let tresorDom = "alchimie", tresorVue = "ventes", tresorQui = null, vueOffre = "ouverte";
  // Ventes, ajouts et retraits : chacun dans SON onglet (Elvara/Amaury en alchimie, Edmond en cuisine, employés partout)
  // Les employés (Belrand, Askaal, Aldéric) travaillent pour la Fiole (alchimie)
  const peutVendre = d => !!session && (responsable() || d === "alchimie");
  const estMoi = qui => !!session && norm(qui) === norm(session.nom);
  const peutSupprimer = () => responsable();
  const peutOffrir = () => responsable();   // offres d'achat : Elvara / Amaury (alchimie), Edmond (cuisine)
  const nomLigne = m => `${esc(nomArticle(m))}${enArticle(m) ? ` <span class="en">${esc(enArticle(m))}</span>` : ""}`;
  const offres = () => Object.keys(D.offres || {}).map(id => Object.assign({ id }, D.offres[id]));
  const totalOffre = o => Math.round((o.lignes || []).reduce((s, l) => s + (l.qte || 0) * (l.prix || 0), 0) * 100) / 100;
  const STATUT_OFFRE = { ouverte: "Ouverte", "en-cours": "En cours", validee: "Validée" };
  const ROLE_LIB = { gerante: "Alchimie", cuisinier: "Cuisine", employe: "Employé" };
  // Personnes d'une trésorerie : l'équipe de cette partie, plus toute personne ayant déjà vendu
  function personnes(d, V, Mt) {
    // Fiole : les responsables et les employés ; Marmite : les responsables
    const l = EQUIPE.filter(p => d === "cuisine" ? p.role !== "employe" : true).map(p => p.nom);
    const plus = [...V.map(v => v.vendeur), ...Mt.map(m => m.par)];
    if (session && peutVendre(d)) plus.push(session.nom);
    plus.filter(Boolean).forEach(n => { if (!l.some(x => norm(x) === norm(n))) l.push(n); });
    return l;
  }
  const roleDe = n => (EQUIPE.find(p => norm(p.nom) === norm(n)) || {}).role;
  const dans = (x, n) => norm(x || "") === norm(n);

  function renderTresor() {
    const d = tresorDom, sup = peutSupprimer(d), qui = tresorQui;
    $("#t-titre").textContent = (d === "cuisine" ? "Trésorerie de la cuisine" : "Trésorerie de l'alchimie") + (qui === "ensemble" ? " — vue d'ensemble" : qui === "offres" ? " — offres d'achat" : qui ? " — " + qui : "");
    $("#panneau-tresor").classList.toggle("tresor-cuisine", d === "cuisine");
    const V = ventes().filter(v => domaineMouv(v) === d), A = achats().filter(a => domaineMouv(a) === d);
    const Mt = [...mouvements("ajout"), ...mouvements("retrait")].filter(x => domaineMouv(x) === d);
    const O = offres().filter(o => o.domaine === d);
    const gens = personnes(d, V, Mt);
    const auj = aujourdhui(), sem = lundi(auj), moisCourant = auj.slice(0, 7);
    const lisD = d === "cuisine" ? "lis-marmite" : "lis-fiole";
    const tresorBoutique = tresorDe(d), nomTresor = "Trésorerie " + (d === "cuisine" ? "de la Marmite" : "de la Fiole");
    const nOuv = O.filter(o => o.statut === "ouverte").length, nCours = O.filter(o => o.statut === "en-cours").length;
    // Rangée de sélection (toujours visible une fois un onglet choisi)
    const puce = n => n ? ` <span class="pastille">${n}</span>` : "";
    $("#t-qui").innerHTML = `<button type="button" class="retour" data-qui="" title="Revenir à la sélection">☰ Sélection</button>`
      + `<button type="button" class="special" data-qui="ensemble" aria-selected="${qui === "ensemble"}">Vue d'ensemble</button>`
      + `<button type="button" class="special" data-qui="offres" aria-selected="${qui === "offres"}">Offres d'achat${puce(peutOffrir(d) ? nCours : nOuv)}</button>`
      + gens.map(n => `<button type="button" data-qui="${esc(n)}" aria-selected="${qui === n}">${esc(n)}${estMoi(n) ? " ✎" : ""}</button>`).join("");
    $("#t-qui").hidden = !qui; $("#t-choix").hidden = !!qui; $("#t-contenu").hidden = !qui;
    $("#t-mois").hidden = $("#t-recherche").hidden = !qui;
    const moi = qui && qui !== "ensemble" && qui !== "offres" && estMoi(qui) && peutVendre(d);
    $("#t-vente").hidden = $("#t-ajout").hidden = $("#t-retrait").hidden = !moi;
    $("#t-offre").hidden = !(qui === "offres" && peutOffrir(d));

    if (!qui) {
      // Écran de sélection
      const vm = V.filter(v => (v.date || "").startsWith(moisCourant));
      $("#t-choix").innerHTML = `<p class="mute t-aide">Choisissez un onglet. Tout le monde peut consulter les ventes de chacun, mais seule la personne elle-même peut enregistrer des ventes dans son onglet.</p>
        <div class="t-cartes">
        <button type="button" class="t-carte cadre special lis ${lisD}" data-qui="ensemble"><b>Vue d'ensemble</b><span>${nb(cumul(vm).total)} ${M} de ventes — ${fmtMois(moisCourant)}</span><span class="${tresorBoutique < 0 ? "rouge" : ""}">${nomTresor} : ${nb(tresorBoutique)} ${M}</span></button>
        <button type="button" class="t-carte cadre special" data-qui="offres"><b>Offres d'achat</b><span>${nOuv} ouverte${nOuv > 1 ? "s" : ""} · ${nCours} en cours</span><span>${peutOffrir(d) ? "Créer et valider les achats" : "Accepter une offre pour faire l'achat"}</span></button>
        ${gens.map(n => { const c = cumul(vm.filter(v => dans(v.vendeur, n))); return `<button type="button" class="t-carte cadre lis lis-vendeur${estMoi(n) ? " moi" : ""}" data-qui="${esc(n)}"><b>${esc(n)}</b>${estMoi(n) ? `<em class="vous">Votre onglet</em>` : ""}<span>${esc(ROLE_LIB[roleDe(n)] || "")}</span><span>${nb(c.total)} ${M} vendus ce mois · garde ${nb(c.vendeur)}</span></button>`; }).join("")}
        </div>`;
      return;
    }
    const mois = [...new Set([...V, ...A, ...Mt, ...O.map(o => ({ date: (o.date || o.cree || "").slice(0, 10) }))].map(x => (x.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    const sel = $("#t-mois"), cur = sel.value;
    sel.innerHTML = `<option value="">Tous les mois</option>` + mois.map(m => `<option value="${m}">${fmtMois(m)}</option>`).join("");
    if (mois.includes(cur)) sel.value = cur;
    const m = sel.value, mots = norm($("#t-recherche").value).split(/\s+/).filter(Boolean);
    const garde = x => (!m || (x.date || "").startsWith(m)) && mots.every(w => norm(nomArticle(x) + " " + enArticle(x) + " " + (x.client || "") + " " + (x.vendeur || "") + " " + (x.fournisseur || "") + " " + (x.acheteur || "") + " " + (x.motif || "") + " " + (x.par || "")).includes(w));
    const mc = m || moisCourant;
    const vues = qui === "offres" ? [["ouverte", "Ouvertes", nOuv], ["en-cours", "En cours", nCours], ["validee", "Validées", 0]]
      : qui === "ensemble" ? [["ventes", "Ventes"], ["achats", "Achats"], ["ajouts", "Ajouts"], ["retraits", "Retraits"]]
      : [["ventes", "Ventes"], ["ajouts", "Ajouts"], ["retraits", "Retraits"]];
    if (qui !== "offres" && !vues.some(v => v[0] === tresorVue)) tresorVue = "ventes";
    const vc = qui === "offres" ? vueOffre : tresorVue;
    $("#t-vue").innerHTML = vues.map(([k, l, n]) => `<button type="button" data-vue="${k}" aria-selected="${vc === k}">${l}${n ? ` (${n})` : ""}</button>`).join("");

    if (qui === "offres") {
      $("#t-aide").textContent = peutOffrir(d)
        ? "Créez une offre d'achat ; un membre de l'équipe l'accepte (« en cours »), fait l'achat en jeu, puis vous la validez : l'achat est inscrit et le stock mis à jour."
        : "Acceptez une offre pour vous charger de l'achat en jeu, même si elle concerne " + (d === "cuisine" ? "la Marmite" : "la Fiole") + ". Une fois fait, Elvara, Amaury ou Edmond la valide.";
      const gardeO = o => (!m || (o.date || o.cree || "").startsWith(m)) && mots.every(w => norm((o.lignes || []).map(l => nomArticle(l) + " " + enArticle(l)).join(" ") + " " + (o.fournisseur || "") + " " + (o.note || "") + " " + (o.preneur || "") + " " + (o.creePar || "")).includes(w));
      $("#t-resume").innerHTML = `
        <div class="bloc cadre"><strong>${nOuv}</strong><span>offre${nOuv > 1 ? "s" : ""} ouverte${nOuv > 1 ? "s" : ""}</span></div>
        <div class="bloc cadre ${nCours ? "bas" : ""}"><strong>${nCours}</strong><span>en cours (achat en jeu)</span></div>
        <div class="bloc cadre"><strong>${nb(somme(A.filter(a => (a.date || "").startsWith(mc))))}</strong><span>${M} d'achats — ${fmtMois(mc)}</span></div>
        <div class="bloc cadre tresor-boutique lis ${lisD} ${tresorBoutique < 0 ? "rupture" : ""}"><strong>${nb(tresorBoutique)}</strong><span>${M} — ${nomTresor.replace("Trésorerie", "trésorerie")}</span></div>`;
      $("#t-liste").innerHTML = listeOffres(O.filter(o => o.statut === vueOffre && gardeO(o)), d);
      return;
    }
    if (qui === "ensemble") {
      $("#t-aide").textContent = "Toutes les ventes de l'équipe. Pour enregistrer une vente, ouvrez votre propre onglet.";
      const vMois = cumul(V.filter(v => (v.date || "").startsWith(mc))).total, aMois = somme(A.filter(a => (a.date || "").startsWith(mc)));
      $("#t-resume").innerHTML = `
        <div class="bloc cadre"><strong>${nb(cumul(V.filter(v => v.date === auj)).total)}</strong><span>${M} de ventes aujourd'hui</span></div>
        <div class="bloc cadre"><strong>${nb(cumul(V.filter(v => v.date && lundi(v.date) === sem)).total)}</strong><span>${M} de ventes cette semaine</span></div>
        <div class="bloc cadre"><strong>${nb(vMois)}</strong><span>${M} de ventes — ${fmtMois(mc)}</span></div>
        <div class="bloc cadre"><strong>${nb(aMois)}</strong><span>${M} d'achats — ${fmtMois(mc)}</span></div>
        <div class="bloc cadre tresor-boutique lis ${lisD} ${tresorBoutique < 0 ? "rupture" : ""}" title="${TAUX.boutique} % de toutes les ventes de cette partie, moins tous ses achats (depuis le début)"><strong>${nb(tresorBoutique)}</strong><span>${M} — ${nomTresor.replace("Trésorerie", "trésorerie")}</span></div>`;
      if (tresorVue === "ventes") $("#t-liste").innerHTML = listeVentes(V.filter(garde), V.length, sup);
      else if (tresorVue === "achats") $("#t-liste").innerHTML = listeAchats(A.filter(garde), A.length, sup);
      else { const sens = tresorVue === "ajouts" ? "ajout" : "retrait", Mv = mouvements(sens).filter(x => domaineMouv(x) === d); $("#t-liste").innerHTML = listeMouvements(Mv.filter(garde), Mv.length, sup, sens); }
      return;
    }
    // Onglet d'une personne
    const Vp = V.filter(v => dans(v.vendeur, qui));
    $("#t-aide").innerHTML = moi ? "<b>Votre onglet</b> : enregistrez ici vos ventes, ajouts et retraits."
      : `Onglet de <b>${esc(qui)}</b> : consultation seule. Seul${roleDe(qui) === "gerante" && qui !== "Amaury" ? "e" : ""} ${esc(qui)} peut y enregistrer des ventes.`;
    const cm = cumul(Vp.filter(v => (v.date || "").startsWith(mc)));
    $("#t-resume").innerHTML = `
      <div class="bloc cadre"><strong>${nb(cumul(Vp.filter(v => v.date === auj)).total)}</strong><span>${M} vendus aujourd'hui</span></div>
      <div class="bloc cadre"><strong>${nb(cumul(Vp.filter(v => v.date && lundi(v.date) === sem)).total)}</strong><span>${M} vendus cette semaine</span></div>
      <div class="bloc cadre"><strong>${nb(cm.total)}</strong><span>${M} vendus — ${fmtMois(mc)}</span></div>
      <div class="bloc cadre lis lis-vendeur"><strong>${nb(cm.vendeur)}</strong><span>${M} gardés (${TAUX.vendeur} %) — ${fmtMois(mc)}</span></div>`;
    if (tresorVue === "ventes") $("#t-liste").innerHTML = listeVentes(Vp.filter(garde), Vp.length, sup);
    else { const sens = tresorVue === "ajouts" ? "ajout" : "retrait", Mv = mouvements(sens).filter(x => domaineMouv(x) === d && dans(x.par, qui)); $("#t-liste").innerHTML = listeMouvements(Mv.filter(garde), Mv.length, sup, sens); }
  }
  $("#t-mois").onchange = renderTresor;
  $("#t-recherche").addEventListener("input", renderTresor);
  $("#t-vue").addEventListener("click", e => { const b = e.target.closest("[data-vue]"); if (!b) return; if (tresorQui === "offres") vueOffre = b.dataset.vue; else tresorVue = b.dataset.vue; renderTresor(); });
  $("#panneau-tresor").addEventListener("click", e => {
    const b = e.target.closest("[data-qui]"); if (!b) return;
    tresorQui = b.dataset.qui || null; $("#t-recherche").value = ""; renderTresor();
  });

  // Offres d'achat : cartes avec leurs lignes et leurs actions
  function listeOffres(l, d) {
    if (!l.length) return `<p class="vide">${{ ouverte: "Aucune offre ouverte.", "en-cours": "Aucune offre en cours.", validee: "Aucune offre validée." }[vueOffre]}${vueOffre === "ouverte" && peutOffrir(d) ? " Créez-en une avec « + Offre d'achat »." : ""}</p>`;
    const quand = x => x ? new Date(x).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="offres">${l.sort((a, b) => (b.cree || "").localeCompare(a.cree || "")).map(o => {
      const resp = peutOffrir(d), lui = o.preneur && estMoi(o.preneur);
      const act = [];
      if (o.statut === "ouverte" && session) act.push(`<button class="btn btn-petit" type="button" data-offre-act="prendre" data-id="${o.id}">Accepter l'offre</button>`);
      if (o.statut === "en-cours" && resp) act.push(`<button class="btn btn-petit" type="button" data-offre-act="valider" data-id="${o.id}">Valider l'achat</button>`);
      if (o.statut === "en-cours" && (resp || lui)) act.push(`<button class="btn-sobre btn-petit" type="button" data-offre-act="lacher" data-id="${o.id}">${lui ? "Abandonner" : "Remettre ouverte"}</button>`);
      if (resp) act.push(`<button class="btn-sobre btn-petit" type="button" data-offre-del="${o.id}">Supprimer</button>`);
      return `<article class="offre cadre ${o.statut}">
        <div class="offre-tete"><span class="statut ${o.statut}">${STATUT_OFFRE[o.statut] || o.statut}</span><b>${nb(totalOffre(o))} ${M}</b></div>
        <table class="offre-lignes">${(o.lignes || []).map(x => `<tr><td class="ic">${icone(x)}</td><td>${nomLigne(x)}</td><td class="num">×${nb(x.qte)}</td><td class="num">${nb(x.prix)}</td><td class="num"><b>${nb(totalAchat(x))}</b></td></tr>`).join("")}</table>
        ${o.fournisseur || o.note ? `<p class="offre-info">${o.fournisseur ? `<span>Fournisseur : <b>${esc(o.fournisseur)}</b></span>` : ""}${o.note ? `<span>${esc(o.note)}</span>` : ""}</p>` : ""}
        <p class="offre-suivi">Créée par ${esc(o.creePar || "—")} le ${quand(o.cree)}${o.preneur ? ` · <b>prise par ${esc(o.preneur)}</b> le ${quand(o.prisLe)}` : ""}${o.validePar ? ` · validée par ${esc(o.validePar)} le ${quand(o.valideLe)}` : ""}</p>
        ${act.length ? `<div class="actions">${act.join("")}</div>` : ""}
      </article>`; }).join("")}</div>`;
  }
  document.addEventListener("click", async e => {
    const del = e.target.closest("[data-offre-del]");
    if (del && confirm("Supprimer cette offre d'achat ?" + ((D.offres[del.dataset.offreDel] || {}).statut === "validee" ? " (l'achat déjà inscrit reste dans la trésorerie)" : ""))) { enregistrer("offres", { [del.dataset.offreDel]: null }, "Offre supprimée"); return; }
    const b = e.target.closest("[data-offre-act]"); if (!b) return;
    const act = b.dataset.offreAct, id = b.dataset.id;
    if (act === "valider" && !confirm("Valider cet achat ? Il sera inscrit dans la trésorerie et les quantités ajoutées au stock.")) return;
    if (act === "lacher" && !confirm("Remettre cette offre à disposition de l'équipe ?")) return;
    enCours++; renderSync(); b.disabled = true;
    try {
      const r = await appel({ action: act, mdp: session.mdp, nom: session.nom, offre: id, date: aujourdhui() });
      enCours--; if (!enCours) accepter(r);
      if (act === "prendre") vueOffre = "en-cours"; if (act === "valider") vueOffre = "validee"; if (act === "lacher") vueOffre = "ouverte";
      renderTout();
      toast({ prendre: "Offre acceptée : elle est à vous, faites l'achat en jeu", lacher: "Offre remise à disposition", valider: "Achat validé : inscrit et ajouté au stock" }[act]);
    } catch (err) { enCours--; toast(err.message || "Échec", true); charger(true); }
  });

  function parSemaines(l, jourHTML, teteSemaine) {
    const semaines = [...new Set(l.filter(x => x.date).map(x => lundi(x.date)))].sort().reverse();
    return semaines.map(s => {
      const ls = l.filter(x => x.date && lundi(x.date) === s);
      const jours = [...new Set(ls.map(x => x.date))].sort().reverse();
      return `<section class="semaine">${teteSemaine(s, ls)}${jours.map(j => jourHTML(j, ls.filter(x => x.date === j).sort((a, b) => (a.cree || "").localeCompare(b.cree || "")))).join("")}</section>`;
    }).join("");
  }
  // Regroupe les lignes d'une journée par personne (vendeur, acheteur…)
  function parPersonne(l, cle) {
    const o = new Map();
    l.forEach(x => { const k = x[cle] || "—"; if (!o.has(k)) o.set(k, []); o.get(k).push(x); });
    return [...o.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  }
  const detailLigne = m => `${typeVente(m)}${m.reserve === "edmond" ? " · stock d'Edmond" : m.type === "nourriture" ? " · stock de l'Eau Noire" : ""}`;
  const icone = m => imgArticle(m) ? `<img src="${imgArticle(m)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : "";
  function listeVentes(l, n, sup) {
    if (!l.length) return `<p class="vide">${n ? "Aucune vente pour cette sélection." : "Aucune vente enregistrée pour le moment."}</p>`;
    const nc = 9 + (sup ? 1 : 0);
    return parSemaines(l, (j, lj) => { const cj = cumul(lj); return `<div class="jour">
      <div class="jour-tete"><h4>${esc(fmtJour(j))}</h4><span class="jour-total">Total du jour : <b>${nb(cj.total)} ${M}</b> · ${esc(LIB(tresorDom).boutique)} ${nb(cj.boutique)}</span></div>
      <div class="table-wrap"><table class="registre ventes">
        <thead><tr><th class="ic"></th><th>Article</th><th class="num">Qté</th><th class="num">Prix u.</th><th class="num">Total</th><th class="num p-vendeur">${esc(PARTAGE.vendeur)}<small>${TAUX.vendeur} %</small></th><th class="num p-gerante">${esc(LIB(tresorDom).responsable)}<small>${TAUX.responsable} %</small></th><th class="num p-boutique">${esc(LIB(tresorDom).boutique)}<small>${TAUX.boutique} %</small></th><th class="num p-forge">${esc(PARTAGE.forge)}<small>${TAUX.forge} %</small></th>${sup ? "<th></th>" : ""}</tr></thead>
        ${parPersonne(lj, "vendeur").map(([nom, lp]) => { const cp = cumul(lp); return `<tbody class="groupe">
          <tr class="sous-tete"><td colspan="${nc}"><span class="qui">${esc(nom)}</span> · ${lp.length} vente${lp.length > 1 ? "s" : ""} · ${nb(cp.total)} ${M} · garde <b>${nb(cp.vendeur)} ${M}</b></td></tr>
          ${lp.map(v => { const p = parts(totalVente(v)); return `<tr>
          <td class="ic">${icone(v)}</td>
          <td class="nom">${nomLigne(v)}<small>${detailLigne(v)}${v.client ? " · client : " + esc(v.client) : ""}</small></td>
          <td class="num">${nb(v.qte)}</td><td class="num">${nb(v.prix)}</td><td class="num"><b>${nb(p.total)}</b></td>
          <td class="num p-vendeur">${nb(p.vendeur)}</td><td class="num p-gerante">${nb(p.gerante)}</td><td class="num p-boutique">${nb(p.boutique)}</td><td class="num p-forge">${nb(p.forge)}</td>
          ${sup ? `<td class="actions-ligne"><button class="btn-sobre btn-petit" type="button" data-vente-edit="${v.id}" title="Modifier cette vente">✎</button><button class="btn-sobre btn-petit" type="button" data-vente-del="${v.id}" title="Supprimer cette vente">✕</button></td>` : ""}</tr>`; }).join("")}</tbody>`; }).join("")}
        <tfoot><tr><td></td><td>Total du jour</td><td class="num">${nb(cj.n)}</td><td></td><td class="num"><b>${nb(cj.total)}</b></td>
          <td class="num p-vendeur"><b>${nb(cj.vendeur)}</b></td><td class="num p-gerante"><b>${nb(cj.gerante)}</b></td><td class="num p-boutique"><b>${nb(cj.boutique)}</b></td><td class="num p-forge"><b>${nb(cj.forge)}</b></td>${sup ? "<td></td>" : ""}</tr></tfoot>
      </table></div></div>`; },
    (s, ls) => `<div class="semaine-tete"><h3>${esc(fmtSemaine(s))}</h3>
        <p class="semaine-vendeurs">${parVendeur(ls).map(([nm, x]) => `<span>${esc(nm)} : <b>${nb(x)} ${M}</b></span>`).join("")}</p></div>
      ${partsHTML(cumul(ls), "Ventes de la semaine")}`);
  }
  function listeAchats(l, n, sup) {
    if (!l.length) return `<p class="vide">${n ? "Aucun achat pour cette sélection." : "Aucun achat enregistré pour le moment."}</p>`;
    const nc = 6 + (sup ? 1 : 0);
    return parSemaines(l, (j, lj) => `<div class="jour"><div class="jour-tete"><h4>${esc(fmtJour(j))}</h4><span class="jour-total">Achats du jour : <b>${nb(somme(lj))} ${M}</b></span></div>
      <div class="table-wrap"><table class="registre achats">
        <thead><tr><th class="ic"></th><th>Article</th><th class="num">Qté</th><th class="num">Prix u.</th><th class="num">Total</th><th>Fournisseur</th>${sup ? "<th></th>" : ""}</tr></thead>
        ${parPersonne(lj, "acheteur").map(([nom, lp]) => `<tbody class="groupe">
          <tr class="sous-tete"><td colspan="${nc}"><span class="qui">${esc(nom)}</span> · ${lp.length} achat${lp.length > 1 ? "s" : ""} · <b>${nb(somme(lp))} ${M}</b></td></tr>
          ${lp.map(a => `<tr>
          <td class="ic">${icone(a)}</td>
          <td class="nom">${nomLigne(a)}<small>${detailLigne(a)}</small></td>
          <td class="num">${nb(a.qte)}</td><td class="num">${nb(a.prix)}</td><td class="num"><b>${nb(totalAchat(a))}</b></td>
          <td>${esc(a.fournisseur || "")}</td>
          ${sup ? `<td><button class="btn-sobre btn-petit" type="button" data-achat-del="${a.id}" title="Supprimer cet achat">✕</button></td>` : ""}</tr>`).join("")}</tbody>`).join("")}
        <tfoot><tr><td></td><td>Total du jour</td><td class="num">${nb(lj.reduce((s, a) => s + (a.qte || 0), 0))}</td><td></td><td class="num"><b>${nb(somme(lj))}</b></td><td></td>${sup ? "<td></td>" : ""}</tr></tfoot>
      </table></div></div>`,
    (s, ls) => `<div class="semaine-tete"><h3>${esc(fmtSemaine(s))}</h3><p class="semaine-vendeurs">${parPersonne(ls, "acheteur").map(([nm, x]) => `<span>${esc(nm)} : <b>${nb(somme(x))} ${M}</b></span>`).join("")}<span>Total : <b>${nb(somme(ls))} ${M}</b></span></p></div>`);
  }
  function listeMouvements(l, n, sup, sens) {
    const ajout = sens === "ajout", mot = ajout ? "ajout" : "retrait";
    if (!l.length) return `<p class="vide">${n ? "Aucun " + mot + " pour cette sélection." : "Aucun " + mot + " enregistré pour le moment."} ${ajout ? "(récoltes, fabrications… ajoutées au stock)" : "(pertes, ingrédients utilisés… retirés du stock)"}</p>`;
    const qte = x => x.reduce((s, a) => s + (a.qte || 0), 0), sg = ajout ? "+" : "−", nc = 4 + (sup ? 1 : 0);
    return parSemaines(l, (j, lj) => `<div class="jour"><div class="jour-tete"><h4>${esc(fmtJour(j))}</h4><span class="jour-total">${ajout ? "Ajoutés" : "Retirés"} ce jour : <b>${nb(qte(lj))}</b> article(s)</span></div>
      <div class="table-wrap"><table class="registre mouvements">
        <thead><tr><th class="ic"></th><th>Article</th><th class="num">Qté</th><th>Motif</th>${sup ? "<th></th>" : ""}</tr></thead>
        ${parPersonne(lj, "par").map(([nom, lp]) => `<tbody class="groupe">
          <tr class="sous-tete"><td colspan="${nc}"><span class="qui">${esc(nom)}</span> · <b>${sg}${nb(qte(lp))}</b> article(s)</td></tr>
          ${lp.map(a => `<tr>
          <td class="ic">${icone(a)}</td>
          <td class="nom">${nomLigne(a)}<small>${detailLigne(a)}</small></td>
          <td class="num"><b class="${ajout ? "plus" : "moins"}">${sg}${nb(a.qte)}</b></td>
          <td>${esc(a.motif || "")}</td>
          ${sup ? `<td><button class="btn-sobre btn-petit" type="button" data-mvt-del="${a.id}" title="Supprimer cette ligne">✕</button></td>` : ""}</tr>`).join("")}</tbody>`).join("")}
        <tfoot><tr><td></td><td>Total du jour</td><td class="num"><b>${sg}${nb(qte(lj))}</b></td><td></td>${sup ? "<td></td>" : ""}</tr></tfoot>
      </table></div></div>`,
    (s, ls) => `<div class="semaine-tete"><h3>${esc(fmtSemaine(s))}</h3><p class="semaine-vendeurs">${parPersonne(ls, "par").map(([nm, x]) => `<span>${esc(nm)} : <b>${sg}${nb(qte(x))}</b></span>`).join("")}</p></div>`);
  }
  document.addEventListener("click", e => {
    const mv = e.target.closest("[data-mvt-del]");
    if (mv && confirm("Supprimer cette ligne ? (le stock n'est pas remis à jour)")) { enregistrer("mouvements", { [mv.dataset.mvtDel]: null }, "Ligne supprimée"); return; }
    const ve = e.target.closest("[data-vente-edit]"); if (ve) { ouvrirVenteEdit(ve.dataset.venteEdit); return; }
    const v = e.target.closest("[data-vente-del]");
    if (v && confirm("Supprimer cette vente ? (le stock n'est pas remis à jour)")) { enregistrer("ventes", { [v.dataset.venteDel]: null }, "Vente supprimée"); return; }
    const a = e.target.closest("[data-achat-del]");
    if (a && confirm("Supprimer cet achat ? (le stock n'est pas remis à jour)")) enregistrer("achats", { [a.dataset.achatDel]: null }, "Achat supprimé");
  });

  /* ---------- Modifier une vente (Elvara / Amaury : alchimie, Edmond : cuisine) ---------- */
  let venteEdit = null;
  function ouvrirVenteEdit(id) {
    const v = D.ventes[id]; if (!v) return;
    const dom = domaineMouv(v), f = $("#form-vente-edit");
    venteEdit = { id, dom };
    f.article.innerHTML = optionsMouv(dom);
    f.article.value = (v.type === "ingredient" ? "ingredient:" : "potion:") + v.article;
    const gens = personnes(dom, ventes().filter(x => domaineMouv(x) === dom), []);
    if (v.vendeur && !gens.includes(v.vendeur)) gens.push(v.vendeur);
    f.vendeur.innerHTML = gens.map(n => `<option>${esc(n)}</option>`).join("");
    f.vendeur.value = v.vendeur || gens[0];
    f.date.value = v.date || aujourdhui(); f.qte.value = v.qte || 1; f.prix.value = v.prix || 0; f.client.value = v.client || "";
    f.reserve.value = v.reserve === "edmond" ? "edmond" : "eau-noire"; f.stock.checked = true;
    majVenteEdit(); ouvrirF("#f-vente-edit");
  }
  function majVenteEdit() {
    const f = $("#form-vente-edit"), a = decoder(f.article.value);
    $("#f-ve-reserve").hidden = !(a && a.type === "nourriture");
    $("#f-ve-total").textContent = "Total : " + nb(Math.round((+f.qte.value || 0) * (+String(f.prix.value).replace(",", ".") || 0) * 100) / 100) + " " + M;
  }
  $("#form-vente-edit").addEventListener("input", majVenteEdit);
  $("#form-vente-edit").article.addEventListener("change", e => { e.target.form.prix.value = prixDe(e.target.value); majVenteEdit(); });
  $("#form-vente-edit").onsubmit = e => {
    e.preventDefault(); const f = e.target, avant = D.ventes[venteEdit.id], a = decoder(f.article.value);
    if (!avant || !a) return;
    const apres = { date: f.date.value, type: a.type, article: a.article, qte: Math.max(1, Math.round(+f.qte.value || 1)),
      prix: Math.max(0, Math.round((+String(f.prix.value).replace(",", ".") || 0) * 100) / 100), client: f.client.value.trim(), vendeur: f.vendeur.value,
      domaine: venteEdit.dom, reserve: a.type === "nourriture" ? f.reserve.value : null, modifiePar: session.nom };
    // Correction du stock : on rend l'ancienne quantité, on retire la nouvelle
    const stock = { potions: {}, ingredients: {} };
    if (f.stock.checked) {
      const bouger = (type, article, res, delta) => {
        const col = type === "ingredient" ? "ingredients" : "potions", ch = champStockDe(type, article, venteEdit.dom, res);
        const o = stock[col][article] || (stock[col][article] = {});
        if (o[ch] == null) o[ch] = +((type === "ingredient" ? ingV(article) : potV(article))[ch]) || 0;
        o[ch] = Math.max(0, o[ch] + delta);
      };
      bouger(avant.type, avant.article, avant.reserve, +avant.qte || 0);
      bouger(apres.type, apres.article, apres.reserve, -apres.qte);
    }
    fermerF();
    enregistrer("ventes", { [venteEdit.id]: apres }, "Vente modifiée");
    if (Object.keys(stock.potions).length) enregistrer("potions", stock.potions);
    if (Object.keys(stock.ingredients).length) enregistrer("ingredients", stock.ingredients);
  };

  /* ---------- Fenêtre « Nouvelle vente / Nouvel achat » à plusieurs lignes ---------- */
  let mouv = { genre: "vente", dom: "alchimie" };
  const libArt = x => esc(x.nom) + (x.en && x.en !== x.nom ? " — " + esc(x.en) : "");
  function optionsMouv(dom) {
    const tri = l => l.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    if (dom === "cuisine") {
      const fam = [...new Set(POTIONS.filter(p => estPlat(p.id)).map(p => p.famille))];
      return `<option value="">— Choisir —</option>` + fam.map(f => `<optgroup label="Plats — ${esc(f)}">${POTIONS.filter(p => estPlat(p.id) && p.famille === f).map(p => `<option value="potion:${p.id}">${libArt(p)}</option>`).join("")}</optgroup>`).join("")
        + `<optgroup label="Denrées de cuisine">${tri(INGREDIENTS.filter(i => i.cuisine || i.commun)).map(i => `<option value="ingredient:${i.id}">${libArt(i)}</option>`).join("")}</optgroup>`;
    }
    return `<option value="">— Choisir —</option>` + CATS.filter(c => c !== "Nourriture").map(c => `<optgroup label="${esc(c)}">${POTIONS.filter(p => p.categorie === c).map(p => `<option value="potion:${p.id}">${libArt(p)}${p.interdit ? " (interdit)" : ""}</option>`).join("")}</optgroup>`).join("")
      + `<optgroup label="Ingrédients d'alchimie">${tri(INGREDIENTS.filter(i => !i.cuisine)).map(i => `<option value="ingredient:${i.id}">${libArt(i)}${i.interdit ? " (interdit)" : ""}${i.dlc ? " (" + esc(i.dlc) + ")" : ""}</option>`).join("")}</optgroup>`;
  }
  const decoder = val => { const [k, id] = String(val || "").split(":"); return id ? { type: k === "ingredient" ? "ingredient" : (estPlat(id) ? "nourriture" : "potion"), article: id } : null; };
  const prixDe = (val, champ) => { const a = decoder(val); champ = champ || "prix"; return !a ? "" : (a.type === "ingredient" ? ingV(a.article) : potV(a.article))[champ]; };
  const prixMouv = val => prixDe(val, mouv.genre === "offre" || mouv.genre === "achat" ? "prixAchat" : "prix");
  let optsCache = {};
  function ajouterLigne() {
    const o = optsCache[mouv.dom] || (optsCache[mouv.dom] = optionsMouv(mouv.dom));
    const div = document.createElement("div"); div.className = "ligne-mouv";
    div.innerHTML = `<select class="champ" data-l="article" aria-label="Article">${o}</select>
      <input class="champ" type="number" min="1" value="1" data-l="qte" aria-label="Quantité">
      <input class="champ prix-fixe" type="number" min="0" step="any" data-l="prix" aria-label="Prix unitaire (fixé par le catalogue)" readonly tabindex="-1" title="Prix fixé dans l'onglet Potions / Ingrédients">
      <button class="btn-sobre btn-petit" type="button" data-l-suppr title="Retirer la ligne">✕</button>`;
    // Offre d'achat : prix de rachat proposé automatiquement, mais modifiable
    if (mouv.genre === "offre") { const pi = div.querySelector('[data-l="prix"]'); pi.readOnly = false; pi.tabIndex = 0; pi.classList.remove("prix-fixe"); pi.title = "Prix de rachat (modifiable)"; pi.setAttribute("aria-label", "Prix de rachat unitaire"); }
    $("#f-mouv-lignes").appendChild(div);
    div.querySelector("select").focus();
    majMouv();
  }
  function lignesMouv() {
    return $$("#f-mouv-lignes .ligne-mouv").map(l => {
      const a = decoder(l.querySelector('[data-l="article"]').value); if (!a) return null;
      return Object.assign(a, { qte: Math.max(1, Math.round(+l.querySelector('[data-l="qte"]').value || 1)),
        prix: Math.max(0, Math.round((+String(l.querySelector('[data-l="prix"]').value).replace(",", ".") || 0) * 100) / 100) });
    }).filter(Boolean);
  }
  function majMouv() {
    const l = lignesMouv(), tot = l.reduce((s, x) => s + x.qte * x.prix, 0);
    $("#f-mouv-reserve").hidden = !l.some(x => x.type === "nourriture");
    const sp = mouv.genre === "ajout" || mouv.genre === "retrait";
    $("#f-mouv-total").textContent = l.length ? `${l.length} ligne${l.length > 1 ? "s" : ""} · ${l.reduce((s, x) => s + x.qte, 0)} article(s)` + (sp ? "" : ` · Total : ${nb(Math.round(tot * 100) / 100)} ${M}`) : "Choisissez au moins un article.";
    $$("#f-mouv-lignes [data-l-suppr]").forEach(b => b.disabled = $$("#f-mouv-lignes .ligne-mouv").length < 2);
  }
  function ouvrirMouv(genre) {
    mouv = { genre, dom: tresorDom };
    const f = $("#form-mouv"); f.reset(); f.date.value = aujourdhui();
    const T = { vente: ["Nouvelle vente", "Client", "Retirer les quantités du stock", "Enregistrer la vente", "Facultatif"],
      achat: ["Nouvel achat", "Fournisseur", "Ajouter les quantités au stock", "Enregistrer l'achat", "Facultatif"],
      offre: ["Nouvelle offre d'achat", "Fournisseur", "", "Publier l'offre", "Où acheter (facultatif)"],
      ajout: ["Ajout au stock", "Motif", "", "Ajouter au stock", "Ex. : récolte, fabrication…"],
      retrait: ["Retrait du stock", "Motif", "", "Retirer du stock", "Ex. : perte, utilisé pour une potion…"] }[genre];
    $("#f-mouv-titre").textContent = T[0] + " — " + (mouv.dom === "cuisine" ? "cuisine" : "alchimie");
    $("#f-mouv-tiers").textContent = T[1]; f.tiers.placeholder = T[4];
    $("#f-mouv-stock").textContent = T[2]; $("#f-mouv-case").hidden = !T[2];
    $("#f-mouv-ok").textContent = T[3];
    $("#form-mouv").classList.toggle("sans-prix", genre === "ajout" || genre === "retrait");
    $("#f-mouv-prix-tete").textContent = genre === "offre" ? "Prix rachat" : "Prix u.";
    f.date.closest("label").hidden = genre === "offre"; $("#f-mouv-note").hidden = genre !== "offre";
    f.reserve.value = cuisinier() ? "edmond" : "eau-noire";
    $("#f-mouv-lignes").innerHTML = "";
    ouvrirF("#f-mouv"); ajouterLigne();
  }
  $("#t-vente").onclick = () => ouvrirMouv("vente");
  $("#t-offre").onclick = () => ouvrirMouv("offre");
  $("#t-ajout").onclick = () => ouvrirMouv("ajout");
  $("#t-retrait").onclick = () => ouvrirMouv("retrait");
  $("#f-mouv-plus").onclick = ajouterLigne;
  $("#f-mouv-lignes").addEventListener("change", e => {
    if (e.target.matches('[data-l="article"]')) e.target.closest(".ligne-mouv").querySelector('[data-l="prix"]').value = prixMouv(e.target.value);
    majMouv();
  });
  $("#f-mouv-lignes").addEventListener("input", majMouv);
  $("#f-mouv-lignes").addEventListener("click", e => { const b = e.target.closest("[data-l-suppr]"); if (b && !b.disabled) { b.closest(".ligne-mouv").remove(); majMouv(); } });
  $("#form-mouv").onsubmit = async e => {
    e.preventDefault(); const f = e.target, lignes = lignesMouv();
    if (!lignes.length) { toast("Choisissez au moins un article.", true); return; }
    const g = mouv.genre, mvt = g === "ajout" || g === "retrait", plus = g === "achat" || g === "ajout";
    if (g === "offre") { publierOffre(f, lignes); return; }
    const achat = g === "achat", dom = mouv.dom, stock = mvt || f.stock.checked, reserve = f.reserve.value;
    const corps = { action: { vente: "vendre", achat: "acheter", ajout: "ajouter", retrait: "retirer" }[g], mdp: session.mdp, nom: session.nom, domaine: dom, date: f.date.value, tiers: f.tiers.value.trim(), lignes, stock, reserve };
    fermerF();
    // Affichage immédiat, puis enregistrement par le serveur
    lignes.forEach((l, i) => {
      const rec = Object.assign({ date: corps.date, domaine: dom, cree: new Date().toISOString() }, l);
      if (mvt) Object.assign(rec, { sens: g, motif: corps.tiers, par: session.nom });
      else if (achat) Object.assign(rec, { fournisseur: corps.tiers, acheteur: session.nom }); else Object.assign(rec, { client: corps.tiers, vendeur: session.nom });
      if (l.type === "nourriture") rec.reserve = reserve;
      const nc = mvt ? "mouvements" : achat ? "achats" : "ventes";
      (D[nc] || (D[nc] = {}))["tmp-" + Date.now().toString(36) + i] = rec;
      if (stock) {
        const col = l.type === "ingredient" ? "ingredients" : "potions", ch = champStockDe(l.type, l.article, dom, reserve);
        const v = l.type === "ingredient" ? ingV(l.article) : potV(l.article);
        (D[col][l.article] || (D[col][l.article] = {}))[ch] = Math.max(0, (+v[ch] || 0) + (plus ? l.qte : -l.qte));
      }
    });
    tresorVue = { vente: "ventes", achat: "achats", ajout: "ajouts", retrait: "retraits" }[g];
    renderTout(); enCours++; renderSync();
    const tot = Math.round(lignes.reduce((s, x) => s + x.qte * x.prix, 0) * 100) / 100;
    try {
      const r = await appel(corps);
      enCours--; if (!enCours) accepter(r); renderTout();
      toast(mvt ? (g === "ajout" ? "Ajouté au stock : " : "Retiré du stock : ") + lignes.reduce((s, x) => s + x.qte, 0) + " article(s)"
        : (achat ? "Achat" : "Vente") + " enregistré" + (achat ? "" : "e") + " : " + lignes.length + " ligne(s), " + nb(tot) + " " + M);
    } catch (err) {
      enCours--; toast((err.message || "Échec de l'enregistrement") + " — rien n'a été enregistré.", true); charger(true);
    }
  };

  async function publierOffre(f, lignes) {
    const corps = { action: "offrir", mdp: session.mdp, nom: session.nom, domaine: mouv.dom, tiers: f.tiers.value.trim(), note: f.note.value.trim(), lignes, reserve: f.reserve.value };
    fermerF();
    D.offres["tmp-" + Date.now().toString(36)] = { domaine: corps.domaine, lignes, fournisseur: corps.tiers, note: corps.note, reserve: corps.reserve, statut: "ouverte", creePar: session.nom, cree: new Date().toISOString() };
    tresorQui = "offres"; vueOffre = "ouverte"; renderTout(); enCours++; renderSync();
    try { const r = await appel(corps); enCours--; if (!enCours) accepter(r); renderTout(); toast("Offre d'achat publiée : l'équipe peut l'accepter"); }
    catch (err) { enCours--; toast((err.message || "Échec") + " — offre non enregistrée.", true); charger(true); }
  }

  /* =================================================================
     STOCK DE L'EAU NOIRE (Elvara : potions, Edmond : plats)
     Collection « eaunoire » : stock-<article> {type:"stock", potion, qte, seuil}
     metier-<id> {type:"metier", nom, quotas:{article: n}}  (potions et plats)
     membre-<id> {type:"membre", nom, metiers:[ids]}
     remise-<id> {type:"remise", domaine, membre, semaine (lundi), date, lignes:{article: n}, par}
     ================================================================= */
  const EN = () => Object.keys(D.eaunoire || {}).map(id => Object.assign({ id }, D.eaunoire[id]));
  const enDe = t => EN().filter(x => x.type === t);
  const domArt = p => estPlat(p) ? "cuisine" : "alchimie";
  const enStock = dom => enDe("stock").filter(x => byPot[x.potion] && domArt(x.potion) === dom).sort((a, b) => byPot[a.potion].nom.localeCompare(byPot[b.potion].nom, "fr"));
  const enMetiers = () => enDe("metier").sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  const enMembres = () => enDe("membre").sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  const peutEN = () => responsable();   // Elvara : alchimie, Edmond : cuisine
  // Articles attribués chaque semaine à un membre = somme des quotas de ses métiers (dom : filtre facultatif)
  function attribution(m, dom) {
    const o = {}, mets = Object.fromEntries(enMetiers().map(x => [x.id, x]));
    (m.metiers || []).forEach(id => { const q = (mets[id] || {}).quotas || {}; Object.keys(q).forEach(p => { if (byPot[p] && (!dom || domArt(p) === dom) && +q[p] > 0) o[p] = (o[p] || 0) + (+q[p] || 0); }); });
    return o;
  }
  const somme0 = o => Object.values(o).reduce((t, n) => t + n, 0);
  const remiseDe = (m, sem, dom) => enDe("remise").find(r => r.membre === m.id && r.semaine === sem && (r.domaine || "alchimie") === dom);
  const potIcone = id => byPot[id] ? `<img src="images/potions/${byPot[id].img}" alt="" loading="lazy">` : "";
  const potNom = id => byPot[id] ? `${esc(byPot[id].nom)}${byPot[id].en ? ` <span class="en">${esc(byPot[id].en)}</span>` : ""}` : esc(id);
  const nvId = pre => pre + "-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const MOT = { alchimie: ["potion", "potions"], cuisine: ["plat", "plats"] };

  function tableStockEN(dom, besoin) {
    const S = enStock(dom), pe = peutEN(dom);
    const ids = [...new Set([...S.map(x => x.potion), ...Object.keys(besoin).filter(p => byPot[p] && domArt(p) === dom)])];
    if (!ids.length) return `<tbody><tr><td class="vide">Aucun${dom === "cuisine" ? " plat" : "e potion"} pour l'instant.${pe ? ` Ajoutez-en avec « + ${dom === "cuisine" ? "Plat" : "Potion"} ».` : ""}</td></tr></tbody>`;
    return `<thead><tr><th class="ic"></th><th>${dom === "cuisine" ? "Plat" : "Potion"}</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">Par sem.</th><th class="num">Semaines</th><th>État</th>${pe ? "<th></th>" : ""}</tr></thead>
      <tbody>${ids.map(p => { const x = S.find(y => y.potion === p) || { id: "stock-" + p, qte: 0, seuil: 0 }, q = +x.qte || 0, sl = +x.seuil || 0, b = besoin[p] || 0;
        const e = etat({ stock: q, seuil: sl }), manque = b > q;
        return `<tr>
          <td class="ic">${potIcone(p)}</td>
          <td class="nom">${potNom(p)}${byPot[p].interdit ? ` <span class="interdit-tag">Interdit</span>` : ""}</td>
          <td class="num">${pe ? `<div class="stock-edit"><button type="button" data-en-d="-1" data-en-p="${p}" aria-label="Retirer">−</button><input type="number" min="0" value="${q}" data-en-champ="qte" data-en-p="${p}" aria-label="Stock"><button type="button" data-en-d="1" data-en-p="${p}" aria-label="Ajouter">+</button></div>` : `<b>${nb(q)}</b>`}</td>
          <td class="num">${pe ? `<input class="prix-edit" type="number" min="0" value="${sl}" data-en-champ="seuil" data-en-p="${p}" aria-label="Seuil">` : nb(sl)}</td>
          <td class="num">${b ? nb(b) : `<span class="mute">—</span>`}</td>
          <td class="num ${manque ? "rouge" : ""}">${b ? nb(Math.floor(q / b)) : `<span class="mute">—</span>`}</td>
          <td><span class="etat ${manque ? "rupture" : e}">${manque ? "Insuffisant" : ETAT[e]}</span></td>
          ${pe ? `<td>${S.find(y => y.potion === p) ? `<button class="btn-sobre btn-petit" type="button" data-en-del="${x.id}" title="Retirer du stock de l'Eau Noire">✕</button>` : ""}</td>` : ""}</tr>`; }).join("")}</tbody>`;
  }

  function renderEauNoire() {
    if (!accesEN()) return;
    const Mt = enMetiers(), Mb = enMembres(), sem = lundi(aujourdhui());
    const besoin = {};
    Mb.forEach(m => { const a = attribution(m); Object.keys(a).forEach(p => besoin[p] = (besoin[p] || 0) + a[p]); });
    const tot = dom => enStock(dom).reduce((t, x) => t + (+x.qte || 0), 0);
    const totB = dom => Object.keys(besoin).filter(p => domArt(p) === dom).reduce((t, p) => t + besoin[p], 0);
    const bas = enDe("stock").filter(x => { const e = etat({ stock: +x.qte || 0, seuil: +x.seuil || 0 }); return e === "bas" || e === "rupture"; }).length;
    const servis = dom => Mb.filter(m => remiseDe(m, sem, dom) || !somme0(attribution(m, dom))).length;
    $("#en-ajout-potion").hidden = !peutEN("alchimie"); $("#en-ajout-plat").hidden = !peutEN("cuisine");
    $("#en-resume").innerHTML = `
      <div class="bloc cadre lis lis-fiole"><strong>${nb(tot("alchimie"))}</strong><span>potions en stock · ${nb(totB("alchimie"))} par semaine</span></div>
      <div class="bloc cadre lis lis-marmite"><strong>${nb(tot("cuisine"))}</strong><span>plats en stock · ${nb(totB("cuisine"))} par semaine</span></div>
      <div class="bloc cadre lis lis-forge"><strong>${Mb.length}</strong><span>membre${Mb.length > 1 ? "s" : ""} · ${Mt.length} métier${Mt.length > 1 ? "s" : ""}</span></div>
      <div class="bloc cadre"><strong>${servis("alchimie")} / ${Mb.length}</strong><span>servis en potions cette semaine</span></div>
      <div class="bloc cadre"><strong>${servis("cuisine")} / ${Mb.length}</strong><span>servis en plats cette semaine</span></div>
      <div class="bloc cadre ${bas ? "bas" : ""}"><strong>${bas}</strong><span>articles sous le seuil</span></div>`;
    $("#en-stock-alchimie").innerHTML = tableStockEN("alchimie", besoin);
    $("#en-stock-cuisine").innerHTML = tableStockEN("cuisine", besoin);
    // Métiers
    $("#en-metiers").innerHTML = Mt.length ? Mt.map(m => { const q = m.quotas || {}, n = Mb.filter(x => (x.metiers || []).includes(m.id)).length;
      const ligne = p => `<li class="${domArt(p)}">${potIcone(p)}<span>${potNom(p)}</span><b>×${nb(q[p])}</b></li>`;
      const lp = Object.keys(q).filter(p => byPot[p] && +q[p] > 0 && !estPlat(p)), lc = Object.keys(q).filter(p => byPot[p] && +q[p] > 0 && estPlat(p));
      return `<article class="en-metier cadre lis lis-forge">
        <div class="en-metier-tete"><b>${esc(m.nom)}</b><span class="mute">${n} membre${n > 1 ? "s" : ""}</span></div>
        ${lp.length ? `<p class="en-sous">Potions</p><ul>${lp.map(ligne).join("")}</ul>` : ""}
        ${lc.length ? `<p class="en-sous">Plats</p><ul>${lc.map(ligne).join("")}</ul>` : ""}
        ${!lp.length && !lc.length ? `<p class="mute" style="margin:0">Rien d'attribué</p>` : ""}
        <div class="actions"><button class="btn-sobre btn-petit" type="button" data-en-metier="${m.id}">Modifier</button><button class="btn-sobre btn-petit" type="button" data-en-del="${m.id}">Supprimer</button></div>
      </article>`; }).join("")
      : `<p class="vide">Aucun métier. Créez-en un avec « + Métier » et indiquez les potions et les plats attribués chaque semaine.</p>`;
    // Membres : personnes × articles attribués
    $("#en-semaine").textContent = "— " + fmtSemaine(sem).toLowerCase();
    const tri = (a, b) => byPot[a].nom.localeCompare(byPot[b].nom, "fr");
    const tous = [...new Set(Mb.flatMap(m => Object.keys(attribution(m))))];
    const cP = tous.filter(p => !estPlat(p)).sort(tri), cC = tous.filter(p => estPlat(p)).sort(tri), cols = [...cP, ...cC];
    const nomMet = Object.fromEntries(Mt.map(m => [m.id, m.nom]));
    const etatSem = (m, dom) => { const a = attribution(m, dom), t = somme0(a), r = remiseDe(m, sem, dom);
      if (r) return `<span class="etat ok" title="Remis par ${esc(r.par || "")}">${dom === "cuisine" ? "Plats remis" : "Potions remises"} le ${new Date(r.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>${peutEN(dom) ? ` <button class="btn-sobre btn-petit" type="button" data-en-annuler="${r.id}" title="Annuler (retour dans le stock)">↺</button>` : ""}`;
      if (!t) return "";
      return peutEN(dom) ? `<button class="btn-sobre btn-petit en-r-${dom}" type="button" data-en-remettre="${m.id}" data-en-dom="${dom}">Remettre ${nb(t)} ${MOT[dom][t > 1 ? 1 : 0]}</button>` : `<span class="mute">${nb(t)} ${MOT[dom][t > 1 ? 1 : 0]} à remettre</span>`; };
    $("#en-membres").innerHTML = Mb.length ? `<thead>
      ${cols.length ? `<tr class="en-groupes"><th colspan="2"></th>${cP.length ? `<th colspan="${cP.length}" class="g-alchimie">Potions</th>` : ""}${cC.length ? `<th colspan="${cC.length}" class="g-cuisine">Plats</th>` : ""}<th colspan="3"></th></tr>` : ""}
      <tr><th>Membre</th><th>Métier(s)</th>${cols.map(p => `<th class="num en-col ${domArt(p)}" title="${esc(byPot[p].nom)}">${potIcone(p)}<small>${esc(byPot[p].nom)}</small></th>`).join("")}<th class="num">Total</th><th>Cette semaine</th><th></th></tr></thead>
      <tbody>${Mb.map(m => { const a = attribution(m), done = ["alchimie", "cuisine"].every(d => remiseDe(m, sem, d) || !somme0(attribution(m, d)));
        return `<tr class="${done && somme0(a) ? "en-servi" : ""}">
          <td class="nom">${esc(m.nom)}</td>
          <td>${(m.metiers || []).map(id => nomMet[id]).filter(Boolean).map(esc).join(", ") || `<span class="mute">—</span>`}</td>
          ${cols.map(p => `<td class="num ${domArt(p)}">${a[p] ? nb(a[p]) : `<span class="mute">·</span>`}</td>`).join("")}
          <td class="num"><b>${nb(somme0(a))}</b></td>
          <td><div class="en-sem">${etatSem(m, "alchimie")}${etatSem(m, "cuisine")}</div></td>
          <td class="actions-ligne"><button class="btn-sobre btn-petit" type="button" data-en-membre="${m.id}" title="Modifier">✎</button><button class="btn-sobre btn-petit" type="button" data-en-del="${m.id}" title="Retirer de l'Eau Noire">✕</button></td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td colspan="2">Total par semaine</td>${cols.map(p => `<td class="num"><b>${nb(besoin[p] || 0)}</b></td>`).join("")}<td class="num"><b>${nb(somme0(besoin))}</b></td><td colspan="2"></td></tr></tfoot>`
      : `<tbody><tr><td class="vide">Aucun membre. Ajoutez les membres de l'Eau Noire avec « + Membre ».</td></tr></tbody>`;
    // Boutons du bas : remettre à tous les membres pas encore servis cette semaine
    ["alchimie", "cuisine"].forEach(dom => {
      const b = $(dom === "cuisine" ? "#en-remettre-plats" : "#en-remettre-potions"), reste = Mb.filter(m => !remiseDe(m, sem, dom) && somme0(attribution(m, dom)));
      b.hidden = !peutEN(dom); b.disabled = !reste.length;
      b.textContent = (dom === "cuisine" ? "Remettre les plats" : "Remettre les potions") + (reste.length ? " (" + reste.length + " membre" + (reste.length > 1 ? "s" : "") + ")" : " — tout est remis");
    });
  }

  // Liste des articles (potions hors nourriture / plats), objets interdits compris
  const optionsEN = dom => `<option value="">— Choisir —</option>` + (dom !== "cuisine" ? CATS.filter(c => c !== "Nourriture").map(c => `<optgroup label="${esc(c)}">${POTIONS.filter(p => p.categorie === c).map(p => `<option value="${p.id}">${libArt(p)}${p.interdit ? " (interdit)" : ""}</option>`).join("")}</optgroup>`).join("") : "")
    + (dom !== "alchimie" ? [...new Set(POTIONS.filter(p => estPlat(p.id)).map(p => p.famille))].map(f => `<optgroup label="Plats — ${esc(f)}">${POTIONS.filter(p => estPlat(p.id) && p.famille === f).map(p => `<option value="${p.id}">${libArt(p)}</option>`).join("")}</optgroup>`).join("") : "");
  // Ajouter au stock de l'Eau Noire (potion : Elvara, plat : Edmond)
  function ouvrirAjoutEN(dom) {
    const f = $("#form-en-potion"); f.reset(); f.potion.innerHTML = optionsEN(dom); f.qte.value = 1; f.seuil.value = 0;
    $("#f-en-potion-titre").textContent = "Ajouter " + (dom === "cuisine" ? "un plat" : "une potion") + " au stock de l'Eau Noire";
    $("#f-en-potion-lib").textContent = dom === "cuisine" ? "Plat" : "Potion";
    ouvrirF("#f-en-potion");
  }
  $("#en-ajout-potion").onclick = () => ouvrirAjoutEN("alchimie");
  $("#en-ajout-plat").onclick = () => ouvrirAjoutEN("cuisine");
  $("#form-en-potion").potion.addEventListener("change", e => { const x = (D.eaunoire || {})["stock-" + e.target.value]; e.target.form.seuil.value = x ? (+x.seuil || 0) : 0; });
  $("#form-en-potion").onsubmit = e => {
    e.preventDefault(); const f = e.target, p = f.potion.value; if (!p) return;
    const id = "stock-" + p, x = (D.eaunoire || {})[id] || {}, q = Math.max(0, Math.round(+f.qte.value || 0));
    fermerF();
    enregistrer("eaunoire", { [id]: { type: "stock", potion: p, qte: (+x.qte || 0) + q, seuil: Math.max(0, Math.round(+f.seuil.value || 0)) } }, q ? "Ajouté au stock de l'Eau Noire : " + byPot[p].nom + " ×" + q : "Seuil enregistré");
  };
  const stockEN = p => { const id = "stock-" + p, x = (D.eaunoire || {})[id]; return { id, x: x || { type: "stock", potion: p, qte: 0, seuil: 0 } }; };
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-en-d]");
    if (b) { const { id, x } = stockEN(b.dataset.enP), q = Math.max(0, (+x.qte || 0) + (+b.dataset.enD));
      const inp = b.parentElement.querySelector("input"); if (inp) inp.value = q;
      planifier("eaunoire", id, { type: "stock", potion: b.dataset.enP, qte: q, seuil: +x.seuil || 0 }, 700); return; }
    const del = e.target.closest("[data-en-del]");
    if (del) { const x = D.eaunoire[del.dataset.enDel] || {}, quoi = x.type === "membre" ? "Retirer " + x.nom + " de l'Eau Noire ?" : x.type === "metier" ? "Supprimer le métier « " + x.nom + " » ?" : "Retirer " + ((byPot[x.potion] || {}).nom || "cet article") + " du stock de l'Eau Noire ?";
      if (!confirm(quoi)) return;
      const ch = { [del.dataset.enDel]: null };
      if (x.type === "metier") enMembres().filter(m => (m.metiers || []).includes(del.dataset.enDel)).forEach(m => ch[m.id] = { metiers: m.metiers.filter(i => i !== del.dataset.enDel) });
      enregistrer("eaunoire", ch, x.type === "membre" ? "Membre retiré" : x.type === "metier" ? "Métier supprimé" : "Article retiré"); return; }
    const me = e.target.closest("[data-en-metier]"); if (me) { ouvrirMetier(me.dataset.enMetier); return; }
    const mb = e.target.closest("[data-en-membre]"); if (mb) { ouvrirMembre(mb.dataset.enMembre); return; }
    const rm = e.target.closest("[data-en-remettre]"); if (rm) { remettre([rm.dataset.enRemettre], rm.dataset.enDom); return; }
    const an = e.target.closest("[data-en-annuler]"); if (an) annulerRemise(an.dataset.enAnnuler);
  });
  document.addEventListener("change", e => {
    const t = e.target; if (!t.matches("[data-en-champ]")) return;
    const { id, x } = stockEN(t.dataset.enP), v = Math.max(0, Math.round(+t.value || 0));
    enregistrer("eaunoire", { [id]: Object.assign({ type: "stock", potion: t.dataset.enP, qte: +x.qte || 0, seuil: +x.seuil || 0 }, { [t.dataset.enChamp]: v }) });
  });

  // Métiers : potions ET plats attribués chaque semaine
  let metierId = null;
  function ligneQuota(p, n) {
    const div = document.createElement("div"); div.className = "ligne-mouv en-quota";
    div.innerHTML = `<select class="champ" data-q="potion" aria-label="Potion ou plat">${optionsEN()}</select>
      <input class="champ" type="number" min="1" step="1" value="${n || 1}" data-q="n" aria-label="Nombre par semaine">
      <button class="btn-sobre btn-petit" type="button" data-q-suppr title="Retirer la ligne">✕</button>`;
    if (p) div.querySelector("select").value = p;
    $("#f-en-quotas").appendChild(div);
  }
  function ouvrirMetier(id) {
    metierId = id; const m = id ? D.eaunoire[id] : { nom: "", quotas: {} }, f = $("#form-en-metier");
    $("#f-en-metier-titre").textContent = id ? "Modifier le métier" : "Nouveau métier";
    f.nom.value = m.nom || ""; $("#f-en-quotas").innerHTML = "";
    const q = m.quotas || {}; Object.keys(q).forEach(p => ligneQuota(p, q[p]));
    if (!Object.keys(q).length) ligneQuota();
    ouvrirF("#f-en-metier");
  }
  $("#en-ajout-metier").onclick = () => ouvrirMetier(null);
  $("#f-en-quota-plus").onclick = () => ligneQuota();
  $("#f-en-quotas").addEventListener("click", e => { const b = e.target.closest("[data-q-suppr]"); if (b) b.closest(".ligne-mouv").remove(); });
  $("#form-en-metier").onsubmit = e => {
    e.preventDefault(); const f = e.target, quotas = {};
    $$("#f-en-quotas .ligne-mouv").forEach(l => { const p = l.querySelector('[data-q="potion"]').value, n = Math.max(0, Math.round(+l.querySelector('[data-q="n"]').value || 0)); if (p && n) quotas[p] = (quotas[p] || 0) + n; });
    const id = metierId || nvId("metier");
    fermerF();
    // le champ quotas est remplacé en entier (un article retiré disparaît)
    enregistrer("eaunoire", { [id]: { type: "metier", nom: f.nom.value.trim(), quotas } }, metierId ? "Métier modifié" : "Métier ajouté");
  };

  // Membres
  let membreId = null;
  function ouvrirMembre(id) {
    membreId = id; const m = id ? D.eaunoire[id] : { nom: "", metiers: [] }, f = $("#form-en-membre");
    $("#f-en-membre-titre").textContent = id ? "Modifier le membre" : "Nouveau membre de l'Eau Noire";
    f.nom.value = m.nom || "";
    const Mt = enMetiers();
    $("#f-en-membre-metiers").innerHTML = Mt.length ? Mt.map(x => `<label class="case"><input type="checkbox" value="${x.id}" ${(m.metiers || []).includes(x.id) ? "checked" : ""}> ${esc(x.nom)}</label>`).join("")
      : `<p class="mute" style="margin:0">Aucun métier pour l'instant : créez-en avec « + Métier ».</p>`;
    ouvrirF("#f-en-membre");
  }
  $("#en-ajout-membre").onclick = () => ouvrirMembre(null);
  $("#form-en-membre").onsubmit = e => {
    e.preventDefault(); const f = e.target, metiers = $$("#f-en-membre-metiers input:checked").map(i => i.value);
    const id = membreId || nvId("membre");
    fermerF();
    enregistrer("eaunoire", { [id]: { type: "membre", nom: f.nom.value.trim(), metiers } }, membreId ? "Membre modifié" : "Membre ajouté");
  };

  // Remise hebdomadaire (potions par Elvara, plats par Edmond) : les articles sortent
  // du stock de l'Eau Noire, et seulement de celui-là
  function remettre(mids, dom) {
    const sem = lundi(aujourdhui()), ch = {}, total = {}, noms = [];
    mids.forEach(mid => {
      const m = Object.assign({ id: mid }, D.eaunoire[mid] || {}), lignes = attribution(m, dom);
      if (!somme0(lignes) || remiseDe(m, sem, dom)) return;
      noms.push(m.nom);
      ch[nvId("remise") + noms.length] = { type: "remise", domaine: dom, membre: mid, nom: m.nom, semaine: sem, date: new Date().toISOString(), lignes, par: session.nom };
      Object.keys(lignes).forEach(p => total[p] = (total[p] || 0) + lignes[p]);
    });
    if (!noms.length) return;
    const manque = Object.keys(total).filter(p => (+((D.eaunoire["stock-" + p] || {}).qte) || 0) < total[p]);
    const detail = Object.keys(total).map(p => "• " + byPot[p].nom + " ×" + total[p]).join("\n");
    if (!confirm("Remettre les " + MOT[dom][1] + " de la semaine à " + (noms.length > 3 ? noms.length + " membres" : noms.join(", ")) + " ?\n\n" + detail
      + (manque.length ? "\n\nAttention : stock insuffisant pour " + manque.map(p => byPot[p].nom).join(", ") + " (le stock restera à 0)." : ""))) return;
    Object.keys(total).forEach(p => { const { id, x } = stockEN(p); ch[id] = { type: "stock", potion: p, qte: Math.max(0, (+x.qte || 0) - total[p]), seuil: +x.seuil || 0 }; });
    enregistrer("eaunoire", ch, (dom === "cuisine" ? "Plats remis à " : "Potions remises à ") + (noms.length > 1 ? noms.length + " membres" : noms[0]));
  }
  $("#en-remettre-potions").onclick = () => remettre(enMembres().map(m => m.id), "alchimie");
  $("#en-remettre-plats").onclick = () => remettre(enMembres().map(m => m.id), "cuisine");
  function annulerRemise(rid) {
    const r = D.eaunoire[rid]; if (!r || !confirm("Annuler cette remise ? Les articles reviennent dans le stock de l'Eau Noire.")) return;
    const ch = { [rid]: null };
    Object.keys(r.lignes || {}).forEach(p => { const { id, x } = stockEN(p); ch[id] = { type: "stock", potion: p, qte: (+x.qte || 0) + (+r.lignes[p] || 0), seuil: +x.seuil || 0 }; });
    enregistrer("eaunoire", ch, "Remise annulée");
  }

  /* =================================================================
     NOTES D'ALCHIMISTES (boîte à idées)
     ================================================================= */
  const CAT_NOTE = { idee: "💡 Idée", recette: "⚗ Recette", probleme: "⚠ Problème", autre: "✎ Autre" };
  const STATUT_NOTE = { nouvelle: "Non lue", lue: "Lue", retenue: "Retenue" };
  function renderNotes() {
    const f = $("#n-filtre").value, chef = responsable();
    $("#n-filtre").hidden = !chef;
    $("#n-aide").textContent = chef ? "Les notes déposées par l'équipe. Marquez-les comme lues ou retenues." : "Vos idées et remarques pour Elvara, Amaury et Edmond. Vous ne voyez que vos propres notes.";
    const l = Object.keys(D.notes || {}).map(id => Object.assign({ id }, D.notes[id]))
      .filter(n => !chef || !f || n.statut === f).sort((a, b) => (b.cree || "").localeCompare(a.cree || ""));
    $("#notes").innerHTML = l.length ? l.map(n => `<article class="note cadre ${n.statut || "nouvelle"}">
        <div class="note-tete"><span class="note-cat">${CAT_NOTE[n.categorie] || CAT_NOTE.autre}</span><span class="statut ${n.statut}">${STATUT_NOTE[n.statut] || ""}</span></div>
        ${n.titre ? `<h3>${esc(n.titre)}</h3>` : ""}
        <p class="note-texte">${esc(n.texte).replace(/\n/g, "<br>")}</p>
        <div class="note-pied"><span>${esc(n.auteur || "")} · ${n.cree ? new Date(n.cree).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : ""}</span>
          ${chef ? `<span class="actions">${n.statut !== "lue" ? `<button class="btn-sobre btn-petit" type="button" data-note-statut="${n.id}" data-v="lue">Marquer lue</button>` : ""}${n.statut !== "retenue" ? `<button class="btn-sobre btn-petit" type="button" data-note-statut="${n.id}" data-v="retenue">Retenir</button>` : ""}<button class="btn-sobre btn-petit" type="button" data-note-del="${n.id}">Supprimer</button></span>` : ""}</div>
      </article>`).join("")
      : `<p class="vide">${chef ? (f ? "Aucune note dans cette catégorie." : "Aucune note pour le moment.") : "Vous n'avez encore déposé aucune note. Cliquez sur « + Nouvelle note »."}</p>`;
  }
  $("#n-filtre").onchange = renderNotes;
  $("#n-ajouter").onclick = () => { $("#form-note").reset(); ouvrirF("#f-note"); setTimeout(() => $("#form-note").texte.focus(), 40); };
  $("#form-note").onsubmit = async e => {
    e.preventDefault(); const f = e.target, texte = f.texte.value.trim();
    if (!texte) return;
    const corps = { action: "noter", mdp: session.mdp, nom: session.nom, titre: f.titre.value.trim(), texte, categorie: f.categorie.value };
    fermerF();
    D.notes["tmp-" + Date.now().toString(36)] = { titre: corps.titre, texte, categorie: corps.categorie, auteur: session.nom, cree: new Date().toISOString(), statut: "nouvelle" };
    renderTout(); enCours++; renderSync();
    try { const rr = await appel(corps); enCours--; if (!enCours) accepter(rr); renderTout(); toast("Note déposée, merci !"); }
    catch (err) { enCours--; toast((err.message || "Échec") + " — note non enregistrée.", true); charger(true); }
  };
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-note-statut]");
    if (s) { enregistrer("notes", { [s.dataset.noteStatut]: { statut: s.dataset.v } }, s.dataset.v === "lue" ? "Note marquée comme lue" : "Note retenue"); return; }
    const d = e.target.closest("[data-note-del]");
    if (d && confirm("Supprimer cette note ?")) enregistrer("notes", { [d.dataset.noteDel]: null }, "Note supprimée");
  });

  /* =================================================================
     DIVERS
     ================================================================= */
  function ouvrirF(s) { $(s).hidden = false; const i = $(s).querySelector("input:not([type=checkbox]),select"); if (i) setTimeout(() => i.focus(), 30); }
  function fermerF() { $$(".fenetre").forEach(f => f.hidden = true); }
  document.addEventListener("click", e => { if (e.target.matches("[data-fermer]") || e.target.classList.contains("fenetre")) fermerF(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { fermerF(); if (modeAjout) { modeAjout = false; document.body.classList.remove("mode-ajout"); } } });
  $("#burger").onclick = () => $("#nav").classList.toggle("ouvert");
  let tt;
  function toast(t, err) { const el = $("#toast"); el.textContent = t; el.classList.toggle("erreur", !!err); el.classList.add("visible"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("visible"), err ? 3500 : 1800); }

  // Rafraîchissement automatique (en ligne) toutes les 30 s
  setInterval(() => { if (session && !session.demo && !document.hidden && !enCours && !Object.keys(attente).length && !$$(".fenetre").some(f => !f.hidden)) charger(true); }, 30000);

  /* ---------- Reprise de session ---------- */
  const s = sess.get("session", null) || local.get("session", null);
  if (s && (s.demo ? !API : !!API)) entrer(s);
})();
