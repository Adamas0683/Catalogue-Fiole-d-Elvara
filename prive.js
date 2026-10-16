/* =====================================================================
   LA FIOLE ET LA MARMITE — ESPACE PRIVÉ
   Elvara (gérante) : l'alchimie. Edmond (cuisinier) : la cuisine.
   Tous deux : la carte, les accords et les ventes.
   Employés : voient tout, n'enregistrent que des ventes.
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
  const CATS = ["Breuvages", "Soins et restauration", "Endurance", "Renforts", "Protections", "Nourriture"];
  const VIDE = () => ({ ingredients: {}, potions: {}, carte: {}, accords: {}, ventes: {}, achats: {}, reglages: {} });
  // Mode démonstration (sans serveur) : mots de passe de test
  const MDP_DEMO = { "demo-gerante": "gerante", "demo-employe": "employe", "demo-cuisinier": "cuisinier" };
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
    if (d.erreur) throw new Error(d.erreur);
    return d;
  }
  function demo(c) {
    const db = local.get("demo", null) || { donnees: VIDE(), maj: "", par: "" };
    if (c.action === "acheter") {
      if (session.role === "cuisinier") throw new Error("Les achats d'ingrédients d'alchimie sont gérés par Elvara et les employés.");
      const a = Object.assign({}, c.achat, { acheteur: c.nom, cree: new Date().toISOString() });
      (db.donnees.achats || (db.donnees.achats = {}))["achat-" + Date.now().toString(36)] = a;
      if (c.enstock) { const o = db.donnees.ingredients[a.article] || (db.donnees.ingredients[a.article] = {}); o.stock = (+o.stock || 0) + a.qte; }
      db.maj = new Date().toISOString(); db.par = c.nom;
      local.set("demo", db);
    }
    if (c.action === "vendre") {
      const v = Object.assign({}, c.vente, { vendeur: c.nom, cree: new Date().toISOString() });
      db.donnees.ventes["vente-" + Date.now().toString(36)] = v;
      if (c.destock) {
        const col = db.donnees[v.type === "ingredient" ? "ingredients" : "potions"];
        const o = col[v.article] || (col[v.article] = {});
        const ch = v.type === "nourriture" && c.reserve === "edmond" ? "stockEdmond" : "stock";
        o[ch] = Math.max(0, (+o[ch] || 0) - v.qte);
      }
      db.maj = new Date().toISOString(); db.par = c.nom;
      local.set("demo", db);
    }
    if (c.action === "ecrire") {
      if (session.role === "employe") throw new Error("Les employés peuvent seulement enregistrer des ventes.");
      if ((c.collection === "potions" || c.collection === "ingredients") && !Object.keys(c.changements).every(id => domaineDe(c.collection, id) === monDomaine()))
        throw new Error(cuisinier() ? "Edmond ne peut modifier que la partie cuisine." : "Elvara ne peut modifier que la partie alchimie.");
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
    return Promise.resolve({ role: session.role, donnees, maj: db.maj, par: db.par });
  }
  function accepter(r) {
    D = Object.assign(VIDE(), r.donnees || {});
    infoSync = { maj: r.maj || "", par: r.par || "" };
  }
  async function charger(silencieux) {
    try {
      accepter(await appel({ action: "lire", mdp: session.mdp }));
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
  const ingV = id => Object.assign({ stock: 0, seuil: 0, prix: byIng[id].prix, accord: false, accordTexte: "", chatellerie: "" }, D.ingredients[id] || {});
  const potV = id => Object.assign({ stock: 0, seuil: 0, stockEdmond: 0, seuilEdmond: 0, prix: byPot[id].prix, vitrine: byPot[id].vitrine }, D.potions[id] || {});
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
  const domaineDe = (col, id) => CUISINE[col] && CUISINE[col].has(id) ? "cuisine" : "alchimie";
  const monDomaine = () => gerante() ? "alchimie" : cuisinier() ? "cuisine" : null;
  const voit = (col, id) => !monDomaine() || domaineDe(col, id) === monDomaine();
  const peutModifier = (col, id) => !!monDomaine() && domaineDe(col, id) === monDomaine();
  const peutStock = peutModifier;

  /* =================================================================
     CONNEXION
     ================================================================= */
  function entrer(s) {
    session = s;
    $("#ecran-connexion").hidden = true; $("#registre").hidden = false;
    $("#r-nom").textContent = s.nom;
    $("#r-role").textContent = { gerante: "Gérante · alchimie", employe: "Employé", cuisinier: "Cuisinier · cuisine" }[s.role] || s.role;
    $("#r-role").className = "badge " + s.role;
    document.body.classList.toggle("lecture-seule", s.role === "employe");
    // Elvara ne voit que l'alchimie, Edmond que la cuisine ; les employés voient tout
    const cats = s.role === "gerante" ? CATS.filter(c => c !== "Nourriture") : s.role === "cuisinier" ? ["Nourriture"] : CATS;
    $("#p-cat").innerHTML = (cats.length > 1 ? `<option value="">Toutes catégories</option>` : "") + cats.map(c => `<option>${c}</option>`).join("");
    $$('#i-filtre option[value="alchimie"], #i-filtre option[value="cuisine"]').forEach(o => o.hidden = s.role !== "employe");
    $("#i-filtre").value = "";
    $("#panneau-potions h2").textContent = s.role === "gerante" ? "Potions" : s.role === "cuisinier" ? "Nourriture" : "Potions et nourriture";
    $('[data-p="potions"]').textContent = $("#panneau-potions h2").textContent;
    $('[data-p="achats"]').hidden = s.role === "cuisinier";
    if (onglet === "achats" && s.role === "cuisinier") onglet = "accueil";
    $("#panneau-ingredients h2").textContent = s.role === "cuisinier" ? "Denrées de cuisine" : s.role === "gerante" ? "Ingrédients d'alchimie" : "Ingrédients";
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
      const s = { nom, mdp, role, demo: true };
      if ($("#c-souvenir").checked) local.set("session", s); else sess.set("session", s);
      entrer(s); return;
    }
    $("#c-entrer").disabled = true; $("#c-entrer").textContent = "Ouverture…";
    try {
      const r = await fetch(API, { method: "POST", body: JSON.stringify({ action: "lire", mdp }) }).then(x => x.json());
      if (r.erreur) throw new Error(r.erreur);
      const s = { nom, mdp, role: r.role, demo: false };
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
  $$("#onglets-prive button").forEach(b => b.onclick = () => montrer(b.dataset.p));
  function montrer(p) {
    if (p === "achats" && cuisinier()) p = "accueil";
    onglet = p;
    $$("#onglets-prive button").forEach(b => b.setAttribute("aria-selected", b.dataset.p === p));
    $$(".panneau").forEach(x => x.hidden = x.id !== "panneau-" + p);
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
    if (onglet === "ventes") renderVentes();
    if (onglet === "achats") renderAchats();
    $("#h-ajouter").hidden = cuisinier();
    $("#a-ajouter").hidden = !responsable();
    $("#k-ajouter").hidden = !responsable();
    $("#v-ajouter").hidden = false;
  }

  /* =================================================================
     TABLEAU DE BORD
     ================================================================= */
  function alertesListe() {
    const out = [];
    INGREDIENTS.filter(i => voit("ingredients", i.id)).forEach(i => {
      const v = ingV(i.id), e = etat(v);
      if (v.accord) out.push({ type: "accord", ico: "🔔", titre: i.nom + " : accord requis", detail: [v.chatellerie, v.accordTexte].filter(Boolean).join(" · ") || "Voir avec la gérante", aller: "ingredients" });
      if (e === "rupture" || e === "bas") out.push({ type: e, ico: e === "rupture" ? "⚠" : "◔", titre: "Ingrédient — " + i.nom, detail: `${ETAT[e]} : ${nb(v.stock)} / ${nb(v.seuil)}`, aller: "ingredients" });
    });
    POTIONS.filter(p => voit("potions", p.id)).forEach(p => (estPlat(p.id) ? ["eau-noire", "edmond"] : ["eau-noire"]).forEach(res => {
      const v = vueRes(p.id, res), e = etat(v);
      if (e === "rupture" || e === "bas") out.push({ type: e, ico: e === "rupture" ? "⚠" : "◔", titre: (estPlat(p.id) ? "Plat — " : "Potion — ") + p.nom + (estPlat(p.id) ? " (stock " + RESERVES[res].nom + ")" : ""), detail: `${ETAT[e]} : ${nb(v.stock)} / ${nb(v.seuil)}`, aller: "potions" });
    }));
    points().filter(p => p.accord).forEach(p => out.push({ type: "accord", ico: "🗺", titre: "Carte — " + p.titre, detail: p.accordTexte || ("Accord requis (" + (p.chatellerie || "châtellerie") + ")"), aller: "carte" }));
    const rang = { rupture: 0, accord: 1, bas: 2 };
    return out.sort((a, b) => rang[a.type] - rang[b.type]);
  }
  function renderAccueil() {
    const ING = INGREDIENTS.filter(i => voit("ingredients", i.id)), POT = POTIONS.filter(p => voit("potions", p.id));
    const ingEnStock = ING.filter(i => ingV(i.id).stock > 0).length;
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
      <div class="bloc cadre" data-aller="ventes" style="cursor:pointer"><strong>${nb(totalJour(aujourdhui()))}</strong><span>${M} vendus aujourd'hui</span></div>`;
    $("#alertes").innerHTML = al.length ? al.slice(0, 40).map(a => `
      <div class="alerte ${a.type}" data-aller="${a.aller}" style="cursor:pointer"><span class="ico">${a.ico}</span><div><b>${esc(a.titre)}</b><small>${esc(a.detail)}</small></div></div>`).join("")
      + (al.length > 40 ? `<p class="mute">… et ${al.length - 40} autres.</p>` : "")
      : `<p class="mute"><i>Aucune notification. Fixez des seuils dans les onglets Ingrédients et Potions pour être prévenu des stocks bas.</i></p>`;
    const enCoursAc = ac.filter(a => a.statut === "actif" || a.statut === "negociation");
    $("#accords-resume").innerHTML = enCoursAc.length ? enCoursAc.map(a => `
      <div class="alerte" data-aller="accords" style="cursor:pointer;border-left-color:${a.statut === "actif" ? "var(--ok)" : "var(--bas)"}"><span class="ico">✒</span>
      <div><b>${esc(a.partenaire)}</b><small>${esc([a.type, a.lieu || a.chatellerie, a.statut === "negociation" ? "en négociation" : ""].filter(Boolean).join(" · "))}</small></div></div>`).join("")
      : `<p class="mute"><i>Aucun accord en cours.</i></p>`;
    const n = al.length;
    $("#p-alertes").hidden = !n; $("#p-alertes").textContent = n;
  }
  document.addEventListener("click", e => { const a = e.target.closest("[data-aller]"); if (a) montrer(a.dataset.aller); });

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
    const rows = INGREDIENTS.filter(i => {
      if (!voit("ingredients", i.id)) return false;
      const v = ingV(i.id), e = etat(v);
      if (f === "alerte" && !(e === "bas" || e === "rupture")) return false;
      if (f === "accord" && !v.accord) return false;
      if (f === "cuisine" && !i.cuisine) return false;
      if (f === "alchimie" && i.cuisine) return false;
      if (f === "stock" && !(v.stock > 0)) return false;
      return mots.every(m => norm(i.nom + " " + i.effets.join(" ") + " " + i.source + " " + (i.dlc || "")).includes(m));
    });
    $("#t-ingredients").innerHTML = `<thead><tr><th class="ic"></th><th>Ingrédient</th><th>Effets</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">Prix (${M})</th><th>Accord</th><th>État</th></tr></thead>
      <tbody>${rows.map(i => {
        const v = ingV(i.id), e = etat(v);
        return `<tr>
          <td class="ic"><img src="images/ingredients/${i.id}.webp" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
          <td class="nom">${esc(i.nom)}${i.dlc ? ` <span class="mute" style="font-size:.8rem">(${i.dlc})</span>` : ""}<small>${esc(i.source)}</small>${i.recette ? blocRecettes([i.recette]) : ""}</td>
          <td><div class="effets">${i.cuisine ? `<span>Denrée de cuisine</span>` : ""}${i.effets.map(x => `<span>${esc(x)}</span>`).join("")}</div></td>
          <td class="num">${stockCell("ingredients", i.id, v)}</td>
          <td class="num">${champNum("ingredients", i.id, "seuil", v.seuil)}</td>
          <td class="num">${champNum("ingredients", i.id, "prix", v.prix)}</td>
          <td><button class="cloche ${v.accord ? "on" : ""}" type="button" data-cloche="${i.id}" title="${peutModifier("ingredients", i.id) ? "Indiquer un accord requis" : v.accord ? "Accord requis" : ""}" ${peutModifier("ingredients", i.id) ? "" : "disabled"}>🔔</button>
            ${v.accord ? `<span class="cloche-texte">${esc([v.chatellerie, v.accordTexte].filter(Boolean).join(" · ") || "Accord requis")}</span>` : ""}</td>
          <td><span class="etat ${e}">${ETAT[e]}</span></td></tr>`;
      }).join("")}</tbody>`;
    if (!rows.length) $("#t-ingredients").innerHTML += `<tbody><tr><td colspan="8" class="vide">Aucun ingrédient.</td></tr></tbody>`;
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
      ? "Le prix et la case « Vitrine » sont publiés sur la page des clients. ★ = sur l'accueil de la vitrine (" + MAX_VEDETTES + " " + (cuisinier() ? "plats" : "potions") + " au maximum)."
      : "Consultation seule : Elvara gère l'alchimie, Edmond la cuisine.";
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
      if (f === "vitrine" && !v.vitrine) return false;
      if (f === "cachee" && v.vitrine) return false;
      return mots.every(m => norm(p.nom + " " + p.famille + " " + p.effet + " " + motsRecettes(p.recettes)).includes(m));
    });
    $("#t-potions").innerHTML = `<thead><tr><th class="ic"></th><th>${cuisinier() ? "Plat" : "Article"}</th><th class="num">Stock${avecPlats ? `<small style="display:block;font-size:.72rem">plats : ${RESERVES[reserve].nom}</small>` : ""}</th><th class="num">Seuil</th><th class="num">Prix (${M})</th><th>Vitrine</th><th>Accueil</th><th>État</th></tr></thead>
      <tbody>${rows.map(p => {
        const v = vueRes(p.id), e = etat(v), iv = vedettesDe(domaineDe("potions", p.id)).indexOf(p.id), pm = peutModifier("potions", p.id);
        return `<tr>
          <td class="ic"><img src="images/potions/${p.img}" alt="" loading="lazy"></td>
          <td class="nom">${esc(p.nom)}<small>${esc(p.famille)} · ${esc(p.effet)}</small>${blocRecettes(p.recettes)}</td>
          <td class="num">${stockCell("potions", p.id, v, v._cs)}</td>
          <td class="num">${champNum("potions", p.id, v._ce, v.seuil)}</td>
          <td class="num">${champNum("potions", p.id, "prix", v.prix)}</td>
          <td>${pm ? `<label class="case"><input type="checkbox" data-vitrine="${p.id}" ${v.vitrine ? "checked" : ""}></label>` : (v.vitrine ? "✓" : `<span class="mute">—</span>`)}</td>
          <td>${pm ? `<button class="cloche ${iv >= 0 ? "on" : ""}" type="button" data-vedette="${p.id}" title="Mettre sur l'accueil de la vitrine">★</button>` : (iv >= 0 ? "★" : "")}</td>
          <td><span class="etat ${e}">${ETAT[e]}</span></td></tr>`;
      }).join("")}</tbody>`;
  }
  $("#p-recherche").addEventListener("input", renderPotions);
  $$("#p-reserves button").forEach(b => b.onclick = () => { reserve = b.dataset.reserve; renderPotions(); });
  $("#p-cat").onchange = $("#p-filtre").onchange = renderPotions;

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
    const b = e.target.closest(".stock-edit button");
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
      const val = t.dataset.champ === "prix" ? Math.round(n * 100) / 100 : Math.round(n);
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
  const STATUT = { actif: "Actif", negociation: "En négociation", suspendu: "Suspendu", expire: "Expiré" };
  let accordId = null;
  function renderAccords() {
    const f = $("#a-filtre").value;
    const l = accords().filter(a => !f || a.statut === f).sort((a, b) => (a.partenaire || "").localeCompare(b.partenaire || ""));
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
        <div class="actions"><button class="btn-sobre btn-petit" type="button" data-ac-copier="${a.id}" title="Copier l'accord pour le coller sur Discord">Copier pour Discord</button>${responsable() ? `<button class="btn-sobre btn-petit" type="button" data-ac-edit="${a.id}">Modifier</button><button class="btn-sobre btn-petit" type="button" data-ac-del="${a.id}">Supprimer</button>` : ""}</div>
      </article>`).join("")
      : `<p class="vide">${f ? "Aucun accord dans cette catégorie." : "Aucun accord pour le moment." + (responsable() ? " Ajoutez le premier avec « Nouvel accord »." : "")}</p>`;
  }
  $("#a-filtre").onchange = renderAccords;
  function ouvrirAccord(id) {
    accordId = id;
    const a = id ? D.accords[id] : { statut: "negociation", type: "Fournisseur" };
    const f = $("#form-accord");
    $("#f-accord-titre").textContent = id ? "Modifier l'accord" : "Nouvel accord commercial";
    f.chatellerie.innerHTML = optCh(a.chatellerie);
    ["partenaire", "lieu", "type", "statut", "produits", "conditions", "debut", "fin", "contact"].forEach(k => { if (f[k]) f[k].value = a[k] || (k === "statut" ? "negociation" : k === "type" ? "Fournisseur" : ""); });
    ouvrirF("#f-accord");
  }
  $("#a-ajouter").onclick = () => ouvrirAccord(null);
  $("#form-accord").onsubmit = e => {
    e.preventDefault(); const f = e.target, o = {};
    ["partenaire", "lieu", "chatellerie", "type", "statut", "produits", "conditions", "debut", "fin", "contact"].forEach(k => o[k] = f[k].value.trim());
    enregistrer("accords", { [accordId || "accord-" + Date.now().toString(36)]: o }, accordId ? "Accord modifié" : "Accord ajouté");
    fermerF();
  };
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
    const del = e.target.closest("[data-ac-del]");
    if (del && confirm("Supprimer l'accord avec « " + (D.accords[del.dataset.acDel] || {}).partenaire + " » ?")) enregistrer("accords", { [del.dataset.acDel]: null }, "Accord supprimé");
  });

  /* =================================================================
     VENTES
     ================================================================= */
  const aujourdhui = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const ventes = () => Object.keys(D.ventes || {}).map(id => Object.assign({ id }, D.ventes[id]));
  const totalJour = j => ventes().filter(v => v.date === j).reduce((a, v) => a + (v.qte || 0) * (v.prix || 0), 0);
  const article = v => v.type === "ingredient" ? byIng[v.article] : byPot[v.article];
  const nomArticle = v => (article(v) || {}).nom || v.nomArticle || v.article;
  const imgArticle = v => v.type === "ingredient" ? `images/ingredients/${v.article}.webp` : (byPot[v.article] ? `images/potions/${byPot[v.article].img}` : "");
  // Partie d'une vente : alchimie (Elvara) ou cuisine (Edmond)
  const domaineVente = v => v.type === "ingredient" ? domaineDe("ingredients", v.article) : domaineDe("potions", v.article);
  const DOMAINES = [["alchimie", "⚗ Alchimie"], ["cuisine", "🍲 Cuisine"]];
  const typeVente = v => {
    if (v.type === "ingredient") return "Ingrédient";
    const c = (byPot[v.article] || {}).categorie;
    return c === "Nourriture" ? "Nourriture" : c === "Breuvages" ? "Breuvage" : "Potion";
  };
  const fmtJour = j => { const d = new Date(j + "T12:00:00"); return isNaN(d) ? j : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
  const fmtMois = m => { const d = new Date(m + "-01T12:00:00"); return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); };

  // Parts d'une vente : vendeur 50 % arrondi en dessous, le reste partagé
  // entre Elvara et l'Eau Noire (Elvara prend le septim en trop s'il y en a un).
  const cts = n => Math.round(n * 100);
  function parts(total) {
    const c = cts(total), v = Math.floor(c / 200) * 100, r = c - v;
    const e = r % 100 === 0 ? Math.ceil(r / 200) * 100 : Math.ceil(r / 2);
    return { total: c / 100, vendeur: v / 100, gerante: e / 100, forge: (r - e) / 100 };
  }
  const totalVente = v => (v.qte || 0) * (v.prix || 0);
  const cumul = a => a.reduce((s, v) => { const p = parts(totalVente(v));
    s.total += p.total; s.vendeur += p.vendeur; s.gerante += p.gerante; s.forge += p.forge; s.n += (v.qte || 0); return s; },
    { total: 0, vendeur: 0, gerante: 0, forge: 0, n: 0 });
  const lundi = j => { const d = new Date(j + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const fmtSemaine = l => { const a = new Date(l + "T12:00:00"), b = new Date(a); b.setDate(a.getDate() + 6);
    const o = { day: "numeric", month: "long" };
    return "Semaine du lundi " + a.toLocaleDateString("fr-FR", o) + " au dimanche " + b.toLocaleDateString("fr-FR", Object.assign({ year: "numeric" }, o)); };
  const partsHTML = (c, titre) => `<div class="parts">
      <div class="part total"><span>${titre}</span><strong>${nb(c.total)} ${M}</strong></div>
      <div class="part vendeur"><span>${esc(PARTAGE.vendeur)}s · 50 %</span><strong>${nb(c.vendeur)}</strong></div>
      <div class="part gerante"><span>${esc(PARTAGE.gerante)} · 25 %</span><strong>${nb(c.gerante)}</strong></div>
      <div class="part forge"><span>${esc(PARTAGE.forge)} · 25 %</span><strong>${nb(c.forge)}</strong></div>
    </div>`;
  const parVendeur = a => { const o = {}; a.forEach(v => { const k = v.vendeur || "—"; o[k] = (o[k] || 0) + parts(totalVente(v)).vendeur; });
    return Object.entries(o).sort((x, y) => y[1] - x[1]); };

  function renderVentes() {
    const tout = ventes();
    const mois = [...new Set(tout.map(v => (v.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    const sel = $("#v-mois"), cur = sel.value;
    sel.innerHTML = `<option value="">Toutes les ventes</option>` + mois.map(m => `<option value="${m}">${fmtMois(m)}</option>`).join("");
    if (mois.includes(cur)) sel.value = cur;
    const m = sel.value, mots = norm($("#v-recherche").value).split(/\s+/).filter(Boolean);
    const l = tout.filter(v => (!m || (v.date || "").startsWith(m)) && mots.every(x => norm(nomArticle(v) + " " + (v.client || "") + " " + (v.vendeur || "")).includes(x)));
    const auj = aujourdhui(), sem = lundi(auj), moisCourant = auj.slice(0, 7);
    const cJ = cumul(tout.filter(v => v.date === auj)), cS = cumul(tout.filter(v => v.date && lundi(v.date) === sem));
    $("#v-resume").innerHTML = `
      <div class="bloc cadre"><strong>${nb(cJ.total)}</strong><span>${M} aujourd'hui</span></div>
      <div class="bloc cadre"><strong>${nb(cS.total)}</strong><span>${M} cette semaine</span></div>
      <div class="bloc cadre"><strong>${nb(cumul(tout.filter(v => (v.date || "").startsWith(moisCourant))).total)}</strong><span>${M} ce mois-ci</span></div>
      <div class="bloc cadre"><strong>${nb(cumul(l).n)}</strong><span>articles vendus${m || mots.length ? " (sélection)" : ""}</span></div>`;
    const semaines = [...new Set(l.filter(v => v.date).map(v => lundi(v.date)))].sort().reverse();
    $("#v-jours").innerHTML = semaines.length ? semaines.map(s => {
      const ls = l.filter(v => v.date && lundi(v.date) === s);
      const jours = [...new Set(ls.map(v => v.date))].sort().reverse();
      return `<section class="semaine">
        <div class="semaine-tete"><h3>${esc(fmtSemaine(s))}</h3>
          <p class="semaine-vendeurs">${parVendeur(ls).map(([n, x]) => `<span>${esc(n)} : <b>${nb(x)} ${M}</b></span>`).join("")}</p></div>
        ${partsHTML(cumul(ls), "Total de la semaine")}
        <p class="semaine-domaines">${DOMAINES.map(([d, lib]) => { const c = cumul(ls.filter(v => domaineVente(v) === d)); return c.n ? `<span><b>${lib}</b> : ${nb(c.total)} ${M} · ${esc(PARTAGE.vendeur)}s ${nb(c.vendeur)} · ${esc(PARTAGE.gerante)} ${nb(c.gerante)} · ${esc(PARTAGE.forge)} ${nb(c.forge)}</span>` : ""; }).join("")}</p>
        ${jours.map(j => {
          const lj = ls.filter(v => v.date === j).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
          const cj = cumul(lj);
          const blocs = DOMAINES.map(([d, lib]) => [d, lib, lj.filter(v => domaineVente(v) === d)]).filter(b => b[2].length);
          return `<div class="jour">
          <div class="jour-tete"><h4>${esc(fmtJour(j))}</h4><span class="jour-total">Total du jour : <b>${nb(cj.total)} ${M}</b>${blocs.length > 1 ? blocs.map(([, lib, l]) => ` · ${lib} ${nb(cumul(l).total)}`).join("") : ""}</span></div>
          ${blocs.map(([d, lib, ld]) => { const cd = cumul(ld); return `<div class="domaine domaine-${d}"><h5>${lib}</h5>
          <div class="table-wrap"><table class="registre">
            <thead><tr><th class="ic"></th><th>Article</th><th class="num">Qté</th><th class="num">Prix u.</th><th class="num">Total</th><th class="num p-vendeur">${esc(PARTAGE.vendeur)}<small>50 %</small></th><th class="num p-gerante">${esc(PARTAGE.gerante)}<small>25 %</small></th><th class="num p-forge">${esc(PARTAGE.forge)}<small>25 %</small></th><th>Vendu par</th>${responsable() ? "<th></th>" : ""}</tr></thead>
            <tbody>${ld.map(v => { const p = parts(totalVente(v)); return `<tr>
              <td class="ic">${imgArticle(v) ? `<img src="${imgArticle(v)}" alt="" loading="lazy">` : ""}</td>
              <td class="nom">${esc(nomArticle(v))}<small>${typeVente(v)}${v.reserve === "edmond" ? " · stock d'Edmond" : v.type === "nourriture" ? " · stock de l'Eau Noire" : ""}${v.client ? " · client : " + esc(v.client) : ""}</small></td>
              <td class="num">${nb(v.qte)}</td><td class="num">${nb(v.prix)}</td><td class="num"><b>${nb(p.total)}</b></td>
              <td class="num p-vendeur">${nb(p.vendeur)}</td><td class="num p-gerante">${nb(p.gerante)}</td><td class="num p-forge">${nb(p.forge)}</td>
              <td class="mute">${esc(v.vendeur || "")}</td>
              ${responsable() ? `<td><button class="btn-sobre btn-petit" type="button" data-vente-del="${v.id}" title="Supprimer cette vente">✕</button></td>` : ""}
            </tr>`; }).join("")}</tbody>
            <tfoot><tr><td></td><td>Total ${d === "cuisine" ? "cuisine" : "alchimie"}</td><td class="num">${nb(cd.n)}</td><td></td><td class="num"><b>${nb(cd.total)}</b></td>
              <td class="num p-vendeur"><b>${nb(cd.vendeur)}</b></td><td class="num p-gerante"><b>${nb(cd.gerante)}</b></td><td class="num p-forge"><b>${nb(cd.forge)}</b></td><td></td>${responsable() ? "<td></td>" : ""}</tr></tfoot>
          </table></div></div>`; }).join("")}
          ${blocs.length > 1 ? `<p class="jour-cumul">Total du jour (alchimie + cuisine) : <b>${nb(cj.total)} ${M}</b> · ${esc(PARTAGE.vendeur)}s ${nb(cj.vendeur)} · ${esc(PARTAGE.gerante)} ${nb(cj.gerante)} · ${esc(PARTAGE.forge)} ${nb(cj.forge)}</p>` : ""}
          </div>`;
        }).join("")}
      </section>`;
    }).join("") : `<p class="vide">${tout.length ? "Aucune vente pour cette sélection." : "Aucune vente enregistrée pour le moment."}</p>`;
  }
  $("#v-mois").onchange = renderVentes;
  $("#v-recherche").addEventListener("input", renderVentes);

  function optionsArticles(type) {
    if (type === "ingredient") return INGREDIENTS.map(i => `<option value="${i.id}">${esc(i.nom)}</option>`).join("");
    if (type === "nourriture") return [...new Set(POTIONS.filter(p => p.categorie === "Nourriture").map(p => p.famille))].map(f =>
      `<optgroup label="${esc(f)}">${POTIONS.filter(p => p.categorie === "Nourriture" && p.famille === f).map(p => `<option value="${p.id}">${esc(p.nom)}</option>`).join("")}</optgroup>`).join("");
    return CATS.filter(c => c !== "Nourriture").map(c => `<optgroup label="${esc(c)}">${POTIONS.filter(p => p.categorie === c && !p.interdit).map(p => `<option value="${p.id}">${esc(p.nom)}</option>`).join("")}</optgroup>`).join("");
  }
  function prixCourant(type, id) { return type === "ingredient" ? (byIng[id] ? ingV(id).prix : 0) : (byPot[id] ? potV(id).prix : 0); }
  function majTotalVente() {
    const f = $("#form-vente");
    $("#f-vente-reserve").hidden = f.type.value !== "nourriture";
    $("#f-vente-total").textContent = "Total : " + nb((+f.qte.value || 0) * (+f.prix.value || 0)) + " " + M;
  }
  $("#v-ajouter").onclick = () => {
    const f = $("#form-vente");
    f.reset(); f.date.value = aujourdhui(); f.type.value = cuisinier() ? "nourriture" : "potion";
    if (cuisinier()) f.reserve.value = "edmond";
    f.article.innerHTML = optionsArticles(f.type.value); f.prix.value = prixCourant(f.type.value, f.article.value);
    majTotalVente(); ouvrirF("#f-vente");
  };
  $("#form-vente").type.onchange = e => { const f = e.target.form; f.article.innerHTML = optionsArticles(f.type.value); f.prix.value = prixCourant(f.type.value, f.article.value); majTotalVente(); };
  $("#form-vente").article.onchange = e => { const f = e.target.form; f.prix.value = prixCourant(f.type.value, f.article.value); majTotalVente(); };
  $("#form-vente").qte.oninput = majTotalVente;
  $("#form-vente").prix.oninput = majTotalVente;
  $("#form-vente").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const v = { date: f.date.value, type: f.type.value, article: f.article.value, qte: Math.max(1, Math.round(+f.qte.value || 1)),
      prix: Math.max(0, Math.round((+String(f.prix.value).replace(",", ".") || 0) * 100) / 100), client: f.client.value.trim() };
    const destock = f.destock.checked, res = v.type === "nourriture" ? f.reserve.value : "eau-noire";
    if (v.type === "nourriture") v.reserve = res;
    fermerF();
    // Affichage immédiat, puis enregistrement (vente + stock) par le serveur
    const id = "vente-" + Date.now().toString(36);
    D.ventes[id] = Object.assign({ vendeur: session.nom, cree: new Date().toISOString() }, v);
    if (destock) {
      const col = v.type === "ingredient" ? "ingredients" : "potions";
      const ch = res === "edmond" ? "stockEdmond" : "stock";
      const st = (v.type === "ingredient" ? ingV(v.article) : potV(v.article))[ch];
      (D[col][v.article] || (D[col][v.article] = {}))[ch] = Math.max(0, (+st || 0) - v.qte);
    }
    renderTout();
    enCours++; renderSync();
    try {
      const r = await appel({ action: "vendre", mdp: session.mdp, nom: session.nom, vente: v, destock, reserve: res });
      enCours--;
      if (!enCours) accepter(r);
      renderTout();
      toast("Vente enregistrée : " + nb(v.qte * v.prix) + " " + M);
    } catch (err) {
      enCours--;
      toast((err.message || "Échec de l'enregistrement") + " — vente non enregistrée.", true);
      charger(true);
    }
  };
  document.addEventListener("click", e => {
    const d = e.target.closest("[data-vente-del]");
    if (d && confirm("Supprimer cette vente ? (le stock n'est pas remis à jour)")) enregistrer("ventes", { [d.dataset.venteDel]: null }, "Vente supprimée");
  });

  /* =================================================================
     ACHATS (ingrédients d'alchimie — Elvara)
     ================================================================= */
  const achats = () => Object.keys(D.achats || {}).map(id => Object.assign({ id }, D.achats[id]));
  const totalAchat = a => Math.round((a.qte || 0) * (a.prix || 0) * 100) / 100;
  const somme = l => l.reduce((s, a) => s + totalAchat(a), 0);
  function renderAchats() {
    const tout = achats();
    const mois = [...new Set(tout.map(a => (a.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    const sel = $("#h-mois"), cur = sel.value;
    sel.innerHTML = `<option value="">Tous les achats</option>` + mois.map(m => `<option value="${m}">${fmtMois(m)}</option>`).join("");
    if (mois.includes(cur)) sel.value = cur;
    const m = sel.value, mots = norm($("#h-recherche").value).split(/\s+/).filter(Boolean);
    const l = tout.filter(a => (!m || (a.date || "").startsWith(m)) && mots.every(x => norm(nomIng(a.article) + " " + (a.fournisseur || "") + " " + (a.acheteur || "")).includes(x)));
    const auj = aujourdhui(), sem = lundi(auj);
    $("#h-resume").innerHTML = `
      <div class="bloc cadre"><strong>${nb(somme(tout.filter(a => a.date === auj)))}</strong><span>${M} dépensés aujourd'hui</span></div>
      <div class="bloc cadre"><strong>${nb(somme(tout.filter(a => a.date && lundi(a.date) === sem)))}</strong><span>${M} cette semaine</span></div>
      <div class="bloc cadre"><strong>${nb(somme(tout.filter(a => (a.date || "").startsWith(auj.slice(0, 7)))))}</strong><span>${M} ce mois-ci</span></div>
      <div class="bloc cadre"><strong>${nb(l.reduce((s, a) => s + (a.qte || 0), 0))}</strong><span>ingrédients achetés${m || mots.length ? " (sélection)" : ""}</span></div>`;
    const semaines = [...new Set(l.filter(a => a.date).map(a => lundi(a.date)))].sort().reverse();
    $("#h-jours").innerHTML = semaines.length ? semaines.map(s => {
      const ls = l.filter(a => a.date && lundi(a.date) === s);
      const jours = [...new Set(ls.map(a => a.date))].sort().reverse();
      return `<section class="semaine">
        <div class="semaine-tete"><h3>${esc(fmtSemaine(s))}</h3><p class="semaine-vendeurs"><span>Dépenses de la semaine : <b>${nb(somme(ls))} ${M}</b></span></p></div>
        ${jours.map(j => {
          const lj = ls.filter(a => a.date === j).sort((x, y) => (x.cree || "").localeCompare(y.cree || ""));
          return `<div class="jour"><div class="jour-tete"><h4>${esc(fmtJour(j))}</h4><span class="jour-total">Dépenses du jour : <b>${nb(somme(lj))} ${M}</b></span></div>
          <div class="table-wrap"><table class="registre achats">
            <thead><tr><th class="ic"></th><th>Ingrédient</th><th class="num">Qté</th><th class="num">Prix u.</th><th class="num">Total</th><th>Fournisseur</th><th>Acheté par</th>${gerante() ? "<th></th>" : ""}</tr></thead>
            <tbody>${lj.map(a => `<tr>
              <td class="ic"><img src="images/ingredients/${esc(a.article)}.webp" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
              <td class="nom">${esc(nomIng(a.article))}</td><td class="num">${nb(a.qte)}</td><td class="num">${nb(a.prix)}</td><td class="num"><b>${nb(totalAchat(a))}</b></td>
              <td>${esc(a.fournisseur || "")}</td><td class="mute">${esc(a.acheteur || "")}</td>
              ${gerante() ? `<td><button class="btn-sobre btn-petit" type="button" data-achat-del="${a.id}" title="Supprimer cet achat">✕</button></td>` : ""}</tr>`).join("")}</tbody>
            <tfoot><tr><td></td><td>Total du jour</td><td class="num">${nb(lj.reduce((s, a) => s + (a.qte || 0), 0))}</td><td></td><td class="num"><b>${nb(somme(lj))}</b></td><td></td><td></td>${gerante() ? "<td></td>" : ""}</tr></tfoot>
          </table></div></div>`;
        }).join("")}
      </section>`;
    }).join("") : `<p class="vide">${tout.length ? "Aucun achat pour cette sélection." : "Aucun achat enregistré pour le moment."}</p>`;
  }
  $("#h-mois").onchange = renderAchats;
  $("#h-recherche").addEventListener("input", renderAchats);
  const INGR_ALCHIMIE = INGREDIENTS.filter(i => !i.cuisine).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  function optionsAchat(filtre) {
    const q = norm(filtre || "");
    return INGR_ALCHIMIE.filter(i => !q || norm(i.nom).includes(q)).map(i => `<option value="${i.id}">${esc(i.nom)}${i.dlc ? " (" + esc(i.dlc) + ")" : ""}</option>`).join("");
  }
  function majAchat() {
    const f = $("#form-achat");
    $("#f-achat-total").textContent = "Total : " + nb((+f.qte.value || 0) * (+String(f.prix.value).replace(",", ".") || 0)) + " " + M
      + (f.article.value ? " · stock actuel : " + nb(ingV(f.article.value).stock) : "");
  }
  $("#h-ajouter").onclick = () => {
    const f = $("#form-achat"); f.reset(); f.date.value = aujourdhui();
    f.article.innerHTML = optionsAchat(""); f.prix.value = f.article.value ? ingV(f.article.value).prix : 0;
    majAchat(); ouvrirF("#f-achat");
  };
  $("#form-achat").filtre.oninput = e => { const f = e.target.form, avant = f.article.value; f.article.innerHTML = optionsAchat(e.target.value);
    if ([...f.article.options].some(o => o.value === avant)) f.article.value = avant; else if (f.article.value) f.prix.value = ingV(f.article.value).prix; majAchat(); };
  $("#form-achat").article.onchange = e => { e.target.form.prix.value = ingV(e.target.value).prix; majAchat(); };
  $("#form-achat").qte.oninput = majAchat;
  $("#form-achat").prix.oninput = majAchat;
  $("#form-achat").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    if (!f.article.value) { toast("Choisissez un ingrédient.", true); return; }
    const a = { date: f.date.value, article: f.article.value, qte: Math.max(1, Math.round(+f.qte.value || 1)),
      prix: Math.max(0, Math.round((+String(f.prix.value).replace(",", ".") || 0) * 100) / 100), fournisseur: f.fournisseur.value.trim() };
    const enstock = f.enstock.checked;
    fermerF();
    D.achats["achat-" + Date.now().toString(36)] = Object.assign({ acheteur: session.nom, cree: new Date().toISOString() }, a);
    if (enstock) (D.ingredients[a.article] || (D.ingredients[a.article] = {})).stock = (+ingV(a.article).stock || 0) + a.qte;
    renderTout(); enCours++; renderSync();
    try {
      const r = await appel({ action: "acheter", mdp: session.mdp, nom: session.nom, achat: a, enstock });
      enCours--; if (!enCours) accepter(r); renderTout();
      toast("Achat enregistré : " + a.qte + " × " + nomIng(a.article) + (enstock ? " ajouté(s) au stock" : ""));
    } catch (err) {
      enCours--; toast((err.message || "Échec de l'enregistrement") + " — achat non enregistré.", true); charger(true);
    }
  };
  document.addEventListener("click", e => {
    const d = e.target.closest("[data-achat-del]");
    if (d && confirm("Supprimer cet achat ? (le stock n'est pas remis à jour)")) enregistrer("achats", { [d.dataset.achatDel]: null }, "Achat supprimé");
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
