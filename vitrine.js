/* =====================================================================
   LA FIOLE ET LA MARMITE — VITRINE PUBLIQUE
   Affiche les potions et leurs prix. Si le serveur Google est configuré
   (config.js), les prix, la sélection de la vitrine et la disponibilité
   viennent de l'espace privé de la gérante.
   ===================================================================== */
(function () {
  const $ = s => document.querySelector(s);
  const norm = s => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nb = n => Number(n).toLocaleString("fr-FR");
  const M = BOUTIQUE.monnaie;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("fiole-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("fiole-" + k, JSON.stringify(v)); } catch (e) {} },
  };
  const API = (typeof FIOLE_EN_LIGNE === "string" && FIOLE_EN_LIGNE.trim()) || "";
  const CATS = ["Breuvages", "Soins et restauration", "Endurance", "Renforts", "Protections", "Nourriture"];

  /* ---------- Textes ---------- */
  $("#m-nom").textContent = BOUTIQUE.nom;
  $("#m-lieu").textContent = BOUTIQUE.sousTitre + " · " + BOUTIQUE.lieu;
  $("#titre").textContent = BOUTIQUE.nom;
  $("#sous-titre").textContent = BOUTIQUE.sousTitre + " — " + BOUTIQUE.lieu;
  $("#apropos-texte").textContent = BOUTIQUE.accroche;
  $("#infos").innerHTML = `<li><b>Adresse</b><span>${esc(BOUTIQUE.lieu)}</span></li>
    <li><b>Gérante</b><span>${esc(BOUTIQUE.gerante)}</span></li>
    <li><b>Horaires</b><span>${esc(BOUTIQUE.horaires)}</span></li>`;
  $("#pied").textContent = BOUTIQUE.nom + " · " + BOUTIQUE.lieu;

  /* ---------- Données ---------- */
  const P = POTIONS.map(p => ({ ...p, stock: null }));
  const byId = Object.fromEntries(P.map(p => [p.id, p]));
  let vedettes = { potions: null, plats: null }; // choix d'Elvara (potions) et d'Edmond (plats)

  const visibles = () => P.filter(p => p.vitrine);
  let cat = "Tout", dispoOnly = false;

  /* ---------- Rendu ---------- */
  const img = p => `images/potions/${p.img}`;
  const prixTxt = p => p.interdit ? "Interdit" : nb(p.prix) + " " + M;
  const dispo = p => p.stock == null ? "" : p.stock > 0 ? `<span class="dispo">En stock</span>` : `<span class="dispo non">Sur commande</span>`;

  function renderSommaire() {
    $("#sommaire").innerHTML = CATS.map(c => {
      const n = visibles().filter(p => p.categorie === c).length;
      return n ? `<li><a href="#cat-${c.replace(/\s+/g, "-")}" data-cat="${esc(c)}">${esc(c)}<small>${n}</small></a></li>` : "";
    }).join("") + `<li><a href="#apropos">La boutique</a></li>`;
  }

  // Carte de l'accueil : 4 potions (choisies par Elvara) et 4 plats (choisis par Edmond),
  // complétées automatiquement si la sélection est incomplète.
  function choixVedettes(choix, pref, filtre) {
    const v = visibles().filter(p => !p.interdit && filtre(p));
    const ids = [...new Set([...(choix || []), ...pref, ...v.map(p => p.id)])];
    return ids.map(id => byId[id]).filter(p => p && p.vitrine && !p.interdit && filtre(p)).slice(0, 4);
  }
  function renderHeros() {
    const plat = p => p.categorie === "Nourriture";
    const rangs = [
      ["Remèdes du jour", choixVedettes(vedettes.potions, ["0003eadf", "0003eae2", "0003eb09", "00039e52"], p => !plat(p))],
      ["De la marmite", choixVedettes(vedettes.plats, ["ragout-boeuf", "tarte-pommes", "fondue-elsweyr", "filet-saumon"], plat)],
    ].filter(r => r[1].length);
    $("#etageres").innerHTML = rangs.map(([titre, r]) => `
      <div class="etagere cadre">
        <div class="etagere-titre">${titre}</div>
        <div class="etagere-rang">${r.map(p => `
          <button class="fiole-mini" type="button" data-id="${p.id}" title="Ajouter à ma liste">
            <img src="${img(p)}" alt="">
            <span class="etiquette">${esc(p.nom)}</span>
            <span class="prix">${nb(p.prix)} ${M}</span>
          </button>`).join("")}</div>
        <div class="etagere-sol"></div>
      </div>`).join("");
  }

  ["Tout", ...CATS].forEach(c => {
    const b = document.createElement("button");
    b.className = "onglet"; b.type = "button"; b.textContent = c; b.dataset.cat = c;
    b.setAttribute("aria-pressed", c === cat);
    b.onclick = () => choisirCat(c);
    $("#onglets").appendChild(b);
  });
  function choisirCat(c) {
    cat = c;
    document.querySelectorAll(".onglet").forEach(x => x.setAttribute("aria-pressed", x.dataset.cat === c));
    renderListe();
  }

  function renderListe() {
    const mots = norm($("#recherche").value).split(/\s+/).filter(Boolean);
    let html = "";
    CATS.forEach(c => {
      if (cat !== "Tout" && c !== cat) return;
      const items = visibles().filter(p => p.categorie === c
        && (!dispoOnly || p.stock == null || p.stock > 0)
        && mots.every(m => norm(p.nom + " " + (p.en || "") + " " + p.famille + " " + p.effet).includes(m)));
      if (!items.length) return;
      const familles = [...new Set(items.map(p => p.famille))];
      html += `<section class="categorie" id="cat-${c.replace(/\s+/g, "-")}"><h3>${esc(c)} <small>${items.length} article${items.length > 1 ? "s" : ""}</small></h3>
        ${familles.map(f => `<div class="famille"><h4>${esc(f)}</h4><div class="cartes">
          ${items.filter(p => p.famille === f).map(p => `
            <article class="carte${p.interdit ? " carte-interdite" : ""}">
              <div class="carte-img"><img src="${img(p)}" alt="" loading="lazy"></div>
              <span class="carte-nom">${esc(p.nom)}</span>${p.en ? `<span class="carte-en">${esc(p.en)}</span>` : ""}
              <span class="carte-effet">${esc(p.effet)}</span>
              <div class="carte-pied">
                ${p.interdit ? `<span class="interdit">Interdit par décret impérial</span>` : `<div><span class="prix">${nb(p.prix)} ${M}</span><br>${dispo(p)}</div>
                <button class="ajouter" type="button" data-id="${p.id}" title="Ajouter à ma liste">+</button>`}
              </div>
            </article>`).join("")}
        </div></div>`).join("")}
      </section>`;
    });
    $("#liste").innerHTML = html || `<p class="vide">Aucun article ne correspond à votre recherche.</p>`;
  }

  function renderOnglets() {
    document.querySelectorAll(".onglet").forEach(b => { b.hidden = b.dataset.cat !== "Tout" && !visibles().some(p => p.categorie === b.dataset.cat); });
  }
  function renderTout() { renderOnglets(); renderSommaire(); renderHeros(); renderListe(); renderPanier(); }

  /* ---------- Liste de commande ---------- */
  let panier = store.get("panier", []).filter(l => byId[l.id] && !byId[l.id].interdit);
  function ajouter(id) {
    const l = panier.find(x => x.id === id);
    if (l) l.qte++; else panier.push({ id, qte: 1 });
    store.set("panier", panier); renderPanier();
    toast(byId[id].nom + " : ajouté à votre liste");
  }
  function renderPanier() {
    const n = panier.reduce((a, l) => a + l.qte, 0);
    $("#liste-n").textContent = n;
    const total = panier.reduce((a, l) => a + byId[l.id].prix * l.qte, 0);
    $("#liste-total").textContent = nb(total) + " " + M;
    $("#liste-corps").innerHTML = panier.length ? panier.map(l => {
      const p = byId[l.id];
      return `<div class="ligne"><img src="${img(p)}" alt="">
        <div>${esc(p.nom)}<small>${nb(p.prix)} ${M} l'unité</small></div>
        <div class="qte"><button type="button" data-q="-1" data-id="${p.id}" aria-label="Retirer">−</button><b>${l.qte}</b><button type="button" data-q="1" data-id="${p.id}" aria-label="Ajouter">+</button></div></div>`;
    }).join("") : `<p class="vide">Votre liste est vide.</p>`;
  }
  const ouvrir = o => { $("#tiroir").classList.toggle("ouvert", o); $("#voile").classList.toggle("ouvert", o); };
  $("#liste-ouvrir").onclick = () => ouvrir(true);
  $("#liste-fermer").onclick = $("#voile").onclick = () => ouvrir(false);
  $("#liste-vider").onclick = () => { panier = []; store.set("panier", panier); renderPanier(); };
  $("#liste-copier").onclick = async () => {
    if (!panier.length) return;
    const total = panier.reduce((a, l) => a + byId[l.id].prix * l.qte, 0);
    const txt = [`Commande — ${BOUTIQUE.nom}`, ...panier.map(l => `- ${l.qte} x ${byId[l.id].nom} : ${nb(byId[l.id].prix * l.qte)} ${M}`), `Total : ${nb(total)} ${M}`].join("\n");
    try { await navigator.clipboard.writeText(txt); toast("Liste copiée : collez-la à la boutique"); }
    catch (e) { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); toast("Liste copiée"); }
  };

  /* ---------- Événements ---------- */
  document.addEventListener("click", e => {
    const a = e.target.closest(".ajouter, .fiole-mini");
    if (a) { ajouter(a.dataset.id); return; }
    const q = e.target.closest(".qte button");
    if (q) {
      const l = panier.find(x => x.id === q.dataset.id); if (!l) return;
      l.qte += +q.dataset.q; if (l.qte <= 0) panier = panier.filter(x => x !== l);
      store.set("panier", panier); renderPanier(); return;
    }
    const s = e.target.closest(".sommaire a[data-cat]");
    if (s) { choisirCat("Tout"); }
    if (e.target.closest(".nav a")) $("#nav").classList.remove("ouvert");
  });
  $("#recherche").addEventListener("input", renderListe);
  $("#f-dispo").onchange = e => { dispoOnly = e.target.checked; renderListe(); };
  $("#burger").onclick = () => $("#nav").classList.toggle("ouvert");
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("#recherche").focus(); }
    if (e.key === "Escape") ouvrir(false);
  });

  let tt;
  function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("visible"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("visible"), 1800); }

  /* ---------- Données en ligne (prix de la gérante) ---------- */
  // Réglages de la vitrine : { potions: [...], plats: [...] } (ancien format : vedettes: [...])
  function lireVedettes(r) {
    if (Array.isArray(r)) r = { vedettes: r };
    const anc = Array.isArray(r.vedettes) ? r.vedettes : [];
    const plat = id => byId[id] && byId[id].categorie === "Nourriture";
    return { potions: Array.isArray(r.potions) ? r.potions : anc.filter(id => !plat(id)), plats: Array.isArray(r.plats) ? r.plats : anc.filter(plat) };
  }
  // Mode démonstration : reprend les réglages faits dans l'espace privé de ce navigateur
  function appliquer(potions, vit) {
    Object.entries(potions || {}).forEach(([id, x]) => {
      const p = byId[id]; if (!p) return;
      if (x.prix != null) p.prix = x.prix;
      if (x.vitrine != null) p.vitrine = !!x.vitrine;
    });
    if (vit) vedettes = lireVedettes(vit);
  }
  if (!API) { const db = store.get("demo", null); if (db && db.donnees) appliquer(db.donnees.potions, (db.donnees.reglages || {}).vitrine); }
  renderTout();
  if (API) {
    fetch(API + (API.includes("?") ? "&" : "?") + "t=" + Date.now())
      .then(r => r.json())
      .then(d => {
        const pots = d && d.potions || {};
        Object.entries(pots).forEach(([id, v]) => {
          const p = byId[id]; if (!p) return;
          if (v.prix != null) p.prix = v.prix;
          if (v.vitrine != null) p.vitrine = !!v.vitrine;
          if (v.dispo != null) p.stock = v.dispo ? 1 : 0;
        });
        if (d.vedettes) vedettes = lireVedettes(d.vedettes);
        renderTout();
      })
      .catch(() => {});
  }
})();
