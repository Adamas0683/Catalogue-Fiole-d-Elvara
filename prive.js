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
  const VIDE = () => ({ ingredients: {}, potions: {}, carte: {}, accords: {}, ventes: {}, achats: {}, offres: {}, mouvements: {}, notes: {}, reglages: {}, eaunoire: {}, packs: {}, recoltes: {}, comptes: {} });
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
      if (c.action === "vendre" && !c.stock) { if (!responsable()) c.stock = true; else if (!String(c.motifStock || "").trim()) throw new Error("Indiquez pourquoi le stock n'est pas retiré."); }
      if (c.action === "acheter" && !responsable()) throw new Error("Les achats sont réservés à Elvara, Amaury et Edmond.");
      const partie = responsable() ? dom : "alchimie";
      if (mvt && partie !== dom) throw new Error("Opération non autorisée pour cette partie.");
      if (!achat && partie !== dom) throw new Error("Vente non autorisée pour cette partie.");
      const nc = mvt ? "mouvements" : achat ? "achats" : "ventes", coll = db.donnees[nc] || (db.donnees[nc] = {});
      (c.lignes || []).forEach((l, i) => {
        const rec = { date: c.date, type: l.type, article: l.article, qte: l.qte, prix: l.prix, domaine: dom, cree: new Date().toISOString() };
        if (mvt) { rec.sens = plus ? "ajout" : "retrait"; rec.motif = c.tiers || ""; rec.par = c.nom; delete rec.prix; }
        else if (achat) { rec.fournisseur = c.tiers || ""; rec.acheteur = c.nom; } else { rec.client = c.tiers || ""; rec.vendeur = c.nom; rec.stock = !!c.stock; if (!c.stock) rec.motifStock = c.motifStock; }
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
    // Miroirs démo : corrections / inventaire, suppression avec remise du stock, fabrication
    const D2 = db.donnees, jour = aujourdhui(), now = new Date().toISOString(), cle = p => p + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    ["mouvements", "potions", "ingredients"].forEach(k => D2[k] || (D2[k] = {}));
    const ligneStock = r => r.type === "ingredient" ? (r.domaine === "cuisine" && COMMUN.has(r.article) ? "stockCuisine" : "stock") : r.type === "nourriture" && r.reserve === "edmond" ? "stockEdmond" : "stock";
    if (c.action === "corriger") {
      if (!responsable()) throw new Error("Seuls Elvara, Amaury et Edmond corrigent les stocks.");
      const motif = String(c.motif || "").trim(); if (!motif) throw new Error("Le motif de la correction est obligatoire.");
      const base = cle("corr-"); let n = 0;
      (c.lignes || []).forEach((l, i) => { const o = D2[l.col][l.article] || (D2[l.col][l.article] = {}), avant = +o[l.champ] || 0, apres = Math.max(0, Math.round(+l.valeur || 0)); if (avant === apres) return;
        o[l.champ] = apres; n++;
        const type = l.col === "ingredients" ? "ingredient" : estPlat(l.article) ? "nourriture" : "potion";
        const r = { sens: c.genre === "inventaire" ? "inventaire" : "correction", type, article: l.article, champ: l.champ, avant, apres, ecart: apres - avant, qte: Math.abs(apres - avant),
          domaine: l.champ === "stockCuisine" || type === "nourriture" ? "cuisine" : "alchimie", motif, par: c.nom, date: jour, cree: now };
        if (type === "nourriture") r.reserve = l.champ === "stockEdmond" ? "edmond" : "eau-noire";
        D2.mouvements[base + "-" + i] = r; });
      if (!n) throw new Error("Aucun écart : rien à corriger.");
      db.maj = now; db.par = c.nom; local.set("demo", db);
    }
    if (c.action === "supprimerLigne") {
      if (!responsable()) throw new Error("Seuls Elvara, Amaury et Edmond suppriment des lignes.");
      const r = (D2[c.collection] || {})[c.id]; if (!r) throw new Error("Cette ligne n'existe plus.");
      const sens = c.collection === "ventes" ? 1 : c.collection === "achats" ? -1 : r.sens === "ajout" ? -1 : r.sens === "retrait" ? 1 : 0;
      delete D2[c.collection][c.id];
      if (c.remettre && sens && (c.collection !== "ventes" || r.stock !== false)) {
        const pc = r.type === "ingredient" ? "ingredients" : "potions", ch = ligneStock(r), o = D2[pc][r.article] || (D2[pc][r.article] = {}), avant = +o[ch] || 0, apres = Math.max(0, avant + sens * (+r.qte || 0));
        o[ch] = apres;
        const quoi = c.collection === "ventes" ? "d'une vente" : c.collection === "achats" ? "d'un achat" : r.sens === "ajout" ? "d'un ajout" : "d'un retrait", qui = r.vendeur || r.acheteur || r.par;
        D2.mouvements[cle("annul-")] = { sens: "annulation", type: r.type, article: r.article, champ: ch, avant, apres, ecart: apres - avant, qte: Math.abs(apres - avant), domaine: r.domaine, reserve: r.reserve,
          motif: "Suppression " + quoi + " du " + (r.date || "") + (qui ? " (" + qui + ")" : ""), par: c.nom, date: jour, cree: now };
      }
      db.maj = now; db.par = c.nom; local.set("demo", db);
    }
    if (c.action === "fabriquer") {
      const q = Math.max(1, Math.round(+c.qte || 1)), ingr = (c.ingredients || []).filter(l => l.article && l.qte);
      ingr.forEach(l => { const o = D2[l.type === "potion" ? "potions" : "ingredients"]; const x = o[l.article] || (o[l.article] = {}); x.stock = Math.max(0, (+x.stock || 0) - l.qte); });
      const x = D2.potions[c.potion] || (D2.potions[c.potion] = {}); x.stock = (+x.stock || 0) + q;
      D2.mouvements[cle("fab-")] = { sens: "fabrication", type: "potion", article: c.potion, qte: q, ingredients: ingr, domaine: "alchimie", motif: c.motif || "", par: c.nom, date: jour, cree: now };
      db.maj = now; db.par = c.nom; local.set("demo", db);
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
    if (c.action === "vendrePack") {
      const k = (db.donnees.packs || {})[c.pack]; if (!k) throw new Error("Ce pack n'existe plus.");
      const n = Math.max(1, Math.round(+c.qte || 1)), L = (k.lignes || []).filter(l => byPot[l.article] && !byPot[l.article].interdit);
      const poids = L.map(l => (+((db.donnees.potions[l.article] || {}).prix ?? byPot[l.article].prix) || 0) * l.qte), somme = poids.reduce((t, x) => t + x, 0) || 1;
      if (!c.stock) { if (!responsable()) c.stock = true; else if (!String(c.motifStock || "").trim()) throw new Error("Indiquez pourquoi le stock n'est pas retiré."); }
      const totalC = Math.round((+k.prix || 0) * n * 100), groupe = "vente-" + Date.now().toString(36); let reste = totalC;
      L.forEach((l, i) => {
        const part = i === L.length - 1 ? reste : Math.floor(totalC * poids[i] / somme); reste -= part;
        const qte = l.qte * n, dom = estPlat(l.article) ? "cuisine" : "alchimie";
        const r = { date: c.date, type: dom === "cuisine" ? "nourriture" : "potion", article: l.article, qte, prix: part / 100 / qte, domaine: dom, cree: new Date().toISOString(), client: c.tiers || "", vendeur: c.nom, pack: c.pack, packNom: k.nom, packQte: n, packGroupe: groupe, stock: !!c.stock };
        if (!c.stock) r.motifStock = c.motifStock;
        if (dom === "cuisine") r.reserve = c.reserve === "edmond" ? "edmond" : "eau-noire";
        db.donnees.ventes[groupe + "-" + i] = r;
        if (c.stock) { const o = db.donnees.potions[l.article] || (db.donnees.potions[l.article] = {}), ch = dom === "cuisine" && c.reserve === "edmond" ? "stockEdmond" : "stock"; o[ch] = Math.max(0, (+o[ch] || 0) - qte); }
      });
      db.maj = new Date().toISOString(); db.par = c.nom; local.set("demo", db);
    }
    if (c.action === "noter") {
      (db.donnees.notes || (db.donnees.notes = {}))["note-" + Date.now().toString(36)] = { titre: c.titre || "", texte: c.texte, categorie: c.categorie || "idee", auteur: c.nom, cree: new Date().toISOString(), statut: "nouvelle" };
      db.maj = new Date().toISOString(); db.par = c.nom; local.set("demo", db);
    }
    if (c.action === "ecrire") {
      if (c.collection === "packs" && Object.values(c.changements).some(k => k && (k.lignes || []).some(l => byPot[l.article] && byPot[l.article].interdit))) throw new Error("Un pack ne peut pas contenir d'objet interdit.");
      if (c.collection === "carte" && !editeurCarte()) throw new Error("Seul Aldéric peut modifier la carte des récoltes.");
      if (c.collection === "comptes" && !accesLivre()) throw new Error("Le livre des comptes est réservé à Elvara et Edmond.");
      if (session.role === "employe" && c.collection === "eaunoire") {
        const EN0 = db.donnees.eaunoire || {}, ok = Object.keys(c.changements).every(id => { const v = c.changements[id], a = EN0[id];
          if (v === null) return a && a.type === "remise" && norm(a.par || "") === norm(c.nom);
          if (v.type === "remise") return !a && norm(v.par || "") === norm(c.nom);
          return v.type === "stock" && a && a.type === "stock" && +(v.seuil || 0) === +(a.seuil || 0); });
        if (!ok) throw new Error("Les employés peuvent seulement distribuer les potions et les plats de l'Eau Noire.");
      } else if (session.role === "employe" && c.collection === "packs") {
        const P0 = db.donnees.packs || {}, ok = Object.keys(c.changements).every(id => { const v = c.changements[id], a = P0[id], sien = a && a.valide === false && norm(a.par || "") === norm(c.nom);
          if (v === null) return sien; if (v.valide !== false || v.vitrine !== false) return false; return a ? sien : norm(v.par || "") === norm(c.nom); });
        if (!ok) throw new Error("Les employés peuvent proposer des packs ; seuls Elvara, Amaury et Edmond les valident et les mettent sur la vitrine.");
      } else if (session.role === "employe" && c.collection !== "carte") throw new Error("Les employés peuvent seulement enregistrer des ventes.");
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
    if (!accesLivre()) donnees.comptes = {};
    return Promise.resolve({ role: session.role, donnees, maj: db.maj, par: db.par });
  }
  function accepter(r) {
    D = Object.assign(VIDE(), r.donnees || {});
    infoSync = { maj: r.maj || "", par: r.par || "" };
    // Corrections de stock pas encore enregistrées : elles restent affichées
    Object.values(corr).forEach(c => { const o = D[c.col][c.article] || (D[c.col][c.article] = {}); o[c.champ] = c.valeur; });
  }
  const corr = {};   // corrections de stock en attente de motif
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
  // Ingrédients (alchimie et Marmite) : prix de vente = prix de rachat × 1,5, calculé automatiquement
  // (0 tant que le rachat n'est pas fixé), sauf si Elvara, Amaury ou Edmond l'ont forcé (prixForce).
  const COEF_VENTE_ING = 1.5;
  const ingV = id => { const o = D.ingredients[id] || {};
    const v = Object.assign({ stock: 0, seuil: 0, stockCuisine: 0, seuilCuisine: 0, accord: false, accordTexte: "", chatellerie: "" }, o);
    v.prixAchat = o.prixAchat == null || o.prixAchat === "" ? 0 : +o.prixAchat || 0;
    v.prixAuto = Math.round(v.prixAchat * COEF_VENTE_ING * 100) / 100;
    v.prixForce = !!o.prixForce;
    v.prix = v.prixForce ? +o.prix || 0 : v.prixAuto;
    return v; };
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
  // Coût de fabrication d'une potion ou d'un plat : somme (quantité × prix de rachat) des ingrédients
  // de la recette la moins chère, divisée par le nombre d'unités produites par recette (rendement).
  // Un ingrédient qui est lui-même une potion / un plat (bière, pain…) compte à son coût de fabrication,
  // ou à son prix de rachat s'il n'a pas de recette. « manque » : ingrédients sans prix de rachat (comptés 0).
  function coutFab(id, vus) {
    const p = byPot[id]; if (!p || !p.recettes || !p.recettes.length) return null;
    vus = vus || new Set([id]);
    const essais = p.recettes.map(r => { let total = 0; const manque = [];
      r.forEach(([art, q]) => { const n = q == null ? 1 : +q || 0;
        if (byIng[art]) { const pa = ingV(art).prixAchat; if (!pa) manque.push(byIng[art].nom); total += n * pa; }
        else if (byPot[art]) { const sous = !vus.has(art) && coutFab(art, new Set([...vus, art]));
          const u = sous ? sous.cout : +potV(art).prixAchat || 0; if (sous) manque.push(...sous.manque); else if (!u) manque.push(byPot[art].nom); total += n * u; }
        else manque.push(art); });
      return { total, manque }; });
    const complets = essais.filter(e => !e.manque.length), choix = (complets.length ? complets : essais).reduce((a, b) => b.total < a.total ? b : a);
    const rend = Math.max(1, Math.round(+potV(id).rendement || 1));
    return { cout: Math.round(choix.total / rend * 100) / 100, manque: [...new Set(choix.manque)], rend, variantes: p.recettes.length };
  }
  function coutHTML(id, v) {
    const c = coutFab(id); if (!c) return `<span class="mute" title="Pas de recette connue">—</span>`;
    const pv = +v.prix || 0, m = Math.round((pv - c.cout) * 100) / 100;
    const titre = `Recette${c.variantes > 1 ? " la moins chère" : ""} au prix de rachat des ingrédients` + (c.rend > 1 ? `, ${c.rend} unités par recette` : "") + (c.manque.length ? `. Sans prix de rachat (comptés 0) : ${c.manque.join(", ")}` : "");
    return `<span class="cout-fab${c.manque.length ? " incomplet" : ""}" title="${esc(titre)}">${c.manque.length ? "≥ " : ""}${nb(c.cout)}${c.manque.length ? ` <b>?</b>` : ""}
      <small class="${m > 0 ? "pos" : m < 0 ? "neg" : ""}">${pv ? (m > 0 ? "+" : "") + nb(m) + " à la vente" : c.manque.length ? c.manque.length + " prix manquant" + (c.manque.length > 1 ? "s" : "") : ""}</small></span>`;
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
  // Carte des récoltes (collection « carte » + lieux de départ de data.js)
  const nomIn = l => () => !!session && l.some(n => norm(n) === norm(session.nom));
  const accesLivre = nomIn(["Elvara", "Edmond"]);   // livre des comptes : loyer et sommes dues à l'Eau Noire
  const accesCarte = nomIn(["Elvara", "Amaury", "Edmond", "Aldéric"]);   // voient l'onglet
  const editeurCarte = nomIn(["Aldéric"]);                                // seul à placer, modifier, supprimer
  const titrePoint = p => p.titre || (p.ingredients || []).filter(id => byIng[id]).map(id => byIng[id].nom).join(", ") || "Point de récolte";
  // Ancienne carte peinte (1600 × 1200) -> coordonnées du jeu, ajustement sur 14 villes et lacs
  const ancienVersJeu = (x, y) => ({ gx: Math.round(281.499 * x + 0.0633 * y - 219047), gy: Math.round(-1.2545 * x - 282.619 * y + 174374) });
  function points() {
    const out = [];
    CARTE_DEPART.forEach(p => { const o = D.carte[p.id]; if (o && o.supprime) return; out.push(Object.assign({}, p, o || {})); });
    Object.keys(D.carte).forEach(id => { if (!CARTE_DEPART.some(p => p.id === id) && !D.carte[id].supprime && D.carte[id].type !== "frontiere") out.push(Object.assign({ id, ingredients: [] }, D.carte[id])); });
    // Positions en coordonnées du jeu (gx, gy). Les anciens points (x, y sur l'ancienne carte) sont convertis.
    return out.map(p => { const o = D.carte[p.id] || {};
      if (o.gx == null && o.x != null) Object.assign(p, ancienVersJeu(o.x, o.y));
      else if (p.gx == null && p.x != null) Object.assign(p, ancienVersJeu(p.x, p.y));
      return Object.assign(p, { titre: titrePoint(p) }); });
  }
  const accords = () => Object.keys(D.accords).map(id => Object.assign({ id }, D.accords[id]));
  const gerante = () => session && session.role === "gerante";      // Elvara : alchimie
  const cuisinier = () => session && session.role === "cuisinier";  // Edmond : cuisine
  const responsable = () => gerante() || cuisinier();
  // Stock de l'Eau Noire : réservé aux comptes d'Elvara (potions) et d'Edmond (plats)
  const accesEN = () => !!session;   // tout le monde voit l'Eau Noire ; la gestion reste à Elvara, Amaury et Edmond (peutEN)
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
    $('[data-p="packs"]').hidden = !session;
    $('[data-p="comptes"]').hidden = !accesLivre();
    $('[data-p="carte"]').hidden = !accesCarte();
    $("#j-inventaire").hidden = !responsable();
    if (onglet === "packs" && !session) onglet = "accueil";
    if (onglet === "comptes" && !accesLivre()) onglet = "accueil";
    if (onglet === "eaunoire" && !accesEN()) onglet = "accueil";
    if (onglet === "carte" && !accesCarte()) onglet = "accueil";
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
    if (p === "packs" && !session) p = "accueil";
    if (p === "comptes" && !accesLivre()) p = "accueil";
    onglet = p;
    // En arrivant sur une trésorerie : d'abord la sélection (ensemble, offres, personne)
    if (p.startsWith("tresor-")) { tresorDom = p.slice(7); tresorQui = null; }
    const panneau = p.startsWith("tresor-") ? "tresor" : p;
    $$("#onglets-prive [data-p]").forEach(b => b.setAttribute("aria-selected", b.dataset.p === p));
    $("#o-tresor").setAttribute("aria-selected", String(p.startsWith("tresor-")));
    $("#o-tresor-dom").textContent = p === "tresor-alchimie" ? "alchimie" : p === "tresor-cuisine" ? "cuisine" : "";
    $$(".panneau").forEach(x => x.hidden = x.id !== "panneau-" + panneau);
    if (p !== "carte" && document.body.classList.contains("carte-plein")) { $("#carte-zone").classList.remove("plein"); document.body.classList.remove("carte-plein"); $("#k-plein").textContent = "Agrandir la carte"; }
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
    if (onglet === "comptes") renderComptes();
    if (onglet === "packs") renderPacks();
    if (onglet === "journal") renderJournal();
    const nn = responsable() ? Object.values(D.notes || {}).filter(n => n.statut === "nouvelle").length : 0;
    $("#p-notes").hidden = !nn; $("#p-notes").textContent = nn;
    if (onglet.startsWith("tresor-")) renderTresor();
    // Pastille : achats à valider dans ma partie + offres ouvertes que je peux accepter
    const no = offres().filter(o => responsable() ? o.statut === "en-cours" : o.statut === "ouverte").length;
    $("#p-offres").hidden = !no; $("#p-offres").textContent = no;
    $("#k-ajouter").hidden = !editeurCarte();
    $("#k-front-edit").hidden = !editeurCarte();
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
    if (accesCarte()) points().filter(p => p.accord).forEach(p => out.push({ cat: "accords", type: "accord", ico: "🗺", titre: "Carte — " + p.titre, detail: p.accordTexte || ("Accord requis (" + (p.chatellerie || "châtellerie") + ")"), aller: "carte" }));
    const rang = { rupture: 0, accord: 1, bas: 2 };
    return out.sort((a, b) => rang[a.type] - rang[b.type]);
  }
  function renderAccueil() {
    const ING = INGREDIENTS.filter(i => voit("ingredients", i.id)), POT = POTIONS.filter(p => voit("potions", p.id));
    const ingEnStock = ING.filter(i => lignesIng().some(x => x.i === i && vueIng(i.id, x.dom).stock > 0)).length;
    const qteTot = id => { const v = potV(id); return (+v.stock || 0) + (estPlat(id) ? (+v.stockEdmond || 0) : 0); };
    const potEnStock = POT.filter(p => qteTot(p.id) > 0).length;
    // Valeur du stock au prix de rachat : produits (Eau Noire + Edmond) et ingrédients (alchimie + cuisine)
    const valeurPot = POT.reduce((a, p) => a + qteTot(p.id) * (+potV(p.id).prixAchat || 0), 0)
      + ING.reduce((a, i) => { const v = ingV(i.id); return a + ((+v.stock || 0) + (COMMUN.has(i.id) ? (+v.stockCuisine || 0) : 0)) * (+v.prixAchat || 0); }, 0);
    const al = alertesListe();
    const nAlerte = al.filter(a => a.type !== "accord").length;
    const ac = accords();
    $("#resume").innerHTML = `
      <div class="bloc cadre"><strong>${ingEnStock}</strong><span>ingrédients en stock sur ${ING.length}</span></div>
      <div class="bloc cadre"><strong>${potEnStock}</strong><span>produits en stock sur ${POT.length}</span></div>
      <div class="bloc cadre"><strong>${nb(valeurPot)}</strong><span>${M} de stock (valeur au rachat, ingrédients compris)</span></div>
      <div class="bloc cadre ${nAlerte ? "bas" : ""}"><strong>${nAlerte}</strong><span>stocks bas ou en rupture</span></div>
      <div class="bloc cadre"><strong>${ac.filter(a => a.statut === "actif").length}</strong><span>accords actifs</span></div>
      <div class="bloc cadre" data-aller="${cuisinier() ? "tresor-cuisine" : "tresor-alchimie"}" style="cursor:pointer"><strong>${nb(totalJour(aujourdhui()))}</strong><span>${M} vendus aujourd'hui${monDomaine() ? "" : " (alchimie + cuisine)"}</span></div>`;
    // Trésoreries : la Fiole (alchimie), la Marmite (cuisine), l'Eau Noire, et la Boutique (Fiole + Marmite)
    const tF = tresorDe("alchimie"), tM = tresorDe("cuisine"), tE = Math.round(cumul(ventes()).forge * 100) / 100, tB = Math.round((tF + tM) * 100) / 100;
    const carteT = (v, nom, detail, aller, lis) => `<div class="bloc cadre tresor-boutique lis ${lis} ${v < 0 ? "rupture" : ""}"${aller ? ` data-aller="${aller}" data-aller-qui="ensemble" style="cursor:pointer"` : ""} title="${detail}"><strong>${nb(v)}</strong><span>${M} — trésorerie ${nom}</span></div>`;
    $("#resume-tresors").innerHTML = carteT(tF, "de la Fiole", TAUX.alchimie.boutique + " % des ventes d'alchimie, moins les achats d'alchimie", "tresor-alchimie", "lis-fiole")
      + carteT(tM, "de la Marmite", TAUX.cuisine.boutique + " % des ventes de cuisine, moins les achats de cuisine", "tresor-cuisine", "lis-marmite")
      + carteT(tE, "de l'Eau Noire", TAUX.alchimie.forge + " % de toutes les ventes (alchimie et cuisine), plus les arrondis", "", "lis-forge")
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
          <td class="num p-vente">${champNum("ingredients", i.id, "prix", v.prix)}${v.prixForce
            ? `<small class="prix-mode force">forcé${peutModifier("ingredients", i.id) ? ` · <button class="lien-btn" type="button" data-prix-auto="${i.id}" title="Revenir au calcul : rachat × 1,5 = ${nb(v.prixAuto)}">calcul auto</button>` : ""}</small>`
            : `<small class="prix-mode">auto · rachat × 1,5</small>`}${lotIng(i.id) > 1 ? `<small class="prix-mode lot">lot de 100 : ${nb(Math.round(v.prix * 10000) / 100)} ${M}</small>` : ""}</td>
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
    $("#t-potions").innerHTML = `<thead><tr><th class="ic"></th><th>Article</th><th class="num">Stock${avecPlats ? `<small style="display:block;font-size:.72rem">plats : ${RESERVES[reserve].nom}</small>` : ""}</th><th class="num">Seuil</th><th class="num">Prix rachat<small>${M}</small></th><th class="num">Coût fabrication<small>${M} / unité</small></th><th class="num">Prix vente<small>${M}</small></th><th class="num">Marge<small>vente − rachat</small></th><th>Vitrine</th><th>Accueil</th><th>État</th></tr></thead>
      <tbody>${rows.map(p => {
        const v = vueRes(p.id), e = etat(v), iv = vedettesDe(domaineDe("potions", p.id)).indexOf(p.id), pm = peutModifier("potions", p.id);
        return `<tr>
          <td class="ic"><img src="images/potions/${p.img}" alt="" loading="lazy"></td>
          <td class="nom">${esc(p.nom)}${p.en ? ` <span class="en">${esc(p.en)}</span>` : ""}${p.interdit ? ` <span class="interdit-tag" title="Jamais affiché sur la vitrine">Interdit</span>` : ""}<small>${esc(p.famille)} · ${esc(p.effet)}</small>${p.source ? `<small class="mute"><i>${esc(p.source)}</i></small>` : ""}${blocRecettes(p.recettes)}</td>
          <td class="num">${stockCell("potions", p.id, v, v._cs)}</td>
          <td class="num">${champNum("potions", p.id, v._ce, v.seuil)}</td>
          <td class="num p-rachat">${champNum("potions", p.id, "prixAchat", v.prixAchat)}</td>
          <td class="num">${coutHTML(p.id, v)}</td>
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
  const EXCLUS_FICHE = p => p.famille === "Invisibilité" || p.nonFabricable;
  // Nombre de potions produites par une recette (réglé par potion dans la fiche)
  const rendementDe = id => Math.max(1, Math.round(+potV(id).rendement || 1));
  function calculFiche() {
    const aFaire = [], sansRecette = [], besoins = {}, inconnus = new Set();
    POTIONS.filter(p => !estPlat(p.id) && !EXCLUS_FICHE(p)).forEach(p => {
      const v = potV(p.id), seuil = +v.seuil || 0, stock = +v.stock || 0;
      if (!seuil || stock >= seuil) return;              // pas de seuil, ou stock suffisant
      const qte = seuil - stock, rec = (p.recettes || [])[0];
      if (!rec || !rec.length) { sansRecette.push({ p, stock, seuil, qte }); return; }
      const rend = rendementDe(p.id), fois = Math.ceil(qte / rend);
      rec.forEach(([id, q]) => {
        if (q == null) { inconnus.add(id); besoins[id] = besoins[id] || 0; return; }
        besoins[id] = (besoins[id] || 0) + q * fois;
      });
      aFaire.push({ p, stock, seuil, qte, fois, rec, rend });
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
      const faisable = Math.min(x.qte, fois * x.rend);
      const manque = faisable < x.qte ? connus.map(([id, q]) => ({ id, nom: nomIng(id), q: q * (x.fois - fois) - Math.max(0, reste[id] || 0) })).filter(m => m.q > 0) : [];
      return Object.assign({}, x, { faisable, manque, inconnu });
    });
    return { aFaire, sansRecette, ingr, faisables };
  }
  function renderFiche() {
    const F = calculFiche();
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
        <thead><tr><th class="ic"></th><th>Potion</th><th class="num">Stock / seuil</th><th class="num">À faire</th><th class="num">Potions<small>par recette</small></th><th>Recette</th></tr></thead>
        <tbody>${F.aFaire.map(x => `<tr>
          <td class="ic"><img src="images/potions/${x.p.img}" alt=""></td>
          <td class="nom">${esc(x.p.nom)}${x.p.en ? ` <span class="en">${esc(x.p.en)}</span>` : ""}</td>
          <td class="num">${nb(x.stock)} / ${nb(x.seuil)}</td>
          <td class="num"><b>${nb(x.qte)}</b>${x.rend > 1 ? `<small class="mute"> (${x.fois} recette${x.fois > 1 ? "s" : ""})</small>` : ""}</td>
          <td class="num">${responsable() ? `<input class="prix-edit" type="number" min="1" step="1" value="${x.rend}" data-rend="${x.p.id}" title="Nombre de potions obtenues avec une recette">` : nb(x.rend)}</td>
          <td><div class="recette">${ligneRecette(x.rec)}</div></td></tr>`).join("")}</tbody>
      </table></div>
      <h4 class="fiche-h4">Faisable avec le stock actuel</h4>
      <p class="mute fiche-note" style="margin:0 0 8px">Les ingrédients en stock sont répartis entre les potions (ruptures d'abord) : ce que l'on peut fabriquer tout de suite, sans rien acheter ni récolter.</p>
      <div class="table-wrap"><table class="registre fiche-table">
        <thead><tr><th class="ic"></th><th>Potion</th><th class="num">Faisable</th><th class="num">À faire</th><th>État</th><th>Il manque pour le reste</th><th>Fabriquer</th></tr></thead>
        <tbody>${F.faisables.map(x => { const e = x.faisable >= x.qte ? "ok" : x.faisable > 0 ? "bas" : "rupture";
          return `<tr>
          <td class="ic"><img src="images/potions/${x.p.img}" alt=""></td>
          <td class="nom">${esc(x.p.nom)}${x.p.en ? ` <span class="en">${esc(x.p.en)}</span>` : ""}</td>
          <td class="num"><b class="${e === "ok" ? "ok" : e === "rupture" ? "rouge" : ""}">${nb(x.faisable)}</b></td>
          <td class="num">${nb(x.qte)}</td>
          <td><span class="etat ${e}">${e === "ok" ? "Faisable" : e === "bas" ? "En partie" : "Pas faisable"}</span>${x.inconnu ? ` <span class="mute" title="Une quantité de la recette est inconnue">(?)</span>` : ""}</td>
          <td>${x.manque.length ? `<div class="recette">${x.manque.map(m => `<span class="ing">${esc(m.nom)} <b>×${nb(m.q)}</b></span>`).join("")}</div>` : `<span class="mute">—</span>`}</td>
          <td><div class="fab"><input class="prix-edit" type="number" min="1" step="1" value="${x.faisable || 1}" data-fab-n="${x.p.id}" aria-label="Quantité à fabriquer"><button class="btn btn-petit" type="button" data-fab="${x.p.id}" ${x.faisable ? "" : "disabled"} title="Retire les ingrédients du stock et ajoute la potion">Fabriquer</button></div></td></tr>`; }).join("")}</tbody>
      </table></div>
      ${F.sansRecette.length ? `<p class="mute fiche-note">Sans recette enregistrée (non comptées dans les ingrédients) : ${F.sansRecette.map(x => esc(x.p.nom) + " ×" + x.qte).join(", ")}.</p>` : ""}`;
  }
  function texteFiche() {
    const F = calculFiche(), l = [`⚗ **Fiche de fabrication — ${BOUTIQUE.nom}** (${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })})`, ""];
    if (!F.aFaire.length) return l[0] + "\nRien à fabriquer pour le moment.";
    l.push("**Potions à fabriquer :**");
    F.aFaire.forEach(x => l.push(`- ${x.p.nom} ×${x.qte} (stock ${x.stock} / seuil ${x.seuil})${x.rend > 1 ? ` — ${x.fois} recette(s) de ${x.rend}` : ""}`));
    l.push("", "**Ingrédients à prendre sur soi :**");
    F.ingr.forEach(x => { const m = Math.max(0, x.q - x.stock); l.push(`- ${x.nom} ×${x.inconnu ? (x.q ? x.q + " + ?" : "?") : x.q}${!x.inconnu && m ? ` (manque ${m})` : ""}`); });
    const ok = F.faisables.filter(x => x.faisable > 0);
    l.push("", "**Faisable tout de suite avec le stock :**");
    if (ok.length) ok.forEach(x => l.push(`- ${x.p.nom} ×${x.faisable}${x.faisable < x.qte ? ` (sur ${x.qte})` : ""}`)); else l.push("- Rien pour le moment");
    if (F.sansRecette.length) l.push("", "*Sans recette : " + F.sansRecette.map(x => x.p.nom + " ×" + x.qte).join(", ") + "*");
    return l.join("\n");
  }
  $("#p-fiche").onclick = () => { renderFiche(); ouvrirF("#f-fiche"); };
  // Potions par recette (Elvara, Amaury, Edmond)
  $("#fiche-corps").addEventListener("change", e => {
    const r = e.target.closest("[data-rend]"); if (!r) return;
    enregistrer("potions", { [r.dataset.rend]: { rendement: Math.max(1, Math.round(+r.value || 1)) } }, "Rendement de la recette enregistré");
    setTimeout(renderFiche, 50);
  });
  // Fabriquer : les ingrédients de la recette sortent du stock d'alchimie, la potion y entre
  $("#fiche-corps").addEventListener("click", async e => {
    const b = e.target.closest("[data-fab]"); if (!b) return;
    const p = byPot[b.dataset.fab], rec = (p.recettes || [])[0] || [], rend = rendementDe(p.id);
    const voulu = Math.max(1, Math.round(+$(`[data-fab-n="${p.id}"]`).value || 1)), fois = Math.ceil(voulu / rend), produit = fois * rend;
    const ingredients = rec.filter(([, q]) => q != null && q > 0).map(([id, q]) => ({ article: id, type: byIng[id] ? "ingredient" : "potion", qte: q * fois }));
    const inconnus = rec.filter(([, q]) => q == null).map(([id]) => nomIng(id));
    const dispo = l => l.type === "ingredient" ? vueIng(l.article, "alchimie").stock : +potV(l.article).stock || 0;
    const manque = ingredients.filter(l => dispo(l) < l.qte);
    if (!confirm(`Fabriquer ${produit} × ${p.nom} (${fois} recette${fois > 1 ? "s" : ""}) ?\n\nRetiré du stock d'alchimie :\n` + ingredients.map(l => "• " + nomIng(l.article) + " ×" + l.qte).join("\n")
      + (inconnus.length ? "\n\nQuantité inconnue (non retirée) : " + inconnus.join(", ") : "")
      + (manque.length ? "\n\nAttention : stock insuffisant pour " + manque.map(l => nomIng(l.article)).join(", ") + " (le stock restera à 0)." : ""))) return;
    b.disabled = true; enCours++; renderSync();
    try {
      const r = await appel({ action: "fabriquer", mdp: session.mdp, nom: session.nom, potion: p.id, qte: produit, ingredients, motif: "Fiche de fabrication" });
      enCours--; if (!enCours) accepter(r); renderTout(); renderFiche();
      toast(produit + " × " + p.nom + " fabriquée" + (produit > 1 ? "s" : "") + " : ingrédients retirés, potion ajoutée au stock");
    } catch (err) { enCours--; b.disabled = false; toast(err.message || "Échec", true); charger(true); }
  });
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
      corrigerStock(col, id, champ, s);
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
    const pa = e.target.closest("[data-prix-auto]");
    if (pa && peutModifier("ingredients", pa.dataset.prixAuto)) { enregistrer("ingredients", { [pa.dataset.prixAuto]: { prixForce: null, prix: null } }, "Prix de vente recalculé (rachat × 1,5)"); return; }
    const c = e.target.closest("[data-cloche]");
    if (c && peutModifier("ingredients", c.dataset.cloche)) ouvrirCloche(c.dataset.cloche);
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.matches("input[data-champ]") && CHAMPS_STOCK.includes(t.dataset.champ)) { corrigerStock(t.dataset.col, t.dataset.id, t.dataset.champ, Math.max(0, +t.value || 0)); return; }
    if (t.matches("input[data-champ]")) {
      const n = Math.max(0, +String(t.value).replace(",", ".") || 0);
      const val = t.dataset.champ === "prix" || t.dataset.champ === "prixAchat" ? Math.round(n * 100) / 100 : Math.round(n);
      // Prix de vente d'un ingrédient tapé à la main : il devient « forcé » et n'est plus recalculé
      const ch = t.dataset.col === "ingredients" && t.dataset.champ === "prix" ? { prix: val, prixForce: true } : { [t.dataset.champ]: val };
      enregistrer(t.dataset.col, { [t.dataset.id]: ch }, t.dataset.col === "ingredients" && t.dataset.champ === "prix" ? "Prix de vente forcé" : undefined);
    }
    if (t.matches("[data-vitrine]")) enregistrer("potions", { [t.dataset.vitrine]: { vitrine: t.checked } }, t.checked ? "Ajoutée à la vitrine" : "Retirée de la vitrine");
  });

  /* ---------- Corrections de stock : motif obligatoire, inscrites au journal ---------- */
  const CHAMPS_STOCK = ["stock", "stockEdmond", "stockCuisine"];
  function corrigerStock(col, id, champ, valeur) {
    const k = col + "|" + id + "|" + champ, v = col === "ingredients" ? ingV(id) : potV(id);
    if (!corr[k]) corr[k] = { col, article: id, champ, avant: +v[champ] || 0 };
    corr[k].valeur = Math.max(0, Math.round(valeur));
    const o = D[col][id] || (D[col][id] = {}); o[champ] = corr[k].valeur;
    if (corr[k].valeur === corr[k].avant) delete corr[k];
    majCorr();
  }
  function majCorr() {
    const L = Object.values(corr);
    $("#corr-barre").hidden = !L.length; document.body.classList.toggle("corr-ouverte", !!L.length);
    $("#corr-resume").innerHTML = L.length ? `<b>${L.length}</b> correction${L.length > 1 ? "s" : ""} de stock en attente : ` + L.slice(0, 3).map(c => esc((byIng[c.article] || byPot[c.article] || {}).nom || c.article) + " " + c.avant + " → " + c.valeur).join(", ") + (L.length > 3 ? "…" : "") : "";
  }
  $("#corr-annuler").onclick = () => {
    Object.values(corr).forEach(c => { const o = D[c.col][c.article] || {}; o[c.champ] = c.avant; });
    Object.keys(corr).forEach(k => delete corr[k]); $("#corr-motif").value = ""; majCorr(); renderTout();
  };
  $("#corr-ok").onclick = async () => {
    const motif = $("#corr-motif").value.trim(), L = Object.values(corr);
    if (!motif) { toast("Indiquez le motif de la correction.", true); $("#corr-motif").focus(); return; }
    if (!L.length) return;
    const lignes = L.map(c => ({ col: c.col, article: c.article, champ: c.champ, valeur: c.valeur }));
    Object.keys(corr).forEach(k => delete corr[k]); $("#corr-motif").value = ""; majCorr();
    enCours++; renderSync();
    try { const r = await appel({ action: "corriger", mdp: session.mdp, nom: session.nom, motif, lignes }); enCours--; if (!enCours) accepter(r); renderTout(); toast(lignes.length + " correction" + (lignes.length > 1 ? "s" : "") + " enregistrée" + (lignes.length > 1 ? "s" : "") + " (journal des stocks)"); }
    catch (err) { enCours--; toast((err.message || "Échec") + " — corrections annulées.", true); charger(true); }
  };
  $("#corr-motif").addEventListener("keydown", e => { if (e.key === "Enter") $("#corr-ok").click(); });

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
  // Carte UESP (tuiles « day » de gamemap.uesp.net, CC BY-SA) : 256 unités = tout le monde du jeu au zoom 0
  const MONDE = { gauche: -233600, haut: 208900, larg: 524600, haut2: 524900 };
  const versLL = (gx, gy) => [-(MONDE.haut - gy) / MONDE.haut2 * 256, (gx - MONDE.gauche) / MONDE.larg * 256];
  const versJeu = ll => ({ gx: Math.round(ll.lng / 256 * MONDE.larg + MONDE.gauche), gy: Math.round(MONDE.haut + ll.lat / 256 * MONDE.haut2) });
  const BORDS = [[-190, 0], [0, 240]];   // zone couverte par les tuiles
  let carte = null, calque = null, calqueNoms = null, calqueFrontieres = null, modeAjout = false, editId = null, posAjout = null;
  const imgIng = id => `images/ingredients/${id}.webp`;
  const ALCHIMIE = INGREDIENTS.filter(i => !i.cuisine);   // la carte ne concerne que les ingrédients alchimiques
  let masques = new Set(); try { masques = new Set(JSON.parse(localStorage.getItem("fiole-carte-masques") || "[]")); } catch (e) {}
  const garderMasques = () => { try { localStorage.setItem("fiole-carte-masques", JSON.stringify([...masques])); } catch (e) {} };

  function initCarte() {
    if (carte || typeof L === "undefined") return;
    carte = L.map("carte", { crs: L.CRS.Simple, minZoom: 1, maxZoom: 9, zoomSnap: .5, zoomDelta: .5, wheelPxPerZoomLevel: 100, maxBounds: [[-215, -25], [25, 265]], maxBoundsViscosity: .8, attributionControl: true });
    L.tileLayer("https://maps.uesp.net/srmap/skyrim/leaflet/day/zoom{z}/skyrim-{x}-{y}.jpg", {
      tileSize: 256, minZoom: 1, maxZoom: 9, maxNativeZoom: 8, noWrap: true, bounds: BORDS,
      attribution: 'Carte : <a href="https://gamemap.uesp.net/sr/" target="_blank" rel="noopener">UESP</a> (CC BY-SA)'
    }).addTo(carte);
    carte.attributionControl.setPrefix(false);
    carte.fitBounds([[-170, 10], [-15, 230]]);
    // Frontières des châtelleries : tracées par Aldéric (« Définir les frontières »)
    calqueFrontieres = L.layerGroup();
    if ($("#k-frontieres").checked) calqueFrontieres.addTo(carte);
    renderFrontieres();
    calqueNoms = L.layerGroup();
    LIEUX_SKYRIM.forEach(([nom, gx, gy, t]) => L.marker(versLL(gx, gy), { interactive: false, keyboard: false,
      icon: L.divIcon({ className: "k-nom k-nom-" + t, html: `<span>${esc(nom)}</span>`, iconSize: [0, 0] }) }).addTo(calqueNoms));
    if ($("#k-noms").checked) calqueNoms.addTo(carte);
    const majNoms = () => $("#carte").classList.toggle("zoom-proche", carte.getZoom() >= 4);
    carte.on("zoomend", majNoms); majNoms();
    calque = L.layerGroup().addTo(carte);
    carte.on("click", ev => {
      if (!modeAjout) return;
      finAjout();
      posAjout = versJeu(ev.latlng);
      if (ev.latlng.lat < BORDS[0][0] || ev.latlng.lat > 0 || ev.latlng.lng < 0 || ev.latlng.lng > BORDS[1][1]) { toast("Placez le point sur la carte.", true); return; }
      ouvrirLieu(null);
    });
    setTimeout(() => carte.invalidateSize(), 50);
    document.dispatchEvent(new Event("fiole-carte-prete"));
    renderCarte();
  }
  $("#k-frontieres").onchange = () => { if (calqueFrontieres) $("#k-frontieres").checked || editFront ? calqueFrontieres.addTo(carte) : calqueFrontieres.remove(); };

  /* ----- Frontières des châtelleries, tracées et modifiées par Aldéric -----
     Collection « carte » : frontiere-<id> {type:"frontiere", chatellerie, points:[[x, y]…] (coordonnées du jeu)}
     Mode « Définir les frontières » : tracer (clic par clic, clic sur le premier point pour fermer),
     déplacer un sommet (glisser), en ajouter (glisser un point du milieu), en retirer (clic droit),
     changer la châtellerie ou supprimer une frontière (clic sur la frontière). Outil : Leaflet-Geoman. */
  const COULEURS_CHAT = { "Haafingar": "#d24a55", "Hjaalmarche": "#f2a25c", "la Crevasse": "#6f9e55", "Blancherive": "#d6c93f", "Épervine": "#b5683f",
    "le Clos": "#c08a8a", "Fortdhiver": "#8fdcef", "Estemarche": "#3a98c8", "la Brèche": "#b25fc6" };
  const couleurChat = c => COULEURS_CHAT[c] || "#2b2b2b";
  let editFront = false;
  const frontieres = () => Object.keys(D.carte || {}).filter(id => D.carte[id] && D.carte[id].type === "frontiere" && Array.isArray(D.carte[id].points) && D.carte[id].points.length >= 3)
    .map(id => Object.assign({ id }, D.carte[id]));
  $("#k-front-chat").innerHTML = CHATELLERIES.map(c => `<option>${esc(c)}</option>`).join("");
  const ptsDe = layer => (layer.getLatLngs()[0] || []).map(ll => { const g = versJeu(ll); return [g.gx, g.gy]; });
  function renderFrontieres() {
    if (!carte || !calqueFrontieres) return;
    calqueFrontieres.clearLayers();
    frontieres().forEach(f => {
      const ll = f.points.map(([x, y]) => versLL(x, y)), col = couleurChat(f.chatellerie);
      if (!editFront) {
        L.polygon(ll, { interactive: false, fill: false, color: "#1d140c", weight: 5, opacity: .45 }).addTo(calqueFrontieres);
        L.polygon(ll, { interactive: false, fill: false, color: col, weight: 2.5, opacity: .95 }).addTo(calqueFrontieres);
        return;
      }
      const pg = L.polygon(ll, { color: col, weight: 3, fillColor: col, fillOpacity: .1 }).addTo(calqueFrontieres);
      pg._frontId = f.id;
      pg.bindPopup(() => `<div class="pop"><h4>Frontière : ${esc(f.chatellerie || "?")}</h4>
        <label class="mute" style="font-size:.85rem">Châtellerie <select class="champ" data-front-chat="${f.id}">${CHATELLERIES.map(c => `<option${c === f.chatellerie ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
        <p class="mute" style="font-size:.8rem;margin:6px 0">Glissez un sommet pour le déplacer, un point du milieu pour en ajouter un ; clic droit sur un sommet pour le retirer.</p>
        <div class="actions"><button class="btn-sobre btn-petit" type="button" data-front-del="${f.id}">Supprimer cette frontière</button></div></div>`);
      if (pg.pm) { pg.pm.enable({ allowSelfIntersection: true, snappable: false, draggable: false });
        pg.on("pm:edit", () => enregistrer("carte", { [f.id]: { points: ptsDe(pg) } }, "Frontière modifiée")); }
    });
  }
  const chargerGeoman = () => window.L && L.PM ? Promise.resolve() : new Promise((ok, ko) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css"; document.head.appendChild(css);
    const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.min.js"; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
  async function modeFrontieres(on) {
    if (on && !editeurCarte()) return;
    if (on) {
      try { await chargerGeoman(); } catch (e) { toast("L'outil de tracé n'a pas pu se charger (connexion ?).", true); return; }
      if (!carte.pm) carte.pm = new L.PM.Map(carte);
      try { carte.pm.setLang("fr"); } catch (e) {}
      if (modeAjout) finAjout();
    } else if (carte && carte.pm) carte.pm.disableDraw();
    editFront = on; document.body.classList.toggle("front-edit", on);
    $("#k-front-panneau").hidden = !on; $("#k-front-edit").textContent = on ? "Terminer les frontières" : "Définir les frontières";
    $("#k-ajouter").disabled = on;
    if (on && !calqueFrontieres._map) calqueFrontieres.addTo(carte);
    if (!on && !$("#k-frontieres").checked) calqueFrontieres.remove();
    renderCarte();
  }
  $("#k-front-edit").onclick = () => modeFrontieres(!editFront);
  $("#k-front-tracer").onclick = () => {
    if (!editFront || !carte.pm) return; carte.closePopup();
    carte.pm.enableDraw("Polygon", { snappable: false, allowSelfIntersection: true, pathOptions: { color: couleurChat($("#k-front-chat").value), weight: 3, fillOpacity: .1 } });
    toast("Cliquez point par point le long de la frontière, puis sur le premier point pour la fermer (Échap pour annuler)");
  };
  // Une frontière tracée : enregistrée avec la châtellerie choisie (le tracé provisoire est remplacé par la version enregistrée)
  document.addEventListener("fiole-carte-prete", () => carte.on("pm:create", e => {
    const pts = ptsDe(e.layer); e.layer.remove(); if (pts.length < 3) return;
    const id = "frontiere-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    enregistrer("carte", { [id]: { type: "frontiere", chatellerie: $("#k-front-chat").value, points: pts, auteur: session.nom, cree: new Date().toISOString() } }, "Frontière ajoutée : " + $("#k-front-chat").value);
  }));
  document.addEventListener("change", e => { const s = e.target.closest("[data-front-chat]"); if (!s || !editeurCarte()) return;
    enregistrer("carte", { [s.dataset.frontChat]: { chatellerie: s.value } }, "Frontière : " + s.value); carte.closePopup(); });
  document.addEventListener("click", e => { const d = e.target.closest("[data-front-del]"); if (!d || !editeurCarte()) return;
    if (!confirm("Supprimer cette frontière ?")) return; carte.closePopup(); enregistrer("carte", { [d.dataset.frontDel]: null }, "Frontière supprimée"); });
  $("#k-noms").onchange = () => { if (calqueNoms) $("#k-noms").checked ? calqueNoms.addTo(carte) : calqueNoms.remove(); };
  const finAjout = () => { modeAjout = false; document.body.classList.remove("mode-ajout"); $("#k-ajouter").textContent = "+ Ajouter un point"; };
  const visibleIng = p => { const ings = (p.ingredients || []).filter(id => byIng[id]); return p.type === "boutique" || !ings.length || ings.some(id => !masques.has(id)); };
  function filtrePoints() {
    const mots = norm($("#k-recherche").value).split(/\s+/).filter(Boolean);
    return points().filter(p => visibleIng(p) &&
      mots.every(m => norm(p.titre + " " + (p.chatellerie || "") + " " + (p.note || "") + " " + (p.ingredients || []).map(id => byIng[id] ? byIng[id].nom + " " + (byIng[id].en || "") : "").join(" ")).includes(m)));
  }
  function popupHtml(p) {
    const ings = (p.ingredients || []).filter(id => byIng[id]);
    return `<div class="pop"><h4>${esc(p.titre)}</h4>${p.chatellerie ? `<div class="lieu">${esc(p.chatellerie)}</div>` : ""}
      ${p.accord ? `<div class="accord-txt">${esc(p.accordTexte || "Accord de la châtellerie requis")}</div>` : ""}
      ${ings.length ? `<ul>${ings.map(id => `<li><img src="${imgIng(id)}" alt="">${esc(byIng[id].nom)}${byIng[id].en ? ` <span class="en">${esc(byIng[id].en)}</span>` : ""}</li>`).join("")}</ul>` : ""}
      ${p.note ? `<p style="margin:6px 0 0;font-size:.9rem">${esc(p.note)}</p>` : ""}
      ${p.auteur ? `<p class="mute" style="margin:6px 0 0;font-size:.8rem">Placé par ${esc(p.auteur)}</p>` : ""}
      ${editeurCarte() ? `<div class="actions"><button class="btn-sobre btn-petit" type="button" data-pt-edit="${p.id}">Modifier</button>
      <button class="btn-sobre btn-petit" type="button" data-pt-move="${p.id}">Déplacer</button>
      <button class="btn-sobre btn-petit" type="button" data-pt-del="${p.id}">Supprimer</button></div>` : ""}</div>`;
  }
  function renderCarte() {
    if (!accesCarte()) return;
    // Panneau des ingrédients (comme Map Genie) : un interrupteur par ingrédient alchimique présent sur la carte
    const tous = points(), compte = {};
    tous.forEach(p => (p.ingredients || []).forEach(id => compte[id] = (compte[id] || 0) + 1));
    const presents = ALCHIMIE.filter(i => compte[i.id]).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    $("#k-ings").innerHTML = presents.map(i => `<li class="${masques.has(i.id) ? "masque" : ""}"><label><input type="checkbox" data-k-ing="${i.id}" ${masques.has(i.id) ? "" : "checked"}>
        <img src="${imgIng(i.id)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(i.nom)}</span><b>${compte[i.id]}</b></label></li>`).join("")
      || `<li class="mute">Aucun ingrédient placé pour le moment.</li>`;
    const liste = filtrePoints();
    $("#k-aide").textContent = editeurCarte()
      ? "« + Ajouter un point », puis cliquez sur la carte à l'endroit voulu et choisissez l'ingrédient. Cliquez sur un point pour le modifier, le déplacer ou le supprimer."
      : "Cliquez sur un point pour voir ce qu'on y récolte. Les points sont placés et tenus à jour par Aldéric.";
    $("#k-n").textContent = "(" + liste.length + (liste.length !== tous.length ? " / " + tous.length : "") + ")";
    $("#k-liste").innerHTML = liste.sort((a, b) => a.titre.localeCompare(b.titre, "fr")).map(p => { const i0 = (p.ingredients || []).find(id => byIng[id]);
      return `<li data-pt="${p.id}">${i0 ? `<img src="${imgIng(i0)}" alt="">` : ""}<span>${p.accord ? `<b class="rouge">!</b> ` : ""}${esc(p.titre)}${p.chatellerie ? ` <span class="mute">· ${esc(p.chatellerie)}</span>` : ""}</span></li>`; }).join("")
      || `<li class="mute">${tous.length ? "Aucun point pour cette sélection." : "Aucun point pour le moment."}</li>`;
    if (!carte) return;
    renderFrontieres();
    calque.clearLayers();
    liste.forEach(p => {
      if (p.gx == null) return;
      const ings = (p.ingredients || []).filter(id => byIng[id]), vus = ings.filter(id => !masques.has(id)), i0 = vus[0] || ings[0];
      const html = `<div class="sceau-ing${p.accord ? " accord" : ""}${p.type === "boutique" ? " boutique" : ""}">${p.type === "boutique" ? `<svg viewBox="0 0 40 40" width="26" height="26" style="transform:rotate(45deg)"><path d="M16 5h8M17 5v9.5L8.5 29.5A5 5 0 0 0 13 37h14a5 5 0 0 0 4.5-7.5L23 14.5V5" fill="none" stroke="#6e4c30" stroke-width="2.4" stroke-linejoin="round"/><path d="M11 27.5h18l1.6 2.8A3.3 3.3 0 0 1 27.7 35H12.3a3.3 3.3 0 0 1-2.9-4.7Z" fill="#3d7444"/></svg>` : i0 ? `<img src="${imgIng(i0)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'✿'}))">` : "<span>✿</span>"}${ings.length > 1 ? `<b>+${ings.length - 1}</b>` : ""}</div>`;
      const ic = L.divIcon({ className: "", html, iconSize: [36, 36], iconAnchor: [18, 42], popupAnchor: [0, -40] });
      const m = L.marker(versLL(p.gx, p.gy), { icon: ic, title: p.titre, riseOnHover: true, interactive: !editFront }).addTo(calque).bindPopup(popupHtml(p), { maxWidth: 300 });
      m._fioleId = p.id;
    });
  }
  $("#k-recherche").addEventListener("input", renderCarte);
  $("#k-ings").addEventListener("change", e => { const c = e.target.closest("[data-k-ing]"); if (!c) return; c.checked ? masques.delete(c.dataset.kIng) : masques.add(c.dataset.kIng); garderMasques(); renderCarte(); });
  $("#k-tout").onclick = () => { masques.clear(); garderMasques(); renderCarte(); };
  $("#k-rien").onclick = () => { ALCHIMIE.forEach(i => masques.add(i.id)); garderMasques(); renderCarte(); };
  $("#k-ajouter").onclick = () => {
    if (!editeurCarte() || editFront) return;
    if (modeAjout) { finAjout(); return; }
    modeAjout = true; document.body.classList.add("mode-ajout"); $("#k-ajouter").textContent = "Annuler l'ajout";
    if (carte) carte.closePopup();
    toast("Cliquez sur la carte à l'endroit du nouveau point");
  };
  // Carte agrandie (plein écran, comme une fenêtre) : même carte, déplacée en superposition
  function pleinEcran(on) {
    $("#carte-zone").classList.toggle("plein", on); document.body.classList.toggle("carte-plein", on);
    $("#k-plein").textContent = on ? "Réduire la carte" : "Agrandir la carte";
    if (carte) setTimeout(() => { const c = carte.getCenter(); carte.invalidateSize(); carte.setView(c, carte.getZoom(), { animate: false }); }, 60);
  }
  $("#k-plein").onclick = () => pleinEcran(!$("#carte-zone").classList.contains("plein"));
  $("#k-fermer").onclick = () => pleinEcran(false);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !$("#carte-zone").classList.contains("plein") || !$("#f-lieu").hidden || editFront) return;
    if (modeAjout) finAjout(); else pleinEcran(false);
  });
  document.addEventListener("click", e => {
    const li = e.target.closest("[data-pt]");
    if (li && carte) {
      const p = points().find(x => x.id === li.dataset.pt); if (!p || p.gx == null) return;
      carte.setView(versLL(p.gx, p.gy), Math.max(carte.getZoom(), 5));
      calque.eachLayer(m => { if (m._fioleId === p.id) m.openPopup(); });
      return;
    }
    if (!editeurCarte()) return;
    const ed = e.target.closest("[data-pt-edit]"); if (ed) { ouvrirLieu(ed.dataset.ptEdit); return; }
    const del = e.target.closest("[data-pt-del]");
    if (del) {
      const id = del.dataset.ptDel, p = points().find(x => x.id === id);
      if (!confirm("Supprimer le point « " + (p ? p.titre : id) + " » de la carte ?")) return;
      carte.closePopup();
      enregistrer("carte", { [id]: CARTE_DEPART.some(x => x.id === id) ? { supprime: true } : null }, "Point supprimé");
      return;
    }
    const mv = e.target.closest("[data-pt-move]");
    if (mv) {
      const id = mv.dataset.ptMove; carte.closePopup();
      calque.eachLayer(m => {
        if (m._fioleId !== id) return;
        m.dragging.enable(); m.getElement().classList.add("deplace"); toast("Faites glisser le point à sa nouvelle place");
        m.once("dragend", ev => enregistrer("carte", { [id]: versJeu(ev.target.getLatLng()) }, "Point déplacé"));
      });
    }
  });

  // Fenêtre d'un point : choix de l'ingrédient (recherche + images), puis infos facultatives
  let choixLieu = [];
  function renderChoixLieu() {
    const q = norm($("#f-lieu-filtre").value).trim();
    const L2 = ALCHIMIE.filter(i => !q || norm(i.nom + " " + (i.en || "")).includes(q)).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    $("#f-lieu-ing").innerHTML = L2.slice(0, 120).map(i => `<button type="button" class="ing-choix${choixLieu.includes(i.id) ? " choisi" : ""}" data-choix="${i.id}"><img src="${imgIng(i.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${esc(i.nom)}${i.en ? `<small>${esc(i.en)}</small>` : ""}</span></button>`).join("")
      + (L2.length > 120 ? `<p class="mute" style="grid-column:1/-1">… ${L2.length - 120} autres : affinez la recherche.</p>` : "") || `<p class="mute">Aucun ingrédient ne correspond.</p>`;
    $("#f-lieu-choisis").innerHTML = choixLieu.length ? choixLieu.map(id => `<span class="puce-ing"><img src="${imgIng(id)}" alt="">${esc(byIng[id].nom)}<button type="button" data-retire="${id}" aria-label="Retirer">✕</button></span>`).join("")
      : `<span class="mute">Aucun ingrédient choisi.</span>`;
  }
  function ouvrirLieu(id) {
    if (!editeurCarte()) return;
    editId = id;
    const p = id ? points().find(x => x.id === id) : { ingredients: [] };
    const f = $("#form-lieu");
    $("#f-lieu-titre").textContent = id ? "Modifier le point" : "Nouveau point de récolte";
    f.titre.value = id ? (Object.assign({}, CARTE_DEPART.find(x => x.id === id), D.carte[id]).titre || "") : ""; f.chatellerie.innerHTML = `<option value="">—</option>` + CHATELLERIES.map(c => `<option${c === p.chatellerie ? " selected" : ""}>${esc(c)}</option>`).join("");
    f.accord.checked = !!p.accord; f.accordTexte.value = p.accordTexte || ""; f.note.value = p.note || ""; $("#f-lieu-filtre").value = "";
    choixLieu = (p.ingredients || []).filter(x => byIng[x]);
    renderChoixLieu();
    if (carte) carte.closePopup();
    ouvrirF("#f-lieu");
    setTimeout(() => $("#f-lieu-filtre").focus(), 50);
  }
  $("#f-lieu-filtre").addEventListener("input", renderChoixLieu);
  $("#f-lieu-filtre").addEventListener("keydown", e => { if (e.key !== "Enter") return; e.preventDefault(); const b = $("#f-lieu-ing [data-choix]"); if (b) b.click(); });
  $("#f-lieu").addEventListener("click", e => {
    const b = e.target.closest("[data-choix]"), r = e.target.closest("[data-retire]");
    if (b) { const id = b.dataset.choix; choixLieu = choixLieu.includes(id) ? choixLieu.filter(x => x !== id) : [...choixLieu, id]; $("#f-lieu-filtre").value = ""; renderChoixLieu(); $("#f-lieu-filtre").focus(); }
    if (r) { choixLieu = choixLieu.filter(x => x !== r.dataset.retire); renderChoixLieu(); }
  });
  $("#form-lieu").onsubmit = e => {
    e.preventDefault(); const f = e.target;
    if (!choixLieu.length) { toast("Choisissez au moins un ingrédient.", true); $("#f-lieu-filtre").focus(); return; }
    const o = { titre: f.titre.value.trim(), chatellerie: f.chatellerie.value, accord: f.accord.checked, accordTexte: f.accordTexte.value.trim(), note: f.note.value.trim(), ingredients: choixLieu.slice() };
    let id = editId;
    if (!id) { id = "pt-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); Object.assign(o, posAjout, { auteur: session.nom, cree: new Date().toISOString() }); }
    enregistrer("carte", { [id]: o }, editId ? "Point modifié" : "Point ajouté");
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
  // Taux de la partie (alchimie / cuisine) ; les septims d'arrondi vont à l'Eau Noire
  const TX = d => TAUX[d === "cuisine" ? "cuisine" : "alchimie"];
  // Ventes enregistrées avant la date de bascule : ancien partage
  const BASCULE = new Date(BASCULE_TAUX).getTime();
  const quandVente = v => { const t = Date.parse(v.cree || ""); return isNaN(t) ? Date.parse((v.date || "") + "T12:00:00") : t; };
  const ancienTaux = v => !!v && quandVente(v) < BASCULE;
  const tauxDe = (d, v) => (ancienTaux(v) ? TAUX_AVANT : TAUX)[d === "cuisine" ? "cuisine" : "alchimie"];
  function parts(total, d, vente) {
    const t = tauxDe(d, vente), c = cts(total), v = sept(c, t.vendeur), g = sept(c, t.responsable), b = sept(c, t.boutique);
    return { total: c / 100, vendeur: v / 100, gerante: g / 100, boutique: b / 100, forge: (c - v - g - b) / 100 };
  }
  const LIB = d => PARTAGE[d === "cuisine" ? "cuisine" : "alchimie"];
  const totalVente = v => (v.qte || 0) * (v.prix || 0);
  const cumul = a => a.reduce((s, v) => { const p = parts(totalVente(v), domaineMouv(v), v);
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
      <div class="part vendeur"><span>${esc(PARTAGE.vendeur)}s · ${TX(tresorDom).vendeur} %</span><strong>${nb(c.vendeur)}</strong></div>
      ${TX(tresorDom).responsable || c.gerante > 0 ? `<div class="part gerante"><span>${esc(LIB(tresorDom).responsable)} · ${TX(tresorDom).responsable ? TX(tresorDom).responsable + " %" : "ancien taux"}</span><strong>${nb(c.gerante)}</strong></div>` : ""}
      <div class="part boutique"><span>${esc(LIB(tresorDom).boutique)} · ${TX(tresorDom).boutique} %</span><strong>${nb(c.boutique)}</strong></div>
      <div class="part forge"><span>${esc(PARTAGE.forge)} · ${TX(tresorDom).forge} %</span><strong>${nb(c.forge)}</strong></div>
    </div>`;
  const parVendeur = a => { const o = {}; a.forEach(v => { const k = v.vendeur || "—"; o[k] = (o[k] || 0) + parts(totalVente(v), domaineMouv(v), v).vendeur; });
    return Object.entries(o).sort((x, y) => y[1] - x[1]); };


  const totalAchat = a => Math.round((a.qte || 0) * (a.prix || 0) * 100) / 100;
  const somme = l => l.reduce((s, a) => s + totalAchat(a), 0);
  let tresorDom = "alchimie", tresorVue = "ventes", tresorQui = null, vueOffre = "ouverte";
  // Ventes, ajouts et retraits : chacun dans SON onglet (Elvara/Amaury en alchimie, Edmond en cuisine, employés partout)
  // Les employés (Aldéric, Roland) travaillent pour la Fiole (alchimie)
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
    $("#t-vente-pack").hidden = !moi || !packs().length;
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
        <div class="bloc cadre tresor-boutique lis ${lisD} ${tresorBoutique < 0 ? "rupture" : ""}" title="${TX(d).boutique} % de toutes les ventes de cette partie, moins tous ses achats (depuis le début)"><strong>${nb(tresorBoutique)}</strong><span>${M} — ${nomTresor.replace("Trésorerie", "trésorerie")}</span></div>`;
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
      <div class="bloc cadre lis lis-vendeur"><strong>${nb(cm.vendeur)}</strong><span>${M} gardés (${TX(d).vendeur} %) — ${fmtMois(mc)}</span></div>`;
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
  const detailLigne = m => `${m.packNom ? `<span class="tag-pack" title="Vendu dans un pack : part de ce produit dans le prix du pack">Pack « ${esc(m.packNom)} »${m.packQte > 1 ? " ×" + m.packQte : ""}</span> ` : ""}${typeVente(m)}${m.reserve === "edmond" ? " · stock d'Edmond" : m.type === "nourriture" ? " · stock de l'Eau Noire" : ""}`;
  const icone = m => imgArticle(m) ? `<img src="${imgArticle(m)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : "";
  function listeVentes(l, n, sup) {
    if (!l.length) return `<p class="vide">${n ? "Aucune vente pour cette sélection." : "Aucune vente enregistrée pour le moment."}</p>`;
    return parSemaines(l, (j, lj) => { const cj = cumul(lj);
      // Elvara (alchimie, 0 %) : pas de colonne, sauf pour les ventes d'avant la bascule
      const avecR = !!TX(tresorDom).responsable || cj.gerante > 0, nc = 8 + (avecR ? 1 : 0) + (sup ? 1 : 0);
      // Journée avec des ventes d'avant la bascule : on rappelle l'ancien taux sous le nouveau
      const avant = lj.some(ancienTaux), TA = TAUX_AVANT[tresorDom === "cuisine" ? "cuisine" : "alchimie"];
      const pc = k => `${TX(tresorDom)[k]} %` + (avant && TA[k] !== TX(tresorDom)[k] ? `<br>avant ${TA[k]} %` : "");
      const pcR = TX(tresorDom).responsable ? pc("responsable") : "avant " + TA.responsable + " %";
      return `<div class="jour">
      <div class="jour-tete"><h4>${esc(fmtJour(j))}</h4><span class="jour-total">Total du jour : <b>${nb(cj.total)} ${M}</b> · ${esc(LIB(tresorDom).boutique)} ${nb(cj.boutique)}</span></div>
      <div class="table-wrap"><table class="registre ventes${avecR ? "" : " sans-resp"}">
        <thead><tr><th class="ic"></th><th>Article</th><th class="num">Qté</th><th class="num">Prix u.</th><th class="num">Total</th><th class="num p-vendeur">${esc(PARTAGE.vendeur)}<small>${pc("vendeur")}</small></th>${avecR ? `<th class="num p-gerante">${esc(LIB(tresorDom).responsable)}<small>${pcR}</small></th>` : ""}<th class="num p-boutique">${esc(LIB(tresorDom).boutique)}<small>${pc("boutique")}</small></th><th class="num p-forge">${esc(PARTAGE.forge)}<small>${pc("forge")}</small></th>${sup ? "<th></th>" : ""}</tr></thead>
        ${parPersonne(lj, "vendeur").map(([nom, lp]) => { const cp = cumul(lp); return `<tbody class="groupe">
          <tr class="sous-tete"><td colspan="${nc}"><span class="qui">${esc(nom)}</span> · ${lp.length} vente${lp.length > 1 ? "s" : ""} · ${nb(cp.total)} ${M} · garde <b>${nb(cp.vendeur)} ${M}</b></td></tr>
          ${lp.map(v => { const p = parts(totalVente(v), domaineMouv(v), v); return `<tr class="${ancienTaux(v) ? "ancien-taux" : ""}" title="${ancienTaux(v) ? "Vente d'avant le 31 octobre 10 h : ancien partage (50 / 18 / 18 / 14 %)" : ""}">
          <td class="ic">${icone(v)}</td>
          <td class="nom">${nomLigne(v)}<small>${detailLigne(v)}${v.client ? " · client : " + esc(v.client) : ""}</small></td>
          <td class="num">${nb(v.qte)}</td><td class="num">${nb(v.prix)}</td><td class="num"><b>${nb(p.total)}</b></td>
          <td class="num p-vendeur">${nb(p.vendeur)}</td>${avecR ? `<td class="num p-gerante">${nb(p.gerante)}</td>` : ""}<td class="num p-boutique">${nb(p.boutique)}</td><td class="num p-forge">${nb(p.forge)}</td>
          ${sup ? `<td class="actions-ligne"><button class="btn-sobre btn-petit" type="button" data-vente-edit="${v.id}" title="Modifier cette vente">✎</button><button class="btn-sobre btn-petit" type="button" data-vente-del="${v.id}" title="Supprimer cette vente">✕</button></td>` : ""}</tr>`; }).join("")}</tbody>`; }).join("")}
        <tfoot><tr><td></td><td>Total du jour</td><td class="num">${nb(cj.n)}</td><td></td><td class="num"><b>${nb(cj.total)}</b></td>
          <td class="num p-vendeur"><b>${nb(cj.vendeur)}</b></td>${avecR ? `<td class="num p-gerante"><b>${nb(cj.gerante)}</b></td>` : ""}<td class="num p-boutique"><b>${nb(cj.boutique)}</b></td><td class="num p-forge"><b>${nb(cj.forge)}</b></td>${sup ? "<td></td>" : ""}</tr></tfoot>
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
    const mv = e.target.closest("[data-mvt-del]"); if (mv) { ouvrirSuppr("mouvements", mv.dataset.mvtDel); return; }
    const ve = e.target.closest("[data-vente-edit]"); if (ve) { ouvrirVenteEdit(ve.dataset.venteEdit); return; }
    const v = e.target.closest("[data-vente-del]"); if (v) { ouvrirSuppr("ventes", v.dataset.venteDel); return; }
    const a = e.target.closest("[data-achat-del]"); if (a) ouvrirSuppr("achats", a.dataset.achatDel);
  });

  /* ---------- Supprimer une ligne, en remettant (au choix) le stock ---------- */
  let suppr = null;
  function ouvrirSuppr(col, id) {
    const r = (D[col] || {})[id]; if (!r) return;
    suppr = { col, id };
    const nom = nomArticle(r), q = nb(r.qte || 0);
    const quoi = col === "ventes" ? "la vente" : col === "achats" ? "l'achat" : r.sens === "ajout" ? "l'ajout" : "le retrait";
    $("#f-suppr-titre").textContent = "Supprimer " + quoi;
    $("#f-suppr-detail").innerHTML = `<b>${esc(nom)}</b> ×${q} — ${esc(fmtJour(r.date || ""))}${r.vendeur || r.acheteur || r.par ? " · " + esc(r.vendeur || r.acheteur || r.par) : ""}`;
    const sansStock = col === "ventes" && r.stock === false;
    $("#f-suppr-case").hidden = sansStock;
    $("#f-suppr-remettre").checked = !sansStock;
    $("#f-suppr-lib").textContent = col === "ventes" || r.sens === "retrait" ? "Remettre " + q + " × " + nom + " dans le stock" : "Retirer " + q + " × " + nom + " du stock (annule l'entrée)";
    $("#f-suppr-note").textContent = sansStock ? "Cette vente n'avait pas retiré le stock : rien à remettre." : "La remise du stock est inscrite au journal des stocks.";
    ouvrirF("#f-suppr");
  }
  $("#f-suppr-ok").onclick = async () => {
    if (!suppr) return;
    const corps = { action: "supprimerLigne", mdp: session.mdp, nom: session.nom, collection: suppr.col, id: suppr.id, remettre: !$("#f-suppr-case").hidden && $("#f-suppr-remettre").checked };
    fermerF(); enCours++; renderSync();
    try { const r = await appel(corps); enCours--; if (!enCours) accepter(r); renderTout(); toast("Ligne supprimée" + (corps.remettre ? " et stock remis" : "")); }
    catch (err) { enCours--; toast(err.message || "Échec", true); charger(true); }
  };

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
      if (avant.stock !== false) bouger(avant.type, avant.article, avant.reserve, +avant.qte || 0);
      bouger(apres.type, apres.article, apres.reserve, -apres.qte);
      apres.stock = true; apres.motifStock = null;
    }
    fermerF();
    enregistrer("ventes", { [venteEdit.id]: apres }, "Vente modifiée");
    // L'écart de stock passe par une correction tracée au journal
    const lignes = [];
    ["potions", "ingredients"].forEach(col => Object.keys(stock[col]).forEach(article => Object.keys(stock[col][article]).forEach(champ => {
      const v = col === "ingredients" ? ingV(article) : potV(article); if ((+v[champ] || 0) !== stock[col][article][champ]) lignes.push({ col, article, champ, valeur: stock[col][article][champ] }); })));
    if (lignes.length) appel({ action: "corriger", mdp: session.mdp, nom: session.nom, motif: "Modification d'une vente du " + fmtJour(avant.date || aujourdhui()) + (avant.vendeur ? " (" + avant.vendeur + ")" : ""), lignes })
      .then(r => { if (!enCours) accepter(r); }).catch(err => toast(err.message || "Stock non corrigé", true));
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
  // Ingrédient dont le prix de vente a 2 chiffres après la virgule (ex. 0,15) : vendu par lot de 100
  const lotIng = id => { const c = Math.round((+ingV(id).prix || 0) * 100); return c % 10 !== 0 ? 100 : 1; };
  const lotDe = a => a && a.type === "ingredient" ? lotIng(a.article) : 1;
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
      const lot = mouv.genre === "vente" ? lotDe(a) : 1, q = Math.max(1, Math.round(+l.querySelector('[data-l="qte"]').value || 1));
      return Object.assign(a, { qte: lot > 1 ? Math.max(lot, Math.ceil(q / lot) * lot) : q,
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
    // Vente : retrait du stock obligatoire ; seuls Elvara, Amaury et Edmond peuvent le décocher (avec motif)
    f.stock.checked = true; f.stock.disabled = genre === "vente" && !responsable(); $("#f-mouv-motif-stock").hidden = true;
    $("#f-mouv-stock").textContent = T[2] + (genre === "vente" && !responsable() ? " (obligatoire)" : "");
    f.reserve.value = cuisinier() ? "edmond" : "eau-noire";
    $("#f-mouv-lignes").innerHTML = "";
    ouvrirF("#f-mouv"); ajouterLigne();
  }
  $("#t-vente").onclick = () => ouvrirMouv("vente");
  $("#form-mouv").stock.addEventListener("change", e => { $("#f-mouv-motif-stock").hidden = e.target.checked || mouv.genre !== "vente"; });
  $("#t-offre").onclick = () => ouvrirMouv("offre");
  $("#t-ajout").onclick = () => ouvrirMouv("ajout");
  $("#t-retrait").onclick = () => ouvrirMouv("retrait");
  $("#f-mouv-plus").onclick = ajouterLigne;
  $("#f-mouv-lignes").addEventListener("change", e => {
    const li = e.target.closest(".ligne-mouv");
    if (e.target.matches('[data-l="article"]')) li.querySelector('[data-l="prix"]').value = prixMouv(e.target.value);
    if (li && mouv.genre === "vente") {   // vente par lot de 100 : quantité arrondie au lot supérieur
      const lot = lotDe(decoder(li.querySelector('[data-l="article"]').value)), q = li.querySelector('[data-l="qte"]');
      q.step = lot; q.min = lot;
      if (lot > 1) q.value = Math.max(lot, Math.ceil((+q.value || 1) / lot) * lot);
      let n = li.querySelector(".lot-info"); if (!n) { n = document.createElement("small"); n.className = "lot-info"; li.appendChild(n); }
      n.textContent = lot > 1 ? `Vendu par lot de ${lot} : ${nb(Math.round(+li.querySelector('[data-l="prix"]').value * lot * 100) / 100)} ${M} le lot` : ""; n.hidden = lot <= 1;
    }
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
    if (g === "vente" && !stock && !f.motifStock.value.trim()) { toast("Indiquez pourquoi le stock n'est pas retiré.", true); f.motifStock.focus(); return; }
    const corps = { action: { vente: "vendre", achat: "acheter", ajout: "ajouter", retrait: "retirer" }[g], mdp: session.mdp, nom: session.nom, domaine: dom, date: f.date.value, tiers: f.tiers.value.trim(), lignes, stock, reserve, motifStock: stock ? "" : f.motifStock.value.trim() };
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
  const peutEN = () => responsable();   // gestion : stock, seuils, membres, métiers, parts de 15 septims
  const peutDistribuer = () => !!session;   // distributions (remises) : tout le monde, employés compris
  const peutAnnulerRemise = r => peutEN() || (!!session && norm(r.par || "") === norm(session.nom));
  // Articles attribués chaque semaine à un membre = somme des quotas de ses métiers (dom : filtre facultatif)
  function attribution(m, dom) {
    const o = {}, mets = Object.fromEntries(enMetiers().map(x => [x.id, x]));
    (m.metiers || []).forEach(id => { const q = (mets[id] || {}).quotas || {}; Object.keys(q).forEach(p => { if (byPot[p] && (!dom || domArt(p) === dom) && +q[p] > 0) o[p] = (o[p] || 0) + (+q[p] || 0); }); });
    return o;
  }
  const somme0 = o => Object.values(o).reduce((t, n) => t + n, 0);
  const PART_EN = 15;   // part hebdomadaire versée par chaque membre de l'Eau Noire
  const paiementDe = (m, sem) => enDe("paiement").find(r => r.membre === m.id && r.semaine === sem);
  const dtCourt = x => new Date(x).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  function etatPaiement(m, sem, retard) {
    const r = paiementDe(m, sem);
    if (r) return `<span class="etat ok en-paye" title="Validé par ${esc(r.par || "")}">Part de ${PART_EN} ${M} payée${r.retard ? " (en retard)" : ""} le ${dtCourt(r.date)}</span>${peutEN() ? ` <button class="btn-sobre btn-petit" type="button" data-en-impaye="${r.id}" title="Annuler le paiement">↺</button>` : ""}`;
    return peutEN() ? `<button class="btn-sobre btn-petit en-payer" type="button" data-en-payer="${m.id}" data-en-sem="${sem}">${retard ? "Paiement reçu" : `Part de ${PART_EN} ${M} payée`}</button>` : `<span class="mute">Part de ${PART_EN} ${M} à payer</span>`;
  }
  function payer(mid, semaine) {
    const m = D.eaunoire[mid], sem = semaine || lundi(aujourdhui()); if (!m || paiementDe(Object.assign({ id: mid }, m), sem)) return;
    const retard = sem !== lundi(aujourdhui());
    enregistrer("eaunoire", { [nvId("paiement")]: Object.assign({ type: "paiement", membre: mid, nom: m.nom, semaine: sem, montant: PART_EN, date: new Date().toISOString(), par: session.nom }, retard ? { retard: true } : {}) },
      "Part de " + PART_EN + " septims de " + m.nom + " validée" + (retard ? " (en retard)" : ""));
  }
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
    $("#en-ajout-metier").hidden = $("#en-ajout-membre").hidden = !peutEN();
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
        ${peutEN() ? `<div class="actions"><button class="btn-sobre btn-petit" type="button" data-en-metier="${m.id}">Modifier</button><button class="btn-sobre btn-petit" type="button" data-en-del="${m.id}">Supprimer</button></div>` : ""}
      </article>`; }).join("")
      : `<p class="vide">Aucun métier. Créez-en un avec « + Métier » et indiquez les potions et les plats attribués chaque semaine.</p>`;
    // Membres : personnes × articles attribués
    $("#en-semaine").textContent = "— " + fmtSemaine(sem).toLowerCase();
    const tri = (a, b) => byPot[a].nom.localeCompare(byPot[b].nom, "fr");
    const tous = [...new Set(Mb.flatMap(m => Object.keys(attribution(m))))];
    const cP = tous.filter(p => !estPlat(p)).sort(tri), cC = tous.filter(p => estPlat(p)).sort(tri), cols = [...cP, ...cC];
    const nomMet = Object.fromEntries(Mt.map(m => [m.id, m.nom]));
    const etatSem = (m, dom) => { const a = attribution(m, dom), t = somme0(a), r = remiseDe(m, sem, dom);
      if (r) return `<span class="etat ok" title="Remis par ${esc(r.par || "")}">${dom === "cuisine" ? "Plats remis" : "Potions remises"} le ${new Date(r.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>${peutAnnulerRemise(r) ? ` <button class="btn-sobre btn-petit" type="button" data-en-annuler="${r.id}" title="Annuler (retour dans le stock)">↺</button>` : ""}`;
      if (!t) return "";
      return peutDistribuer() ? `<button class="btn-sobre btn-petit en-r-${dom}" type="button" data-en-remettre="${m.id}" data-en-dom="${dom}">Remettre ${nb(t)} ${MOT[dom][t > 1 ? 1 : 0]}</button>` : `<span class="mute">${nb(t)} ${MOT[dom][t > 1 ? 1 : 0]} à remettre</span>`; };
    $("#en-membres").innerHTML = Mb.length ? `<thead>
      ${cols.length ? `<tr class="en-groupes"><th colspan="2"></th>${cP.length ? `<th colspan="${cP.length}" class="g-alchimie">Potions</th>` : ""}${cC.length ? `<th colspan="${cC.length}" class="g-cuisine">Plats</th>` : ""}<th colspan="3"></th></tr>` : ""}
      <tr><th>Membre</th><th>Métier(s)</th>${cols.map(p => `<th class="num en-col ${domArt(p)}" title="${esc(byPot[p].nom)}">${potIcone(p)}<small>${esc(byPot[p].nom)}</small></th>`).join("")}<th class="num">Total</th><th>Cette semaine</th><th></th></tr></thead>
      <tbody>${Mb.map(m => { const a = attribution(m), done = ["alchimie", "cuisine"].every(d => remiseDe(m, sem, d) || !somme0(attribution(m, d)));
        return `<tr class="${done && somme0(a) ? "en-servi" : ""}">
          <td class="nom">${esc(m.nom)}</td>
          <td>${(m.metiers || []).map(id => nomMet[id]).filter(Boolean).map(esc).join(", ") || `<span class="mute">—</span>`}</td>
          ${cols.map(p => `<td class="num ${domArt(p)}">${a[p] ? nb(a[p]) : `<span class="mute">·</span>`}</td>`).join("")}
          <td class="num"><b>${nb(somme0(a))}</b></td>
          <td><div class="en-sem">${etatSem(m, "alchimie")}${etatSem(m, "cuisine")}${etatPaiement(m, sem)}</div></td>
          <td class="actions-ligne">${peutEN() ? `<button class="btn-sobre btn-petit" type="button" data-en-membre="${m.id}" title="Modifier">✎</button><button class="btn-sobre btn-petit" type="button" data-en-del="${m.id}" title="Retirer de l'Eau Noire">✕</button>` : ""}</td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td colspan="2">Total par semaine</td>${cols.map(p => `<td class="num"><b>${nb(besoin[p] || 0)}</b></td>`).join("")}<td class="num"><b>${nb(somme0(besoin))}</b></td><td colspan="2"></td></tr></tfoot>`
      : `<tbody><tr><td class="vide">Aucun membre. Ajoutez les membres de l'Eau Noire avec « + Membre ».</td></tr></tbody>`;
    const nPaye = Mb.filter(m => paiementDe(m, sem)).length;
    $("#en-paiements").textContent = Mb.length ? `Parts de ${PART_EN} septims cette semaine : ${nPaye} / ${Mb.length} payée${Mb.length > 1 ? "s" : ""} (${nb(nPaye * PART_EN)} ${M} reçus)` : "";
    renderHistoriqueEN(Mb, sem);
    // Boutons du bas : remettre à tous les membres pas encore servis cette semaine
    ["alchimie", "cuisine"].forEach(dom => {
      const b = $(dom === "cuisine" ? "#en-remettre-plats" : "#en-remettre-potions"), reste = Mb.filter(m => !remiseDe(m, sem, dom) && somme0(attribution(m, dom)));
      b.hidden = !peutDistribuer(); b.disabled = !reste.length;
      b.textContent = (dom === "cuisine" ? "Remettre les plats" : "Remettre les potions") + (reste.length ? " (" + reste.length + " membre" + (reste.length > 1 ? "s" : "") + ")" : " — tout est remis");
    });
  }

  // Historique : semaines passées (depuis la mise en service de l'onglet), membres servis / non servis.
  // Les parts sont calculées avec les métiers actuels ; un membre ne compte qu'à partir de la semaine de son ajout.
  const EN_DEBUT = "2026-10-26", EN_SEMAINES = 12;
  function renderHistoriqueEN(Mb, sem) {
    const debut = [EN_DEBUT, ...enDe("remise").map(r => r.semaine).filter(Boolean)].sort()[0], semaines = [];
    for (let d = new Date(sem + "T12:00:00"); semaines.length < EN_SEMAINES;) { d.setDate(d.getDate() - 7); const l = lundi(d.toISOString().slice(0, 10)); if (l < debut) break; semaines.push(l); }
    if (!semaines.length) { $("#en-historique").innerHTML = `<p class="vide">Aucune semaine passée pour le moment : l'historique commencera la semaine prochaine.</p>`; return; }
    const dt = x => new Date(x).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    $("#en-historique").innerHTML = semaines.map(s => {
      const presents = Mb.filter(m => { if (!m.cree) return true; const c = new Date(m.cree); return lundi(c.getFullYear() + "-" + String(c.getMonth() + 1).padStart(2, "0") + "-" + String(c.getDate()).padStart(2, "0")) <= s; });
      const doms = ["alchimie", "cuisine"].map(dom => { const dus = presents.filter(m => somme0(attribution(m, dom)));
        return { dom, servis: dus.filter(m => remiseDe(m, s, dom)), oublies: dus.filter(m => !remiseDe(m, s, dom)), dus }; });
      // remises de cette semaine pour des membres retirés depuis
      const anciennes = enDe("remise").filter(r => r.semaine === s && !Mb.some(m => m.id === r.membre));
      const nOubli = doms.reduce((t, d) => t + d.oublies.length, 0);
      const payes = presents.filter(m => paiementDe(m, s)), impayes = presents.filter(m => !paiementDe(m, s));
      const blocPaie = !presents.length ? "" : `<div class="en-h-dom lis lis-eau">
          <p class="en-sous">Parts de ${PART_EN} septims — ${payes.length} / ${presents.length} payées</p>
          ${impayes.length ? `<ul class="en-h-liste">${impayes.map(m => `<li><span class="etat rupture">Non payé</span> <b>${esc(m.nom)}</b>${peutEN() ? ` <button class="btn-sobre btn-petit" type="button" data-en-payer="${m.id}" data-en-sem="${s}">Paiement reçu</button>` : ""}</li>`).join("")}</ul>` : ""}
          ${payes.length ? `<p class="mute en-h-servis">Payé : ${payes.map(m => { const r = paiementDe(m, s); return esc(m.nom) + (r.retard ? ` (en retard, ${dtCourt(r.date)})` : ""); }).join(", ")}</p>` : ""}
        </div>`;
      const bloc = d => !d.dus.length ? "" : `<div class="en-h-dom lis lis-${d.dom === "cuisine" ? "marmite" : "fiole"}">
          <p class="en-sous">${d.dom === "cuisine" ? "Plats" : "Potions"} — ${d.servis.length} / ${d.dus.length} servis</p>
          ${d.oublies.length ? `<ul class="en-h-liste">${d.oublies.map(m => { const t = somme0(attribution(m, d.dom));
            return `<li><span class="etat rupture">Pas reçu</span> <b>${esc(m.nom)}</b> <span class="mute">${nb(t)} ${MOT[d.dom][t > 1 ? 1 : 0]}</span>${peutDistribuer() ? ` <button class="btn-sobre btn-petit" type="button" data-en-tard="${m.id}" data-en-dom="${d.dom}" data-en-sem="${s}">Distribution faite</button>` : ""}</li>`; }).join("")}</ul>` : ""}
          ${d.servis.length ? `<p class="mute en-h-servis">Servis : ${d.servis.map(m => { const r = remiseDe(m, s, d.dom); return esc(m.nom) + (r.retard ? ` <span title="Remis en retard le ${dt(r.date)} par ${esc(r.par || "")}">(en retard, ${dt(r.date)})</span>` : ""); }).join(", ")}</p>` : ""}
        </div>`;
      return `<details class="en-h-sem cadre" ${nOubli || impayes.length ? "open" : ""}>
        <summary><b>${esc(fmtSemaine(s))}</b> ${nOubli ? `<span class="etat rupture">${nOubli} part${nOubli > 1 ? "s" : ""} non reçue${nOubli > 1 ? "s" : ""}</span>` : `<span class="etat ok">Tout le monde a été servi</span>`}
          ${impayes.length ? `<span class="etat bas">${impayes.length} paiement${impayes.length > 1 ? "s" : ""} de ${PART_EN} ${M} manquant${impayes.length > 1 ? "s" : ""}</span>` : presents.length ? `<span class="etat ok">Tous les paiements reçus</span>` : ""}</summary>
        <div class="en-h-corps">${doms.map(bloc).join("") || `<p class="mute">Aucune part attribuée cette semaine-là.</p>`}${blocPaie}
        ${anciennes.length ? `<p class="mute en-h-servis">Anciens membres servis : ${anciennes.map(r => esc(r.nom || "?")).join(", ")}</p>` : ""}</div>
      </details>`; }).join("");
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-en-tard]"); if (b) remettre([b.dataset.enTard], b.dataset.enDom, b.dataset.enSem);
    if (!peutEN()) return;
    const p = e.target.closest("[data-en-payer]"); if (p) payer(p.dataset.enPayer, p.dataset.enSem);
    const ip = e.target.closest("[data-en-impaye]");
    if (ip) { const r = D.eaunoire[ip.dataset.enImpaye]; if (r && confirm("Annuler le paiement de " + (r.nom || "ce membre") + " ?")) enregistrer("eaunoire", { [ip.dataset.enImpaye]: null }, "Paiement annulé"); } });

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
    const del = peutEN() && e.target.closest("[data-en-del]");
    if (del) { const x = D.eaunoire[del.dataset.enDel] || {}, quoi = x.type === "membre" ? "Retirer " + x.nom + " de l'Eau Noire ?" : x.type === "metier" ? "Supprimer le métier « " + x.nom + " » ?" : "Retirer " + ((byPot[x.potion] || {}).nom || "cet article") + " du stock de l'Eau Noire ?";
      if (!confirm(quoi)) return;
      const ch = { [del.dataset.enDel]: null };
      if (x.type === "metier") enMembres().filter(m => (m.metiers || []).includes(del.dataset.enDel)).forEach(m => ch[m.id] = { metiers: m.metiers.filter(i => i !== del.dataset.enDel) });
      enregistrer("eaunoire", ch, x.type === "membre" ? "Membre retiré" : x.type === "metier" ? "Métier supprimé" : "Article retiré"); return; }
    const me = peutEN() && e.target.closest("[data-en-metier]"); if (me) { ouvrirMetier(me.dataset.enMetier); return; }
    const mb = peutEN() && e.target.closest("[data-en-membre]"); if (mb) { ouvrirMembre(mb.dataset.enMembre); return; }
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
    enregistrer("eaunoire", { [id]: Object.assign({ type: "membre", nom: f.nom.value.trim(), metiers }, membreId ? {} : { cree: new Date().toISOString() }) }, membreId ? "Membre modifié" : "Membre ajouté");
  };

  // Remise hebdomadaire (potions par Elvara, plats par Edmond) : les articles sortent
  // du stock de l'Eau Noire, et seulement de celui-là
  function remettre(mids, dom, semaine) {
    const sem = semaine || lundi(aujourdhui()), retard = sem !== lundi(aujourdhui()), ch = {}, total = {}, noms = [];
    mids.forEach(mid => {
      const m = Object.assign({ id: mid }, D.eaunoire[mid] || {}), lignes = attribution(m, dom);
      if (!somme0(lignes) || remiseDe(m, sem, dom)) return;
      noms.push(m.nom);
      ch[nvId("remise") + noms.length] = Object.assign({ type: "remise", domaine: dom, membre: mid, nom: m.nom, semaine: sem, date: new Date().toISOString(), lignes, par: session.nom }, retard ? { retard: true } : {});
      Object.keys(lignes).forEach(p => total[p] = (total[p] || 0) + lignes[p]);
    });
    if (!noms.length) return;
    const manque = Object.keys(total).filter(p => (+((D.eaunoire["stock-" + p] || {}).qte) || 0) < total[p]);
    const detail = Object.keys(total).map(p => "• " + byPot[p].nom + " ×" + total[p]).join("\n");
    if (!confirm("Remettre les " + MOT[dom][1] + " de la " + (retard ? fmtSemaine(sem).toLowerCase() + " (en retard)" : "semaine") + " à " + (noms.length > 3 ? noms.length + " membres" : noms.join(", ")) + " ?\n\n" + detail
      + (manque.length ? "\n\nAttention : stock insuffisant pour " + manque.map(p => byPot[p].nom).join(", ") + " (le stock restera à 0)." : ""))) return;
    Object.keys(total).forEach(p => { const { id, x } = stockEN(p); ch[id] = { type: "stock", potion: p, qte: Math.max(0, (+x.qte || 0) - total[p]), seuil: +x.seuil || 0 }; });
    enregistrer("eaunoire", ch, (dom === "cuisine" ? "Plats remis à " : "Potions remises à ") + (noms.length > 1 ? noms.length + " membres" : noms[0]) + (retard ? " (en retard)" : ""));
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
     LIVRE DES COMPTES (Elvara et Edmond) — collection « comptes » :
       reglage            {type:"reglage", loyer}
       loyer-<lundi>-<qui> {type:"loyer", semaine, qui, montant, date, par}       (part payée)
       en-<lundi>-<partie> {type:"eaunoire", semaine, partie, montant, date, par} (dû à l'Eau Noire, payé)
     ================================================================= */
  const LOYER_DEFAUT = 455, LIVRE_DEBUT = "2026-11-02", LIVRE_SEMAINES = 16;
  const ASSOCIES = [["Elvara", "alchimie"], ["Edmond", "cuisine"]];
  // Le loyer change à partir de la semaine en cours : les semaines passées gardent l'ancien montant
  const histoLoyer = () => (((D.comptes || {}).reglage || {}).historique || []).slice().sort((a, b) => a.depuis.localeCompare(b.depuis));
  const loyerDe = sem => { const h = histoLoyer().filter(x => x.depuis <= sem); return h.length ? +h[h.length - 1].loyer : LOYER_DEFAUT; };
  const loyerActuel = () => loyerDe(lundi(aujourdhui()));
  const enregistrementLivre = id => (D.comptes || {})[id];
  // Sommes dues à l'Eau Noire par une partie pour une semaine : la part « Eau Noire » de chacune de ses ventes
  const dueEauNoire = (sem, d) => Math.round(ventes().filter(v => domaineMouv(v) === d && v.date && lundi(v.date) === sem)
    .reduce((t, v) => t + parts(totalVente(v), d, v).forge, 0) * 100) / 100;
  function caseLivre(id, montant, quoi) {
    const r = enregistrementLivre(id);
    if (r) return `<span class="etat ok" title="Noté par ${esc(r.par || "")}">Payé le ${dtCourt(r.date)}</span> <button class="btn-sobre btn-petit" type="button" data-lc-annuler="${id}" title="Annuler">↺</button>`;
    return montant > 0 ? `<button class="btn-sobre btn-petit" type="button" data-lc-payer="${id}" data-lc-quoi="${esc(quoi)}" data-lc-montant="${montant}">Marquer payé</button>` : `<span class="mute">—</span>`;
  }
  function renderComptes() {
    if (!accesLivre()) return;
    const sem0 = lundi(aujourdhui()), loyer = loyerActuel(), demi = Math.round(loyer / 2 * 100) / 100;
    const demiDe = s => Math.round(loyerDe(s) / 2 * 100) / 100;
    if (document.activeElement !== $("#lc-loyer")) $("#lc-loyer").value = loyer;
    const semaines = [];
    for (let d = new Date(sem0 + "T12:00:00"); semaines.length < LIVRE_SEMAINES; d.setDate(d.getDate() - 7)) {
      const l = lundi(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
      if (l < LIVRE_DEBUT && semaines.length) break; semaines.push(l); }
    let resteLoyer = { Elvara: 0, Edmond: 0 }, resteEN = { alchimie: 0, cuisine: 0 };
    const lignes = semaines.map(s => {
      const enCours = s === sem0;
      const cl = ASSOCIES.map(([qui]) => { const id = "loyer-" + s + "-" + norm(qui), r = enregistrementLivre(id), m = r ? +r.montant : demiDe(s); if (!r) resteLoyer[qui] += m;
        return `<td class="num"><b>${nb(m)}</b> ${M}<div>${caseLivre(id, m, "Part du loyer de " + qui + " (" + fmtSemaine(s).toLowerCase() + ")")}</div></td>`; }).join("");
      const ce = ["alchimie", "cuisine"].map(d => { const id = "en-" + s + "-" + d, r = enregistrementLivre(id), m = r ? +r.montant : dueEauNoire(s, d); if (!r && !enCours) resteEN[d] += m;
        return `<td class="num"><b>${nb(m)}</b> ${M}${enCours && !r ? `<small class="mute"> en cours</small>` : ""}<div>${caseLivre(id, m, (d === "cuisine" ? "La Marmite" : "La Fiole") + " → Eau Noire (" + fmtSemaine(s).toLowerCase() + ")")}</div></td>`; }).join("");
      return `<tr class="${enCours ? "lc-courante" : ""}"><td><b>${esc(fmtSemaine(s))}</b>${enCours ? `<small class="mute">semaine en cours</small>` : ""}</td><td class="num">${nb(loyerDe(s))} ${M}</td>${cl}${ce}</tr>`; });
    $("#lc-table").innerHTML = `<thead>
      <tr class="en-groupes"><th colspan="2"></th><th colspan="2">Loyer (50 % chacun)</th><th colspan="2">Dû à l'Eau Noire en fin de semaine</th></tr>
      <tr><th>Semaine</th><th class="num">Loyer</th><th class="num lc-elvara">Elvara</th><th class="num lc-edmond">Edmond</th><th class="num g-alchimie">La Fiole</th><th class="num g-cuisine">La Marmite</th></tr></thead>
      <tbody>${lignes.join("")}</tbody>`;
    const r2 = x => Math.round(x * 100) / 100;
    $("#lc-resume").innerHTML = `
      <div class="bloc cadre"><strong>${nb(loyer)} ${M}</strong><span>de loyer par semaine · ${nb(demi)} chacun</span></div>
      <div class="bloc cadre lis lis-fiole ${resteLoyer.Elvara ? "bas" : ""}"><strong>${nb(r2(resteLoyer.Elvara))} ${M}</strong><span>de loyer restant à payer par Elvara</span></div>
      <div class="bloc cadre lis lis-marmite ${resteLoyer.Edmond ? "bas" : ""}"><strong>${nb(r2(resteLoyer.Edmond))} ${M}</strong><span>de loyer restant à payer par Edmond</span></div>
      <div class="bloc cadre lis lis-forge ${resteEN.alchimie + resteEN.cuisine ? "bas" : ""}"><strong>${nb(r2(resteEN.alchimie + resteEN.cuisine))} ${M}</strong><span>dus à l'Eau Noire (semaines terminées) : Fiole ${nb(r2(resteEN.alchimie))}, Marmite ${nb(r2(resteEN.cuisine))}</span></div>
      <div class="bloc cadre lis lis-forge"><strong>${nb(r2(dueEauNoire(sem0, "alchimie") + dueEauNoire(sem0, "cuisine")))} ${M}</strong><span>pour l'Eau Noire cette semaine (en cours)</span></div>`;
  }
  $("#lc-loyer").addEventListener("change", e => { if (!accesLivre()) return; const v = Math.max(0, Math.round(+e.target.value || 0));
    const sem = lundi(aujourdhui()), h = histoLoyer().filter(x => x.depuis !== sem); h.push({ depuis: sem, loyer: v });
    enregistrer("comptes", { reglage: { type: "reglage", historique: h } }, "Loyer fixé à " + v + " septims par semaine à partir de cette semaine"); });
  document.addEventListener("click", e => {
    if (!accesLivre()) return;
    const p = e.target.closest("[data-lc-payer]");
    if (p) { const id = p.dataset.lcPayer, [, sem] = id.match(/-(\d{4}-\d{2}-\d{2})-/) || [];
      const o = { semaine: sem, montant: +p.dataset.lcMontant, date: new Date().toISOString(), par: session.nom };
      if (id.startsWith("loyer-")) Object.assign(o, { type: "loyer", qui: ASSOCIES.find(([q]) => id.endsWith("-" + norm(q)))[0] });
      else Object.assign(o, { type: "eaunoire", partie: id.endsWith("-cuisine") ? "cuisine" : "alchimie" });
      enregistrer("comptes", { [id]: o }, p.dataset.lcQuoi + " : payé"); return; }
    const a = e.target.closest("[data-lc-annuler]");
    if (a && confirm("Annuler ce paiement ?")) enregistrer("comptes", { [a.dataset.lcAnnuler]: null }, "Paiement annulé");
  });

  /* =================================================================
     PACKS PROMO (Elvara, Amaury, Edmond) — collection « packs » :
     pack-<id> {nom, description, lignes:[{article, qte}], prix, vitrine, cree, par}
     ================================================================= */
  const packs = () => Object.keys(D.packs || {}).map(id => Object.assign({ id }, D.packs[id])).sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  const totalPack = lignes => Math.round((lignes || []).reduce((t, l) => t + (byPot[l.article] ? (+potV(l.article).prix || 0) * (+l.qte || 0) : 0), 0) * 100) / 100;
  // Packs proposés par un employé : valide:false tant qu'Elvara, Amaury ou Edmond ne l'ont pas validé
  const packValide = k => k.valide !== false;
  const packSien = k => !packValide(k) && !!session && norm(k.par || "") === norm(session.nom);
  const remiseTxt = (tot, prix) => tot > 0 ? Math.round((1 - prix / tot) * 100) : 0;
  function renderPacks() {
    const L = packs().sort((a, b) => packValide(a) - packValide(b));   // propositions à valider en premier
    $("#packs").innerHTML = L.length ? L.map(k => {
      const tot = totalPack(k.lignes), r = remiseTxt(tot, +k.prix || 0), ok = packValide(k), vis = ok && k.vitrine !== false;
      const actions = responsable()
        ? `<button class="btn-sobre btn-petit" type="button" data-pk-edit="${k.id}">Modifier</button>${ok ? `<button class="btn-sobre btn-petit" type="button" data-pk-vis="${k.id}">${vis ? "Masquer" : "Afficher"}</button>` : `<button class="btn btn-petit" type="button" data-pk-valider="${k.id}">Valider et mettre sur la vitrine</button>`}<button class="btn-sobre btn-petit" type="button" data-pk-del="${k.id}">${ok ? "Supprimer" : "Refuser"}</button>`
        : packSien(k) ? `<button class="btn-sobre btn-petit" type="button" data-pk-edit="${k.id}">Modifier</button><button class="btn-sobre btn-petit" type="button" data-pk-del="${k.id}">Supprimer</button>` : "";
      return `<article class="pack cadre lis ${vis ? "lis-fiole" : ""} ${ok ? "" : "pack-propose"}">
        <div class="pack-tete"><b>${esc(k.nom)}</b><span class="statut ${ok ? (vis ? "actif" : "expire") : "attente"}">${ok ? (vis ? "Sur la vitrine" : "Masqué") : "À valider"}</span></div>
        ${!ok ? `<p class="mute pack-par">Proposé par ${esc(k.par || "?")}${k.cree ? " le " + dtCourt(k.cree) : ""}</p>` : k.validePar ? `<p class="mute pack-par">Validé par ${esc(k.validePar)}</p>` : ""}
        ${k.description ? `<p class="pack-desc">${esc(k.description)}</p>` : ""}
        <ul class="pack-lignes">${(k.lignes || []).filter(l => byPot[l.article]).map(l => `<li class="${estPlat(l.article) ? "cuisine" : "alchimie"}"><img src="images/potions/${byPot[l.article].img}" alt=""><span>${esc(byPot[l.article].nom)}</span><b>×${nb(l.qte)}</b></li>`).join("")}</ul>
        <div class="pack-prix"><span class="ancien">${nb(tot)} ${M}</span><strong>${nb(k.prix)} ${M}</strong>${r > 0 ? `<span class="remise">−${r} %</span>` : r < 0 ? `<span class="remise neg">+${-r} %</span>` : ""}</div>
        ${actions ? `<div class="actions">${actions}</div>` : ""}
      </article>`; }).join("")
      : `<p class="vide">Aucun pack pour l'instant. Créez-en un avec « + Nouveau pack ».</p>`;
  }
  // Produits proposés : potions de la Fiole et plats de la Marmite (sans les objets interdits)
  const optionsPack = () => `<option value="">— Choisir —</option>` + CATS.filter(c => c !== "Nourriture").map(c => `<optgroup label="Fiole — ${esc(c)}">${POTIONS.filter(p => p.categorie === c && !p.interdit).map(p => `<option value="${p.id}">${libArt(p)}</option>`).join("")}</optgroup>`).join("")
    + [...new Set(POTIONS.filter(p => estPlat(p.id)).map(p => p.famille))].map(f => `<optgroup label="Marmite — ${esc(f)}">${POTIONS.filter(p => estPlat(p.id) && p.famille === f).map(p => `<option value="${p.id}">${libArt(p)}</option>`).join("")}</optgroup>`).join("");
  let packId = null, prixTouche = false;
  function lignePack(a, q) {
    const div = document.createElement("div"); div.className = "ligne-mouv pk-ligne";
    div.innerHTML = `<select class="champ" data-k="article" aria-label="Produit">${optionsPack()}</select>
      <input class="champ" type="number" min="1" step="1" value="${q || 1}" data-k="qte" aria-label="Quantité">
      <span class="pk-pu" data-k="pu"></span>
      <button class="btn-sobre btn-petit" type="button" data-k-suppr title="Retirer">✕</button>`;
    if (a) div.querySelector("select").value = a;
    $("#f-pack-lignes").appendChild(div);
  }
  const lignesPack = () => $$("#f-pack-lignes .ligne-mouv").map(l => ({ article: l.querySelector('[data-k="article"]').value, qte: Math.max(1, Math.round(+l.querySelector('[data-k="qte"]').value || 1)) })).filter(l => l.article);
  function majPack() {
    const f = $("#form-pack"), L = lignesPack(), tot = totalPack(L);
    $$("#f-pack-lignes .ligne-mouv").forEach(l => { const a = l.querySelector('[data-k="article"]').value; l.querySelector('[data-k="pu"]').textContent = a ? nb(potV(a).prix) + " " + M : ""; });
    $("#f-pack-total").textContent = nb(tot) + " " + M;
    if (!prixTouche) f.prix.value = tot || "";
    const pr = +String(f.prix.value).replace(",", ".") || 0, r = remiseTxt(tot, pr);
    $("#f-pack-remise").textContent = tot && pr ? (r > 0 ? "−" + r + " % (" + nb(Math.round((tot - pr) * 100) / 100) + " " + M + " d'économie)" : r < 0 ? "plus cher que les produits séparés" : "aucune") : "—";
  }
  function ouvrirPack(id) {
    packId = id; const k = id ? D.packs[id] : { nom: "", lignes: [], vitrine: true }, f = $("#form-pack");
    $("#f-pack-titre").textContent = id ? "Modifier le pack" : "Nouveau pack promo";
    f.nom.value = k.nom || ""; f.description.value = k.description || ""; f.vitrine.checked = k.vitrine !== false;
    // Employés : le pack est une proposition, la vitrine se décide à la validation
    f.vitrine.closest("label").hidden = !responsable() || (id && !packValide(k));
    $("#f-pack-propose").hidden = responsable();
    $("#f-pack-lignes").innerHTML = ""; (k.lignes || []).forEach(l => lignePack(l.article, l.qte)); if (!(k.lignes || []).length) lignePack();
    prixTouche = !!id; f.prix.value = id ? k.prix : "";
    majPack(); ouvrirF("#f-pack");
  }
  $("#pk-ajouter").onclick = () => ouvrirPack(null);
  $("#f-pack-plus").onclick = () => { lignePack(); majPack(); };
  $("#f-pack-lignes").addEventListener("click", e => { const b = e.target.closest("[data-k-suppr]"); if (b) { b.closest(".ligne-mouv").remove(); majPack(); } });
  $("#f-pack-lignes").addEventListener("change", majPack);
  $("#f-pack-lignes").addEventListener("input", majPack);
  $("#form-pack").prix.addEventListener("input", () => { prixTouche = true; majPack(); });
  $("#form-pack").onsubmit = e => {
    e.preventDefault(); const f = e.target, lignes = lignesPack();
    if (!lignes.length) { toast("Ajoutez au moins un produit au pack.", true); return; }
    // une même ligne choisie deux fois est regroupée
    const reg = []; lignes.forEach(l => { const x = reg.find(y => y.article === l.article); if (x) x.qte += l.qte; else reg.push(l); });
    const id = packId || "pack-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    const o = { nom: f.nom.value.trim(), description: f.description.value.trim(), lignes: reg, prix: Math.max(0, Math.round((+String(f.prix.value).replace(",", ".") || 0) * 100) / 100), vitrine: f.vitrine.checked };
    const propose = !responsable() || (packId && !packValide(D.packs[packId]));
    if (propose) Object.assign(o, { valide: false, vitrine: false });
    if (!packId) Object.assign(o, { cree: new Date().toISOString(), par: session.nom });
    fermerF();
    enregistrer("packs", { [id]: o }, propose ? (packId ? "Proposition modifiée" : "Pack proposé : Elvara, Amaury ou Edmond doivent le valider") : packId ? "Pack modifié" : "Pack créé" + (o.vitrine ? " : il apparaît sur la vitrine" : ""));
  };
  document.addEventListener("click", e => {
    const ed = e.target.closest("[data-pk-edit]"); if (ed) { ouvrirPack(ed.dataset.pkEdit); return; }
    const va = responsable() && e.target.closest("[data-pk-valider]");
    if (va) { enregistrer("packs", { [va.dataset.pkValider]: { valide: null, vitrine: true, validePar: session.nom } }, "Pack validé : il apparaît sur la vitrine"); return; }
    const vi = responsable() && e.target.closest("[data-pk-vis]"); if (vi) { const k = D.packs[vi.dataset.pkVis]; enregistrer("packs", { [vi.dataset.pkVis]: { vitrine: k.vitrine === false } }, k.vitrine === false ? "Pack affiché sur la vitrine" : "Pack masqué"); return; }
    const de = e.target.closest("[data-pk-del]"); if (de && confirm("Supprimer le pack « " + (D.packs[de.dataset.pkDel] || {}).nom + " » ?")) enregistrer("packs", { [de.dataset.pkDel]: null }, "Pack supprimé");
  });

  /* ---------- Vente d'un pack promo (depuis son propre onglet de trésorerie) ---------- */
  function majVentePack() {
    const f = $("#form-vente-pack"), k = D.packs[f.pack.value], n = Math.max(1, Math.round(+f.qte.value || 1));
    if (!k) { $("#f-vp-detail").innerHTML = ""; return; }
    const L = (k.lignes || []).filter(l => byPot[l.article]);
    $("#f-vp-reserve").hidden = !L.some(l => estPlat(l.article));
    $("#f-vp-detail").innerHTML = `<ul class="pack-lignes">${L.map(l => `<li class="${estPlat(l.article) ? "cuisine" : "alchimie"}"><img src="images/potions/${byPot[l.article].img}" alt=""><span>${esc(byPot[l.article].nom)}</span><b>×${nb(l.qte * n)}</b></li>`).join("")}</ul>
      <p class="vp-total">Total : <strong>${nb(Math.round((+k.prix || 0) * n * 100) / 100)} ${M}</strong> <span class="mute">au lieu de ${nb(totalPack(L) * n)} ${M}</span></p>`;
  }
  $("#t-vente-pack").onclick = () => {
    const f = $("#form-vente-pack"), L = packs().filter(packValide); f.reset();
    f.pack.innerHTML = L.map(k => `<option value="${k.id}">${esc(k.nom)} — ${nb(k.prix)} ${M}${k.vitrine === false ? " (masqué)" : ""}</option>`).join("");
    f.date.value = aujourdhui(); f.reserve.value = cuisinier() ? "edmond" : "eau-noire";
    f.stock.checked = true; f.stock.disabled = !responsable(); $("#f-vp-motif-stock").hidden = true;
    majVentePack(); ouvrirF("#f-vente-pack");
  };
  $("#form-vente-pack").addEventListener("input", majVentePack);
  $("#form-vente-pack").addEventListener("change", e => { majVentePack(); if (e.target.name === "stock") $("#f-vp-motif-stock").hidden = e.target.checked; });
  $("#form-vente-pack").onsubmit = async e => {
    e.preventDefault(); const f = e.target, k = D.packs[f.pack.value]; if (!k) return;
    const poids = Object.fromEntries((k.lignes || []).filter(l => byPot[l.article]).map(l => [l.article, +potV(l.article).prix || 0]));
    if (!f.stock.checked && !f.motifStock.value.trim()) { toast("Indiquez pourquoi le stock n'est pas retiré.", true); f.motifStock.focus(); return; }
    const corps = { action: "vendrePack", mdp: session.mdp, nom: session.nom, pack: f.pack.value, qte: Math.max(1, Math.round(+f.qte.value || 1)), date: f.date.value, tiers: f.tiers.value.trim(), stock: f.stock.checked, motifStock: f.stock.checked ? "" : f.motifStock.value.trim(), reserve: f.reserve.value, poids };
    fermerF(); enCours++; renderSync();
    try {
      const r = await appel(corps); enCours--; if (!enCours) accepter(r);
      tresorVue = "ventes"; renderTout();
      toast("Pack vendu : " + k.nom + (corps.qte > 1 ? " ×" + corps.qte : "") + " — " + nb(Math.round(k.prix * corps.qte * 100) / 100) + " " + M);
    } catch (err) { enCours--; toast((err.message || "Échec") + " — rien n'a été enregistré.", true); charger(true); }
  };

  /* =================================================================
     JOURNAL DES STOCKS, INVENTAIRE ET EXPORT
     ================================================================= */
  const GENRES_J = { correction: "Correction", inventaire: "Inventaire", fabrication: "Fabrication", annulation: "Annulation", ajout: "Ajout", retrait: "Retrait", vente: "Vente", achat: "Achat" };
  const libStock = m => m.type === "ingredient" ? (m.champ === "stockCuisine" || (m.domaine === "cuisine" && COMMUN.has(m.article)) ? "stock cuisine" : byIng[m.article] && byIng[m.article].cuisine ? "stock cuisine" : "stock alchimie")
    : m.type === "nourriture" ? (m.champ === "stockEdmond" || m.reserve === "edmond" ? "stock d'Edmond" : "stock de l'Eau Noire") : "stock boutique";
  // Tous les événements qui font bouger un stock, du plus récent au plus ancien
  function evenementsStock() {
    const out = [];
    Object.keys(D.mouvements || {}).forEach(id => { const m = D.mouvements[id];
      const delta = m.ecart != null ? m.ecart : m.sens === "retrait" ? -(m.qte || 0) : (m.qte || 0);
      out.push({ id, genre: m.sens, quand: m.cree || m.date, date: m.date, type: m.type, article: m.article, delta, avant: m.avant, apres: m.apres, motif: m.motif || "", par: m.par || "", m,
        detail: m.sens === "fabrication" ? "Ingrédients : " + (m.ingredients || []).map(l => nomArticle(l) + " ×" + l.qte).join(", ") : "" }); });
    Object.keys(D.ventes || {}).forEach(id => { const v = D.ventes[id]; if (v.stock === false) return;
      out.push({ id, genre: "vente", quand: v.cree || v.date, date: v.date, type: v.type, article: v.article, delta: -(v.qte || 0), motif: v.packNom ? "Pack « " + v.packNom + " »" : v.client ? "Client : " + v.client : "", par: v.vendeur || "", m: v }); });
    Object.keys(D.achats || {}).forEach(id => { const a = D.achats[id];
      out.push({ id, genre: "achat", quand: a.cree || a.date, date: a.date, type: a.type, article: a.article, delta: a.qte || 0, motif: a.fournisseur ? "Fournisseur : " + a.fournisseur : "", par: a.acheteur || "", m: a }); });
    return out.sort((a, b) => String(b.quand || "").localeCompare(String(a.quand || "")));
  }
  function renderJournal() {
    if (!$("#inv").hidden) { renderInventaire(); return; }
    const E = evenementsStock(), mois = [...new Set(E.map(e => (e.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    const sel = $("#j-mois"), cur = sel.value;
    sel.innerHTML = `<option value="">Tous les mois</option>` + mois.map(m => `<option value="${m}">${fmtMois(m)}</option>`).join("");
    if (mois.includes(cur)) sel.value = cur;
    const t = $("#j-type").value, m = sel.value, mots = norm($("#j-recherche").value).split(/\s+/).filter(Boolean);
    const L = E.filter(e => (!t || e.genre === t) && (!m || (e.date || "").startsWith(m)) && mots.every(w => norm(nomArticle(e) + " " + enArticle(e) + " " + e.par + " " + e.motif + " " + e.detail + " " + GENRES_J[e.genre]).includes(w)));
    if (!L.length) { $("#j-liste").innerHTML = `<p class="vide">${E.length ? "Aucun mouvement pour cette sélection." : "Aucun mouvement de stock pour le moment."}</p>`; return; }
    const MAX = 400, V = L.slice(0, MAX), jours = [...new Set(V.map(e => e.date))];
    $("#j-liste").innerHTML = jours.map(j => `<div class="jour"><div class="jour-tete"><h4>${esc(fmtJour(j))}</h4><span class="jour-total">${V.filter(e => e.date === j).length} mouvement(s)</span></div>
      <div class="table-wrap"><table class="registre journal">
        <thead><tr><th class="num">Heure</th><th>Type</th><th class="ic"></th><th>Article</th><th class="num">Mouvement</th><th class="num">Avant → après</th><th>Motif / détail</th><th>Par</th></tr></thead>
        <tbody>${V.filter(e => e.date === j).map(e => { const h = /T/.test(e.quand || "") ? new Date(e.quand).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
          return `<tr>
          <td class="num mute">${h}</td>
          <td><span class="j-genre ${e.genre}">${GENRES_J[e.genre] || e.genre}</span></td>
          <td class="ic">${icone(e).replace(' loading="lazy"', "")}</td>
          <td class="nom">${nomLigne(e)}<small>${libStock(e.m)}</small></td>
          <td class="num"><b class="${e.delta > 0 ? "plus" : e.delta < 0 ? "moins" : ""}">${e.delta > 0 ? "+" : e.delta < 0 ? "−" : ""}${nb(Math.abs(e.delta))}</b></td>
          <td class="num">${e.avant != null ? nb(e.avant) + " → " + nb(e.apres) : `<span class="mute">—</span>`}</td>
          <td>${esc(e.motif)}${e.detail ? `<small class="mute" style="display:block">${esc(e.detail)}</small>` : ""}</td>
          <td>${esc(e.par)}</td></tr>`; }).join("")}</tbody>
      </table></div></div>`).join("") + (L.length > MAX ? `<p class="mute">… ${L.length - MAX} mouvements plus anciens : filtrez par mois ou exportez en CSV.</p>` : "");
  }
  ["#j-type", "#j-mois"].forEach(s => $(s).onchange = renderJournal);
  $("#j-recherche").addEventListener("input", renderJournal);

  // ----- Inventaire : quantités comptées, écarts, ajustement tracé
  const PERIMETRES = {
    potions: { nom: "Potions de la boutique", col: "potions", champ: "stock", liste: () => POTIONS.filter(p => !estPlat(p.id)) },
    "plats-en": { nom: "Plats — stock de l'Eau Noire", col: "potions", champ: "stock", liste: () => POTIONS.filter(p => estPlat(p.id)) },
    "plats-ed": { nom: "Plats — stock d'Edmond", col: "potions", champ: "stockEdmond", liste: () => POTIONS.filter(p => estPlat(p.id)) },
    "ing-alch": { nom: "Ingrédients d'alchimie", col: "ingredients", champ: "stock", liste: () => INGREDIENTS.filter(i => !i.cuisine) },
    "ing-cuis": { nom: "Denrées de cuisine (et communs côté cuisine)", col: "ingredients", champ: i => COMMUN.has(i.id) ? "stockCuisine" : "stock", liste: () => INGREDIENTS.filter(i => i.cuisine || i.commun) },
  };
  const saisieInv = {};   // "col|id|champ" -> quantité comptée
  $("#inv-perimetre").innerHTML = Object.entries(PERIMETRES).map(([k, x]) => `<option value="${k}">${esc(x.nom)}</option>`).join("");
  const lignesInv = () => { const P = PERIMETRES[$("#inv-perimetre").value];
    return P.liste().map(x => { const champ = typeof P.champ === "function" ? P.champ(x) : P.champ, v = P.col === "ingredients" ? ingV(x.id) : potV(x.id);
      return { x, col: P.col, champ, stock: +v[champ] || 0, k: P.col + "|" + x.id + "|" + champ }; }); };
  function renderInventaire() {
    const mots = norm($("#inv-recherche").value).split(/\s+/).filter(Boolean), seul = $("#inv-stock-seul").checked;
    const L = lignesInv().filter(l => (!seul || l.stock > 0 || saisieInv[l.k] != null) && mots.every(w => norm(l.x.nom + " " + (l.x.en || "")).includes(w))).sort((a, b) => a.x.nom.localeCompare(b.x.nom, "fr"));
    $("#inv-table").innerHTML = `<thead><tr><th class="ic"></th><th>Article</th><th class="num">Stock du registre</th><th class="num">Compté</th><th class="num">Écart</th></tr></thead>
      <tbody>${L.map(l => { const c = saisieInv[l.k], ec = c != null ? c - l.stock : null;
        return `<tr class="${ec ? "inv-ecart" : ""}"><td class="ic"><img src="images/${l.col === "ingredients" ? "ingredients/" + l.x.id + ".webp" : "potions/" + l.x.img}" alt="" onerror="this.style.visibility='hidden'"></td>
          <td class="nom">${esc(l.x.nom)}${l.x.en ? ` <span class="en">${esc(l.x.en)}</span>` : ""}</td>
          <td class="num">${nb(l.stock)}</td>
          <td class="num"><input class="prix-edit" type="number" min="0" step="1" value="${c != null ? c : ""}" placeholder="—" data-inv="${l.k}"></td>
          <td class="num">${ec == null ? `<span class="mute">·</span>` : ec === 0 ? `<span class="ok">=</span>` : `<b class="${ec > 0 ? "plus" : "moins"}">${ec > 0 ? "+" : "−"}${nb(Math.abs(ec))}</b>`}</td></tr>`; }).join("")}</tbody>`;
    majInvResume();
  }
  function majInvResume() {
    const tous = Object.values(PERIMETRES).flatMap(P => P.liste().map(x => { const champ = typeof P.champ === "function" ? P.champ(x) : P.champ, v = P.col === "ingredients" ? ingV(x.id) : potV(x.id); return { k: P.col + "|" + x.id + "|" + champ, stock: +v[champ] || 0 }; }));
    const comptes = tous.filter(l => saisieInv[l.k] != null), ecarts = comptes.filter(l => saisieInv[l.k] !== l.stock);
    $("#inv-resume").textContent = comptes.length + " article(s) compté(s) · " + ecarts.length + " écart(s) à corriger";
  }
  // Saisie : on met à jour la ligne seulement (le focus reste dans le tableau, Tab passe à la suivante)
  $("#inv-table").addEventListener("input", e => { const t = e.target.closest("[data-inv]"); if (!t) return;
    if (t.value === "") delete saisieInv[t.dataset.inv]; else saisieInv[t.dataset.inv] = Math.max(0, Math.round(+t.value || 0));
    const [col, id, champ] = t.dataset.inv.split("|"), stock = +(col === "ingredients" ? ingV(id) : potV(id))[champ] || 0, c = saisieInv[t.dataset.inv], ec = c != null ? c - stock : null, tr = t.closest("tr");
    tr.classList.toggle("inv-ecart", !!ec);
    tr.lastElementChild.innerHTML = ec == null ? `<span class="mute">·</span>` : ec === 0 ? `<span class="ok">=</span>` : `<b class="${ec > 0 ? "plus" : "moins"}">${ec > 0 ? "+" : "−"}${nb(Math.abs(ec))}</b>`;
    majInvResume(); });
  $("#inv-perimetre").onchange = $("#inv-stock-seul").onchange = renderInventaire;
  $("#inv-recherche").addEventListener("input", renderInventaire);
  const modeInventaire = on => { $("#inv").hidden = !on; $("#j-liste").hidden = on; $("#j-aide").hidden = on;
    ["#j-type", "#j-mois", "#j-recherche", "#j-export"].forEach(s => $(s).hidden = on);
    $("#j-titre").textContent = on ? "Inventaire" : "Journal des stocks"; $("#j-inventaire").textContent = on ? "Retour au journal" : "Faire un inventaire"; renderJournal(); };
  $("#j-inventaire").onclick = () => modeInventaire($("#inv").hidden);
  $("#inv-annuler").onclick = () => { if (Object.keys(saisieInv).length && !confirm("Abandonner les quantités saisies ?")) return; Object.keys(saisieInv).forEach(k => delete saisieInv[k]); modeInventaire(false); };
  $("#inv-valider").onclick = async () => {
    const lignes = Object.entries(saisieInv).map(([k, val]) => { const [col, article, champ] = k.split("|"), v = col === "ingredients" ? ingV(article) : potV(article); return { col, article, champ, valeur: val, avant: +v[champ] || 0 }; }).filter(l => l.valeur !== l.avant);
    if (!lignes.length) { toast("Aucun écart à corriger.", true); return; }
    if (!confirm("Valider l'inventaire ? " + lignes.length + " stock(s) seront corrigés et inscrits au journal.")) return;
    const note = $("#inv-note").value.trim(), motif = "Inventaire du " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + (note ? " — " + note : "");
    enCours++; renderSync();
    try { const r = await appel({ action: "corriger", genre: "inventaire", mdp: session.mdp, nom: session.nom, motif, lignes });
      enCours--; if (!enCours) accepter(r); Object.keys(saisieInv).forEach(k => delete saisieInv[k]); $("#inv-note").value = ""; modeInventaire(false); $("#j-type").value = "inventaire"; renderJournal();
      toast("Inventaire validé : " + lignes.length + " correction(s)"); }
    catch (err) { enCours--; toast(err.message || "Échec", true); charger(true); }
  };

  // ----- Export CSV (ventes, achats, journal, état des stocks)
  const csv = rows => "﻿" + rows.map(r => r.map(c => { const t = c == null ? "" : String(c); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(";")).join("\r\n");
  const num = n => String(Math.round((+n || 0) * 100) / 100).replace(".", ",");
  function telecharger(nom, contenu) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8" })); a.download = nom;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function ouvrirExport(quoi, dom) {
    const f = $("#form-export"), E = evenementsStock();
    const mois = [...new Set([...ventes(), ...achats(), ...E].map(x => (x.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    f.mois.innerHTML = `<option value="">Tous les mois</option>` + mois.map(m => `<option value="${m}">${fmtMois(m)}</option>`).join("");
    f.quoi.value = quoi || "ventes"; f.dom.value = dom || ""; f.mois.value = mois.includes(aujourdhui().slice(0, 7)) ? aujourdhui().slice(0, 7) : "";
    ouvrirF("#f-export");
  }
  $("#j-export").onclick = () => ouvrirExport("journal", "");
  $("#t-export").onclick = () => ouvrirExport("ventes", tresorDom);
  $("#form-export").onsubmit = e => {
    e.preventDefault(); const f = e.target, q = f.quoi.value, dom = f.dom.value, m = f.mois.value;
    const garde = x => (!dom || domaineMouv(x) === dom) && (!m || (x.date || "").startsWith(m));
    const suffixe = (dom ? "-" + (dom === "cuisine" ? "marmite" : "fiole") : "") + (m ? "-" + m : "");
    let rows;
    if (q === "ventes") rows = [["Date", "Partie", "Vendeur", "Article", "Nom anglais", "Type", "Qté", "Prix unitaire", "Total", "Part vendeur", "Part responsable", "Part Fiole/Marmite", "Part Eau Noire", "Client", "Pack", "Stock retiré"],
      ...ventes().filter(garde).sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(v => { const d = domaineMouv(v), p = parts(totalVente(v), d, v);
        return [v.date, d === "cuisine" ? "Marmite" : "Fiole", v.vendeur, nomArticle(v), enArticle(v), typeVente(v), v.qte, num(v.prix), num(p.total), num(p.vendeur), num(p.gerante), num(p.boutique), num(p.forge), v.client || "", v.packNom || "", v.stock === false ? "non (" + (v.motifStock || "") + ")" : "oui"]; })];
    else if (q === "achats") rows = [["Date", "Partie", "Acheteur", "Article", "Nom anglais", "Qté", "Prix unitaire", "Total", "Fournisseur"],
      ...achats().filter(garde).sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(a => [a.date, domaineMouv(a) === "cuisine" ? "Marmite" : "Fiole", a.acheteur || "", nomArticle(a), enArticle(a), a.qte, num(a.prix), num(totalAchat(a)), a.fournisseur || ""])];
    else if (q === "journal") rows = [["Date", "Heure", "Type", "Article", "Nom anglais", "Stock", "Mouvement", "Avant", "Après", "Motif", "Détail", "Par"],
      ...evenementsStock().filter(e => (!dom || domaineMouv(e.m) === dom) && (!m || (e.date || "").startsWith(m))).reverse().map(e => [e.date, /T/.test(e.quand || "") ? new Date(e.quand).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "", GENRES_J[e.genre] || e.genre, nomArticle(e), enArticle(e), libStock(e.m), e.delta, e.avant ?? "", e.apres ?? "", e.motif, e.detail, e.par])];
    else {
      rows = [["Article", "Nom anglais", "Partie", "Catégorie", "Stock", "Quantité", "Seuil", "Prix de rachat", "Prix de vente", "Valeur au rachat"]];
      POTIONS.filter(p => !dom || (estPlat(p.id) ? "cuisine" : "alchimie") === dom).forEach(p => { const v = potV(p.id);
        (estPlat(p.id) ? [["stock", "seuil", "Eau Noire"], ["stockEdmond", "seuilEdmond", "Edmond"]] : [["stock", "seuil", "Boutique"]]).forEach(([c, sl, lib]) =>
          rows.push([p.nom, p.en || "", estPlat(p.id) ? "Marmite" : "Fiole", p.categorie, lib, +v[c] || 0, +v[sl] || 0, num(v.prixAchat), num(v.prix), num((+v[c] || 0) * (+v.prixAchat || 0))])); });
      INGREDIENTS.forEach(i => { const v = ingV(i.id); domainesDe("ingredients", i.id).filter(d => !dom || d === dom).forEach(d => { const c = champsIng(i.id, d);
        rows.push([i.nom, i.en || "", d === "cuisine" ? "Marmite" : "Fiole", "Ingrédient", d === "cuisine" ? "Cuisine" : "Alchimie", +v[c.stock] || 0, +v[c.seuil] || 0, num(v.prixAchat), num(v.prix), num((+v[c.stock] || 0) * (+v.prixAchat || 0))]); }); });
    }
    fermerF();
    telecharger("fiole-" + q + suffixe + ".csv", csv(rows));
    toast("Export prêt : " + (rows.length - 1) + " ligne(s)");
  };

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
  // Les fenêtres ne se ferment que par leurs boutons (Annuler, ✕) : un clic à côté ne fait rien
  document.addEventListener("click", e => { if (e.target.matches("[data-fermer]")) fermerF(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { fermerF(); if (modeAjout) { modeAjout = false; document.body.classList.remove("mode-ajout"); } } });
  $("#burger").onclick = () => $("#nav").classList.toggle("ouvert");
  let tt;
  function toast(t, err) { const el = $("#toast"); el.textContent = t; el.classList.toggle("erreur", !!err); el.classList.add("visible"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("visible"), err ? 3500 : 1800); }

  // Rafraîchissement automatique (en ligne) toutes les 30 s
  setInterval(() => { if (session && !session.demo && !document.hidden && !enCours && !Object.keys(attente).length && !Object.keys(corr).length && !Object.keys(saisieInv).length && !editFront && !$$(".fenetre").some(f => !f.hidden)) charger(true); }, 30000);

  /* ---------- Reprise de session ---------- */
  const s = sess.get("session", null) || local.get("session", null);
  if (s && (s.demo ? !API : !!API)) entrer(s);
})();
