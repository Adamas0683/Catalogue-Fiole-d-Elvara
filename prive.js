/* =====================================================================
   LA FIOLE D'ELVARA — ESPACE PRIVÉ
   Gérante : voit et modifie tout. Employés : consultation seule, sans
   la carte.
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
  const CATS = ["Breuvages", "Soins et restauration", "Endurance", "Renforts", "Protections"];
  const VIDE = () => ({ ingredients: {}, potions: {}, carte: {}, accords: {}, ventes: {}, reglages: {} });
  // Mode démonstration (sans serveur) : mots de passe de test
  const MDP_DEMO = { "demo-gerante": "gerante", "demo-employe": "employe" };

  let session = null;            // { nom, mdp, role, demo }
  let D = VIDE();                // données du serveur (modifications)
  let infoSync = { maj: "", par: "" };
  let enCours = 0;

  /* =================================================================
     ACCÈS AU SERVEUR (ou au mode démonstration)
     ================================================================= */
  async function appel(corps) {
    if (session && session.demo) return demo(corps);
    const r = await fetch(API, { method: "POST", body: JSON.stringify(corps) });
    const d = await r.json();
    if (d.erreur) throw new Error(d.erreur);
    return d;
  }
  function demo(c) {
    const db = local.get("demo", null) || { donnees: VIDE(), maj: "", par: "" };
    if (c.action === "ecrire") {
      if (session.role !== "gerante") throw new Error("Accès en lecture seule : seule la gérante peut modifier.");
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
    if (session.role !== "gerante") donnees.carte = {};
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
  const potV = id => Object.assign({ stock: 0, seuil: 0, prix: byPot[id].prix, vitrine: byPot[id].vitrine }, D.potions[id] || {});
  const etat = v => v.seuil > 0 ? (v.stock <= 0 ? "rupture" : v.stock < v.seuil ? "bas" : "ok") : (v.stock > 0 ? "ok" : "vide");
  const ETAT = { ok: "En stock", bas: "Stock bas", rupture: "Rupture", vide: "Vide" };
  const vedettes = () => ((D.reglages.vitrine || {}).vedettes || []).filter(id => byPot[id]);
  function points() {
    if (!gerante()) return [];
    const out = [];
    CARTE_DEPART.forEach(p => { const o = D.carte[p.id]; if (o && o.supprime) return; out.push(Object.assign({}, p, o || {})); });
    Object.keys(D.carte).forEach(id => { if (!CARTE_DEPART.some(p => p.id === id) && !D.carte[id].supprime) out.push(Object.assign({ id, ingredients: [] }, D.carte[id])); });
    return out;
  }
  const accords = () => Object.keys(D.accords).map(id => Object.assign({ id }, D.accords[id]));
  const gerante = () => session && session.role === "gerante";

  /* =================================================================
     CONNEXION
     ================================================================= */
  function entrer(s) {
    session = s;
    $("#ecran-connexion").hidden = true; $("#registre").hidden = false;
    $("#r-nom").textContent = s.nom;
    $("#r-role").textContent = s.role === "gerante" ? "Gérante" : "Employé";
    $("#r-role").className = "badge " + s.role;
    document.body.classList.toggle("lecture-seule", s.role !== "gerante");
    $('[data-p="carte"]').hidden = s.role !== "gerante";
    if (onglet === "carte" && s.role !== "gerante") onglet = "accueil";
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
    if (p === "carte" && !gerante()) p = "accueil";
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
    $("#a-ajouter").hidden = !gerante();
    $("#v-ajouter").hidden = !gerante();
  }

  /* =================================================================
     TABLEAU DE BORD
     ================================================================= */
  function alertesListe() {
    const out = [];
    INGREDIENTS.forEach(i => {
      const v = ingV(i.id), e = etat(v);
      if (v.accord) out.push({ type: "accord", ico: "🔔", titre: i.nom + " : accord requis", detail: [v.chatellerie, v.accordTexte].filter(Boolean).join(" · ") || "Voir avec la gérante", aller: "ingredients" });
      if (e === "rupture" || e === "bas") out.push({ type: e, ico: e === "rupture" ? "⚠" : "◔", titre: "Ingrédient — " + i.nom, detail: `${ETAT[e]} : ${nb(v.stock)} / ${nb(v.seuil)}`, aller: "ingredients" });
    });
    POTIONS.forEach(p => {
      const v = potV(p.id), e = etat(v);
      if (e === "rupture" || e === "bas") out.push({ type: e, ico: e === "rupture" ? "⚠" : "◔", titre: "Potion — " + p.nom, detail: `${ETAT[e]} : ${nb(v.stock)} / ${nb(v.seuil)}`, aller: "potions" });
    });
    points().filter(p => p.accord).forEach(p => out.push({ type: "accord", ico: "🗺", titre: "Carte — " + p.titre, detail: p.accordTexte || ("Accord requis (" + (p.chatellerie || "châtellerie") + ")"), aller: "carte" }));
    const rang = { rupture: 0, accord: 1, bas: 2 };
    return out.sort((a, b) => rang[a.type] - rang[b.type]);
  }
  function renderAccueil() {
    const ingEnStock = INGREDIENTS.filter(i => ingV(i.id).stock > 0).length;
    const potEnStock = POTIONS.filter(p => potV(p.id).stock > 0).length;
    const valeurPot = POTIONS.reduce((a, p) => { const v = potV(p.id); return a + v.stock * v.prix; }, 0);
    const al = alertesListe();
    const nAlerte = al.filter(a => a.type !== "accord").length;
    const ac = accords();
    $("#resume").innerHTML = `
      <div class="bloc cadre"><strong>${ingEnStock}</strong><span>ingrédients en stock sur ${INGREDIENTS.length}</span></div>
      <div class="bloc cadre"><strong>${potEnStock}</strong><span>potions en stock sur ${POTIONS.length}</span></div>
      <div class="bloc cadre"><strong>${nb(valeurPot)}</strong><span>${M} de potions en réserve</span></div>
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
  function stockCell(col, id, v) {
    if (!gerante()) return `<b>${nb(v.stock)}</b>`;
    return `<div class="stock-edit"><button type="button" data-col="${col}" data-id="${id}" data-d="-1" aria-label="Retirer">−</button>
      <input type="number" min="0" inputmode="numeric" value="${v.stock}" data-col="${col}" data-id="${id}" data-champ="stock" aria-label="Stock">
      <button type="button" data-col="${col}" data-id="${id}" data-d="1" aria-label="Ajouter">+</button></div>`;
  }
  const champNum = (col, id, champ, val) => gerante()
    ? `<input class="prix-edit" type="number" min="0" value="${val}" data-col="${col}" data-id="${id}" data-champ="${champ}">`
    : `<span>${nb(val)}</span>`;

  function renderIngredients() {
    const mots = norm($("#i-recherche").value).split(/\s+/).filter(Boolean);
    const f = $("#i-filtre").value;
    const rows = INGREDIENTS.filter(i => {
      const v = ingV(i.id), e = etat(v);
      if (f === "alerte" && !(e === "bas" || e === "rupture")) return false;
      if (f === "accord" && !v.accord) return false;
      if (f === "stock" && !(v.stock > 0)) return false;
      return mots.every(m => norm(i.nom + " " + i.effets.join(" ") + " " + i.source + " " + (i.dlc || "")).includes(m));
    });
    $("#t-ingredients").innerHTML = `<thead><tr><th class="ic"></th><th>Ingrédient</th><th>Effets</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">Prix (${M})</th><th>Accord</th><th>État</th></tr></thead>
      <tbody>${rows.map(i => {
        const v = ingV(i.id), e = etat(v);
        return `<tr>
          <td class="ic"><img src="images/ingredients/${i.id}.webp" alt="" loading="lazy"></td>
          <td class="nom">${esc(i.nom)}${i.dlc ? ` <span class="mute" style="font-size:.8rem">(${i.dlc})</span>` : ""}<small>${esc(i.source)}</small></td>
          <td><div class="effets">${i.effets.map(x => `<span>${esc(x)}</span>`).join("")}</div></td>
          <td class="num">${stockCell("ingredients", i.id, v)}</td>
          <td class="num">${champNum("ingredients", i.id, "seuil", v.seuil)}</td>
          <td class="num">${champNum("ingredients", i.id, "prix", v.prix)}</td>
          <td><button class="cloche ${v.accord ? "on" : ""}" type="button" data-cloche="${i.id}" title="${gerante() ? "Indiquer un accord requis" : v.accord ? "Accord requis" : ""}" ${gerante() ? "" : "disabled"}>🔔</button>
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
    const cat = $("#p-cat").value, f = $("#p-filtre").value, ved = vedettes();
    $("#p-aide").textContent = gerante()
      ? "Le prix et la case « Vitrine » sont publiés sur la page des clients. ★ = mise en avant sur l'accueil (7 au maximum, la première en grand)."
      : "Consultation seule : les stocks, les prix et la vitrine sont gérés par la gérante.";
    const rows = POTIONS.filter(p => {
      const v = potV(p.id), e = etat(v);
      if (cat && p.categorie !== cat) return false;
      if (f === "alerte" && !(e === "bas" || e === "rupture")) return false;
      if (f === "vitrine" && !v.vitrine) return false;
      if (f === "cachee" && v.vitrine) return false;
      return mots.every(m => norm(p.nom + " " + p.famille + " " + p.effet).includes(m));
    });
    $("#t-potions").innerHTML = `<thead><tr><th class="ic"></th><th>Potion</th><th class="num">Stock</th><th class="num">Seuil</th><th class="num">Prix (${M})</th><th>Vitrine</th><th>Accueil</th><th>État</th></tr></thead>
      <tbody>${rows.map(p => {
        const v = potV(p.id), e = etat(v), iv = ved.indexOf(p.id);
        return `<tr>
          <td class="ic"><img src="images/potions/${p.img}" alt="" loading="lazy"></td>
          <td class="nom">${esc(p.nom)}<small>${esc(p.famille)} · ${esc(p.effet)}</small></td>
          <td class="num">${stockCell("potions", p.id, v)}</td>
          <td class="num">${champNum("potions", p.id, "seuil", v.seuil)}</td>
          <td class="num">${champNum("potions", p.id, "prix", v.prix)}</td>
          <td>${gerante() ? `<label class="case"><input type="checkbox" data-vitrine="${p.id}" ${v.vitrine ? "checked" : ""}></label>` : (v.vitrine ? "✓" : `<span class="mute">—</span>`)}</td>
          <td>${gerante() ? `<button class="cloche ${iv >= 0 ? "on" : ""}" type="button" data-vedette="${p.id}" title="Mettre en avant sur l'accueil">★</button>${iv === 0 ? `<span class="cloche-texte">en grand</span>` : ""}` : (iv >= 0 ? "★" : "")}</td>
          <td><span class="etat ${e}">${ETAT[e]}</span></td></tr>`;
      }).join("")}</tbody>`;
  }
  $("#p-recherche").addEventListener("input", renderPotions);
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
      const { col, id } = b.dataset, v = col === "ingredients" ? ingV(id) : potV(id);
      const s = Math.max(0, (+v.stock || 0) + (+b.dataset.d));
      planifier(col, id, { stock: s }, 700);
      const inp = b.parentElement.querySelector("input"); if (inp) inp.value = s;
      return;
    }
    const v = e.target.closest("[data-vedette]");
    if (v) {
      let l = vedettes(); const id = v.dataset.vedette;
      if (l.includes(id)) l = l.filter(x => x !== id);
      else { if (l.length >= 7) { toast("7 potions au maximum sur l'accueil : retirez-en une d'abord.", true); return; } l.push(id); }
      enregistrer("reglages", { vitrine: { vedettes: l } }, "Accueil de la vitrine mis à jour");
      return;
    }
    const c = e.target.closest("[data-cloche]");
    if (c && gerante()) ouvrirCloche(c.dataset.cloche);
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.matches("input[data-champ]")) {
      const val = Math.max(0, Math.round(+t.value || 0));
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
      <div class="actions"><button class="btn-sobre btn-petit" type="button" data-pt-edit="${p.id}">Modifier</button>
      <button class="btn-sobre btn-petit" type="button" data-pt-move="${p.id}">Déplacer</button>
      ${p.type === "boutique" ? "" : `<button class="btn-sobre btn-petit" type="button" data-pt-del="${p.id}">Supprimer</button>`}</div></div>`;
  }
  function renderCarte() {
    const liste = filtrePoints();
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
        ${gerante() ? `<div class="actions"><button class="btn-sobre btn-petit" type="button" data-ac-edit="${a.id}">Modifier</button><button class="btn-sobre btn-petit" type="button" data-ac-del="${a.id}">Supprimer</button></div>` : ""}
      </article>`).join("")
      : `<p class="vide">${f ? "Aucun accord dans cette catégorie." : "Aucun accord pour le moment." + (gerante() ? " Ajoutez le premier avec « Nouvel accord »." : "")}</p>`;
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
  document.addEventListener("click", e => {
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
  const fmtJour = j => { const d = new Date(j + "T12:00:00"); return isNaN(d) ? j : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
  const fmtMois = m => { const d = new Date(m + "-01T12:00:00"); return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); };

  function renderVentes() {
    const tout = ventes();
    const mois = [...new Set(tout.map(v => (v.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    const sel = $("#v-mois"), cur = sel.value;
    sel.innerHTML = `<option value="">Toutes les ventes</option>` + mois.map(m => `<option value="${m}">${fmtMois(m)}</option>`).join("");
    if (mois.includes(cur)) sel.value = cur;
    const m = sel.value, mots = norm($("#v-recherche").value).split(/\s+/).filter(Boolean);
    const l = tout.filter(v => (!m || (v.date || "").startsWith(m)) && mots.every(x => norm(nomArticle(v) + " " + (v.client || "") + " " + (v.vendeur || "")).includes(x)));
    const somme = a => a.reduce((s, v) => s + (v.qte || 0) * (v.prix || 0), 0);
    const auj = aujourdhui(), moisCourant = auj.slice(0, 7);
    $("#v-resume").innerHTML = `
      <div class="bloc cadre"><strong>${nb(totalJour(auj))}</strong><span>${M} aujourd'hui</span></div>
      <div class="bloc cadre"><strong>${nb(somme(tout.filter(v => (v.date || "").startsWith(moisCourant))))}</strong><span>${M} ce mois-ci</span></div>
      <div class="bloc cadre"><strong>${nb(somme(l))}</strong><span>${M} ${m || mots.length ? "pour cette sélection" : "au total"}</span></div>
      <div class="bloc cadre"><strong>${nb(l.reduce((s, v) => s + (v.qte || 0), 0))}</strong><span>articles vendus</span></div>`;
    const jours = [...new Set(l.map(v => v.date))].sort().reverse();
    $("#v-jours").innerHTML = jours.length ? jours.map(j => {
      const lj = l.filter(v => v.date === j).sort((a, b) => (a.cree || "").localeCompare(b.cree || ""));
      return `<section class="jour">
        <div class="jour-tete"><h3>${esc(fmtJour(j))}</h3><span class="jour-total">Total du jour : <b>${nb(somme(lj))} ${M}</b> · ${lj.reduce((s, v) => s + (v.qte || 0), 0)} article(s)</span></div>
        <div class="table-wrap"><table class="registre">
          <thead><tr><th class="ic"></th><th>Article</th><th>Type</th><th class="num">Qté</th><th class="num">Prix unitaire</th><th class="num">Total</th><th>Client</th><th>Vendu par</th>${gerante() ? "<th></th>" : ""}</tr></thead>
          <tbody>${lj.map(v => `<tr>
            <td class="ic">${imgArticle(v) ? `<img src="${imgArticle(v)}" alt="" loading="lazy">` : ""}</td>
            <td class="nom">${esc(nomArticle(v))}</td>
            <td>${v.type === "ingredient" ? "Ingrédient" : (byPot[v.article] && byPot[v.article].categorie === "Breuvages" ? "Breuvage" : "Potion")}</td>
            <td class="num">${nb(v.qte)}</td><td class="num">${nb(v.prix)}</td><td class="num"><b>${nb((v.qte || 0) * (v.prix || 0))}</b></td>
            <td>${esc(v.client || "")}</td><td class="mute">${esc(v.vendeur || "")}</td>
            ${gerante() ? `<td><button class="btn-sobre btn-petit" type="button" data-vente-del="${v.id}" title="Supprimer cette vente">✕</button></td>` : ""}
          </tr>`).join("")}</tbody>
        </table></div></section>`;
    }).join("") : `<p class="vide">${tout.length ? "Aucune vente pour cette sélection." : "Aucune vente enregistrée pour le moment."}</p>`;
  }
  $("#v-mois").onchange = renderVentes;
  $("#v-recherche").addEventListener("input", renderVentes);

  function optionsArticles(type) {
    if (type === "ingredient") return INGREDIENTS.map(i => `<option value="${i.id}">${esc(i.nom)}</option>`).join("");
    return CATS.map(c => `<optgroup label="${esc(c)}">${POTIONS.filter(p => p.categorie === c && !p.interdit).map(p => `<option value="${p.id}">${esc(p.nom)}</option>`).join("")}</optgroup>`).join("");
  }
  function prixCourant(type, id) { return type === "ingredient" ? (byIng[id] ? ingV(id).prix : 0) : (byPot[id] ? potV(id).prix : 0); }
  function majTotalVente() {
    const f = $("#form-vente");
    $("#f-vente-total").textContent = "Total : " + nb((+f.qte.value || 0) * (+f.prix.value || 0)) + " " + M;
  }
  $("#v-ajouter").onclick = () => {
    const f = $("#form-vente");
    f.reset(); f.date.value = aujourdhui(); f.type.value = "potion";
    f.article.innerHTML = optionsArticles("potion"); f.prix.value = prixCourant("potion", f.article.value);
    majTotalVente(); ouvrirF("#f-vente");
  };
  $("#form-vente").type.onchange = e => { const f = e.target.form; f.article.innerHTML = optionsArticles(f.type.value); f.prix.value = prixCourant(f.type.value, f.article.value); majTotalVente(); };
  $("#form-vente").article.onchange = e => { const f = e.target.form; f.prix.value = prixCourant(f.type.value, f.article.value); majTotalVente(); };
  $("#form-vente").qte.oninput = majTotalVente;
  $("#form-vente").prix.oninput = majTotalVente;
  $("#form-vente").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const v = { date: f.date.value, type: f.type.value, article: f.article.value, qte: Math.max(1, Math.round(+f.qte.value || 1)),
      prix: Math.max(0, Math.round(+f.prix.value || 0)), client: f.client.value.trim(), vendeur: session.nom, cree: new Date().toISOString() };
    const destock = f.destock.checked;
    fermerF();
    await enregistrer("ventes", { ["vente-" + Date.now().toString(36)]: v }, "Vente enregistrée : " + nb(v.qte * v.prix) + " " + M);
    if (destock) {
      const col = v.type === "ingredient" ? "ingredients" : "potions";
      const st = (v.type === "ingredient" ? ingV(v.article) : potV(v.article)).stock;
      enregistrer(col, { [v.article]: { stock: Math.max(0, (+st || 0) - v.qte) } });
    }
  };
  document.addEventListener("click", e => {
    const d = e.target.closest("[data-vente-del]");
    if (d && confirm("Supprimer cette vente ? (le stock n'est pas remis à jour)")) enregistrer("ventes", { [d.dataset.venteDel]: null }, "Vente supprimée");
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
