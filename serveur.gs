/* =====================================================================
   LA FIOLE ET LA MARMITE — SERVEUR (Google Apps Script)
   ---------------------------------------------------------------------
   Ce code ne va PAS sur GitHub : il se colle dans un projet Apps Script
   (script.google.com). Voir LISEZMOI.txt, « Mise en place ».

   Il crée tout seul une feuille Google « La Fiole et la Marmite — données »
   dans le Drive de la gérante, avec deux onglets :
     Données    : collection | id | contenu | modifié le | par
     Historique : date | personne | rôle | collection | élément | détail

   Comptes (identifiant + mot de passe) :
     - Elvara, Amaury et Edmond (responsables) : les mêmes droits sur toute
                            la boutique (alchimie ET cuisine : stocks, prix,
                            vitrine, offres d'achat, ventes, carte, accords,
                            stock de l'Eau Noire)
     - Aldéric, Roland (employés de la Fiole) : voient tout ; enregistrent
                            leurs ventes, ajouts et retraits, proposent des
                            accords et acceptent les offres d'achat
   Le nom enregistré dans les ventes est celui du compte (impossible de
   signer au nom d'un autre). Après 8 essais ratés sur un identifiant,
   celui-ci est bloqué 15 minutes.
   ===================================================================== */

// Mots de passe : à remplacer ICI, dans l'éditeur Apps Script uniquement
// (jamais dans le fichier publié sur GitHub). Un mot de passe qui commence
// encore par « change-moi » est refusé.
const MDP_GERANTE = "change-moi-gerante";      // Elvara (alchimie)
const MDP_AMAURY = "change-moi-amaury";        // Amaury (mêmes droits qu'Elvara)
const MDP_CUISINIER = "change-moi-cuisinier";  // Edmond (cuisine)
const MDP_ALDERIC = "change-moi-alderic";      // employé
const MDP_ROLAND = "change-moi-roland";        // employé (arrivé en novembre)

const COMPTES = {
  "Elvara":  { mdp: MDP_GERANTE, role: "gerante" },
  "Amaury":  { mdp: MDP_AMAURY, role: "gerante" },
  "Edmond":  { mdp: MDP_CUISINIER, role: "cuisinier" },
  "Aldéric": { mdp: MDP_ALDERIC, role: "employe" },
  "Roland":  { mdp: MDP_ROLAND, role: "employe" },
};
// MODE MAINTENANCE : mettre true pour fermer la boutique à TOUT le monde
// (vitrine et espace privé), puis publier une nouvelle version.
// Remettre false (et publier une nouvelle version) pour rouvrir.
const MAINTENANCE = false;
const MESSAGE_MAINTENANCE = "La boutique est fermée pour maintenance. Revenez un peu plus tard.";

const ESSAIS_MAX = 8, BLOCAGE_SECONDES = 900;
const normId = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const COLLECTIONS = ["ingredients", "potions", "carte", "accords", "ventes", "achats", "offres", "mouvements", "notes", "reglages", "eaunoire", "packs", "recoltes"];
// Carte des récoltes (collection « carte ») : visible par ces comptes ;
// seul Aldéric y place, modifie et supprime des points.
// Prix de vente des ingrédients = prix de rachat × COEF_VENTE_ING (à garder identique à prive.js)
const COEF_VENTE_ING = 1.5;
const COMPTES_CARTE = ["Elvara", "Amaury", "Edmond", "Aldéric"];
const EDITEURS_CARTE = ["Aldéric"];
const accesCarte = nom => COMPTES_CARTE.some(n => normId(n) === normId(nom));
const editeurCarte = nom => EDITEURS_CARTE.some(n => normId(n) === normId(nom));
// Stock de l'Eau Noire (potions et plats à attribuer, membres, métiers, remises) :
// visible UNIQUEMENT par ces comptes, qui y ont tous les mêmes droits.
const COMPTES_EAU_NOIRE = ["Elvara", "Amaury", "Edmond"];
const accesEauNoire = nom => COMPTES_EAU_NOIRE.some(n => normId(n) === normId(nom));
function refusEauNoire(role, nom, ch) {
  return accesEauNoire(nom) ? "" : "Le stock de l'Eau Noire est réservé à " + COMPTES_EAU_NOIRE.join(", ") + ".";
}
// Objets interdits : visibles dans l'espace privé, JAMAIS sur la vitrine
// (Skooma, potions d'invisibilité et de furtivité, tous les poisons).
// Liste tirée de data.js (champ « interdit ») : à tenir à jour ensemble.
const INTERDITS = [
  "skooma", "0003eb3e", "0003eb33", "00039968", "00039969", "0003996f", "0003eb40", "0003eb3f",
  "0003eb41", "0003a5a4", "00073f31", "00073f32", "00073f33", "00073f34", "00065a65", "00073f39",
  "00073f3a", "00073f3b", "00073f3c", "00065a66", "00073f41", "00073f42", "00073f43", "00073f44",
  "00065a68", "00073f5e", "00073f5f", "00073f60", "00073f61", "00065a69", "00073f5a", "00073f5b",
  "00073f5c", "00073f5d", "00065a6a", "00074a38", "00074a39", "00074a3a", "00074a3b", "00065a6b",
  "00073f49", "00073f4a", "00073f4b", "00073f4c", "00065a6c", "00073f4d", "00073f4e", "00073f4f",
  "00073f50", "00065a6e", "00073f56", "00073f57", "00073f58", "00073f59", "00073f52", "00065a6d",
  "00073f53", "00073f54", "00073f55", "00073f90", "00073f91", "00073f92", "00073f93", "00073f94",
  "00073f8b", "00073f8c", "00073f8d", "00073f8e", "00065a6f", "00073f35", "00073f36", "00073f37",
  "00073f38", "00065a70", "00073f3d", "00073f3e", "00073f3f", "00073f40", "00065a71", "00073f45",
  "00073f46", "00073f47", "00073f48", "000e41b8", "000e2d3d", "00058cfb", "000cd883",
  "potion-crochetage", "potion-vol-a-la-tire"
];
// Partie « cuisine » (gérée par Edmond). Tout le reste est l'alchimie
// (gérée par Elvara). Les ingrédients « communs » appartiennent aux deux.
// Listes tirées de data.js : en cas d'ajout d'un plat ou d'une denrée
// dans data.js, l'ajouter ici aussi.
const CUISINE_POTIONS = [
  "chausson-pommes", "tarte-pommes", "tarte-jazbay", "tarte-genievres", "tarte-givreboises",
  "chausson-poulet", "chausson-lavande", "petit-pain", "bouchee-creme", "pain", "pain-tresse",
  "pain-pommes-de-terre", "pain-ail", "pommes-de-terre-four", "fondue-elsweyr", "ragout-boeuf",
  "ragout-venaison", "ragout-lapin", "ragout-horqueur", "ragout-horqueur-cendres", "ragout-chou",
  "soupe-chou-pommes-de-terre", "soupe-chou", "soupe-palourdes", "soupe-pommes-de-terre",
  "soupe-tomates", "soupe-legumes", "steak-mammouth", "sanglier-grille", "boeuf-cuit",
  "boeuf-epice", "cotelette-venaison", "cuissot-cheval", "gigot-chevre-grille", "tourte-horqueur",
  "poulet-grille", "roti-faisan", "cuisse-lapin", "filet-saumon", "poisson-carnassier-grille",
  "pattes-vasard-vapeur", "poireaux-grilles", "meule-eidar", "tranches-eidar", "morceau-eidar",
  "meule-chevre", "tranches-chevre", "morceau-chevre", "bol-fromage-mammouth", "bonbon-caramel",
  "friandise-miel", "flasque-eau-de-vie", "rat-cuit", "vide-d-ame"
];
const CUISINE_INGREDIENTS = [
  "sac-de-farine", "beurre", "pot-de-lait", "pomme-de-terre", "poireau", "chou", "carotte",
  "tomate", "pomme-rouge", "pomme-verte", "boeuf-cru", "venaison", "blanc-de-poulet",
  "viande-de-horqueur", "viande-de-cheval", "gigot-de-chevre", "poitrine-de-faisan",
  "patte-de-lapin-crue", "chair-de-saumon", "chair-de-palourde", "pattes-de-vasard",
  "pomme-de-cendres", "viande-de-sanglier", "cerise", "orange", "peche", "poire", "gourde",
  "viande-de-chien", "viande-de-rat"
];
const COMMUN_INGREDIENTS = [
  "ail", "genievres", "givreboises", "lavande", "raisin-jazbay", "sucrelune", "tas-de-sel", "miel", "ble", "oeuf-de-poule"
];
// Parties auxquelles appartient un article
function domaines(col, id) {
  if (col === "ingredients" && COMMUN_INGREDIENTS.indexOf(id) >= 0) return ["alchimie", "cuisine"];
  return [(col === "potions" ? CUISINE_POTIONS : CUISINE_INGREDIENTS).indexOf(id) >= 0 ? "cuisine" : "alchimie"];
}
const domaineRole = role => role === "gerante" ? "alchimie" : role === "cuisinier" ? "cuisine" : null;
// Partie où l'on peut vendre / accepter une offre : les employés travaillent pour la Fiole (alchimie)
const partieTravail = role => domaineRole(role) || "alchimie";
// Elvara, Amaury et Edmond (responsables) ont les mêmes droits sur la Fiole ET la Marmite
const gere = role => role === "gerante" || role === "cuisinier";
// Vérifie qu'un changement est permis au rôle (renvoie un message d'erreur, ou "")
function refus(role, col, ch) {
  if (!gere(role)) return "Les employés peuvent seulement enregistrer des ventes, des ajouts et des retraits.";
  if (col === "potions" && Object.keys(ch).some(id => INTERDITS.indexOf(id) >= 0 && ch[id] && ch[id].vitrine === true)) return "Un objet interdit ne peut pas aller sur la vitrine.";
  if (col === "reglages") {
    const ok = Object.keys(ch).every(id => id === "vitrine" && ch[id] && Object.keys(ch[id]).every(k => k === "potions" || k === "plats"));
    return ok ? "" : "Réglage non autorisé.";
  }
  // Packs promo : jamais d'objet interdit dedans (ils sont affichés sur la vitrine)
  if (col === "packs") {
    const ok = Object.keys(ch).every(id => !ch[id] || !Array.isArray(ch[id].lignes) || ch[id].lignes.every(l => INTERDITS.indexOf(String(l.article)) < 0));
    return ok ? "" : "Un pack ne peut pas contenir d'objet interdit.";
  }
  if (col === "offres") {
    const ok = Object.keys(ch).every(id => ch[id] === null);
    return ok ? "" : "Une offre se modifie par ses boutons (accepter, valider).";
  }
  return ""; // tout le reste : Elvara, Amaury et Edmond
}

/* ---------- Lecture publique (vitrine) : prix et disponibilité ---------- */
function doGet() {
  if (MAINTENANCE) return json({ maintenance: true, message: MESSAGE_MAINTENANCE });
  try { return json(publique()); }
  catch (err) { return json({ erreur: "Erreur du serveur Google : " + (err && err.message ? err.message : err) }); }
}

function publique() {
  const d = lireTout();
  const potions = {};
  Object.keys(d.potions).forEach(id => {
    const v = d.potions[id];
    if (INTERDITS.indexOf(id) >= 0) return;   // jamais sur la vitrine
    const q = v.stock == null && v.stockEdmond == null ? null : (Number(v.stock) || 0) + (Number(v.stockEdmond) || 0);
    potions[id] = { prix: v.prix, vitrine: v.vitrine, dispo: q == null ? null : q > 0 };
  });
  const r = d.reglages.vitrine || {}, sans = l => Array.isArray(l) ? l.filter(id => INTERDITS.indexOf(id) < 0) : null;
  // Packs promo visibles sur la vitrine
  const packs = Object.keys(d.packs).filter(id => d.packs[id].vitrine !== false).map(id => {
    const k = d.packs[id];
    return { id: id, nom: k.nom, description: k.description || "", prix: k.prix, lignes: (k.lignes || []).filter(l => INTERDITS.indexOf(String(l.article)) < 0) };
  });
  return { potions: potions, packs: packs, vedettes: { potions: sans(r.potions), plats: sans(r.plats), vedettes: sans(r.vedettes) }, maj: prop("maj") };
}

/* ---------- Espace privé ---------- */
// Toute erreur est renvoyée au site (au lieu d'une page d'erreur Google,
// que le navigateur bloque en affichant une fausse erreur « CORS »).
function doPost(e) {
  try { return traiter(e); }
  catch (err) { return json({ erreur: "Erreur du serveur Google : " + (err && err.message ? err.message : err) }); }
}

function traiter(e) {
  if (MAINTENANCE) return json({ maintenance: true, erreur: MESSAGE_MAINTENANCE });
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json({ erreur: "Requête invalide." }); }
  // Connexion : identifiant + mot de passe, avec blocage après trop d'essais
  const mdp = String(d.mdp || "").trim(), id = normId(d.nom);
  const cache = CacheService.getScriptCache(), cle = "essais-" + id;
  const essais = Number(cache.get(cle) || 0);
  if (essais >= ESSAIS_MAX) return json({ erreur: "Trop d'essais ratés pour cet identifiant : réessayez dans 15 minutes." });
  const compte = Object.keys(COMPTES).find(k => normId(k) === id);
  const attendu = compte ? String(COMPTES[compte].mdp).trim() : "";
  if (!compte || !mdp || /^change-moi/.test(attendu) || mdp !== attendu) {
    cache.put(cle, String(essais + 1), BLOCAGE_SECONDES);
    return json({ erreur: compte && /^change-moi/.test(attendu) ? "Le mot de passe de ce compte n'est pas encore défini dans le script." : "Identifiant ou mot de passe incorrect." });
  }
  if (essais) cache.remove(cle);
  const role = COMPTES[compte].role;
  d.nom = compte;   // le nom enregistré est toujours celui du compte

  if (d.action === "lire") return json(reponse(role, compte));

  // Ventes et achats (plusieurs lignes à la fois), séparés par partie :
  //   vente : tous les rôles (Elvara : alchimie, Edmond : cuisine, employés : les deux)
  //   achat direct : responsable de la partie (le site passe par les offres d'achat)
  // Si demandé, les quantités sont retirées (vente) ou ajoutées (achat) au stock.
  // Ajouts et retraits de stock (récolte, fabrication, perte…) : même règles que les achats.
  if (d.action === "vendre" || d.action === "acheter" || d.action === "ajouter" || d.action === "retirer") {
    const mvt = d.action === "ajouter" || d.action === "retirer", plus = d.action === "acheter" || d.action === "ajouter";
    const achat = d.action === "acheter" || mvt;   // mêmes droits que l'achat
    // Ancien format (une seule vente) accepté
    if (!d.lignes && d.vente) d = { action: d.action, mdp: d.mdp, nom: d.nom, date: d.vente.date, tiers: d.vente.client, lignes: [d.vente], stock: d.destock, reserve: d.reserve };
    const dom = d.domaine === "cuisine" ? "cuisine" : d.domaine === "alchimie" ? "alchimie" : null;
    const lignes = Array.isArray(d.lignes) ? d.lignes.slice(0, 40) : [];
    const mien = gere(role) ? null : partieTravail(role);   // employés : la Fiole
    const date = String(d.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !lignes.length) return json({ erreur: (achat ? "Achat" : "Vente") + " incomplet" + (achat ? "." : "e.") });
    const dmn = dom || (function () { const l = lignes[0]; return domaines(l.type === "ingredient" ? "ingredients" : "potions", String(l.article))[0]; })();
    if (mvt) d.stock = true;
    // Vente : le stock est toujours retiré ; seuls Elvara, Amaury et Edmond peuvent
    // ne pas le retirer, en donnant un motif
    if (d.action === "vendre" && !d.stock) {
      if (!gere(role)) d.stock = true;
      else if (!String(d.motifStock || "").trim()) return json({ erreur: "Indiquez pourquoi le stock n'est pas retiré." });
    }
    if (d.action === "acheter" && role === "employe") return json({ erreur: "Les achats sont réservés à Elvara, Amaury et Edmond." });
    if (mien && mien !== dmn) return json({ erreur: (mvt ? "Opération non autorisée" : achat ? "Achat non autorisé" : "Vente non autorisée") + " pour cette partie." });
    const propres = [], catalogue = lireTout();
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i], type = ["potion", "nourriture", "ingredient"].indexOf(l.type) >= 0 ? l.type : null, art = String(l.article || "").slice(0, 80);
      if (!type || !art) return json({ erreur: "Ligne " + (i + 1) + " incomplète." });
      const col = type === "ingredient" ? "ingredients" : "potions";
      if (domaines(col, art).indexOf(dmn) < 0) return json({ erreur: "Ligne " + (i + 1) + " : cet article n'appartient pas à la partie " + dmn + "." });
      // Le prix ne se modifie pas à la vente / à l'achat : prix du catalogue s'il a été fixé
      // Ingrédients : rachat × COEF_VENTE_ING (1,5) (même calcul que le site), sauf prix forcé par Elvara, Amaury ou Edmond
      const fiche = catalogue[col][art] || {};
      const fixe = type === "ingredient" && !fiche.prixForce ? Math.round((Number(fiche.prixAchat) || 0) * COEF_VENTE_ING * 100) / 100 : fiche.prix;
      const prix = fixe != null && fixe !== "" ? Number(fixe) : Number(l.prix) || 0;
      propres.push({ type: type, article: art, col: col, qte: Math.max(1, Math.round(Number(l.qte) || 1)), prix: Math.max(0, Math.round(prix * 100) / 100) });
    }
    const nom = String(d.nom || "").slice(0, 60), tiers = String(d.tiers || "").slice(0, 80), maintenant = new Date().toISOString();
    const champStock = l => l.type === "ingredient" ? (dmn === "cuisine" && COMMUN_INGREDIENTS.indexOf(l.article) >= 0 ? "stockCuisine" : "stock")
      : l.type === "nourriture" && d.reserve === "edmond" ? "stockEdmond" : "stock";
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      const recs = {}, base = (mvt ? "mvt-" : achat ? "achat-" : "vente-") + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      propres.forEach((l, i) => {
        const r = { date: date, type: l.type, article: l.article, qte: l.qte, prix: l.prix, domaine: dmn, cree: maintenant };
        if (mvt) { r.sens = plus ? "ajout" : "retrait"; r.motif = tiers; r.par = nom; delete r.prix; }
        else if (achat) { r.fournisseur = tiers; r.acheteur = nom; } else { r.client = tiers; r.vendeur = nom; r.stock = !!d.stock; if (!d.stock) r.motifStock = String(d.motifStock || "").slice(0, 200); }
        if (l.type === "nourriture") r.reserve = champStock(l) === "stockEdmond" ? "edmond" : "eau-noire";
        recs[base + "-" + i] = r;
      });
      ecrire(mvt ? "mouvements" : achat ? "achats" : "ventes", recs, nom, role);
      if (d.stock) {
        const tout = lireTout(), ch = { potions: {}, ingredients: {} };
        propres.forEach(l => {
          const c = champStock(l), cur = ch[l.col][l.article] || (ch[l.col][l.article] = {});
          const avant = cur[c] != null ? cur[c] : (Number((tout[l.col][l.article] || {})[c]) || 0);
          cur[c] = Math.max(0, avant + (plus ? l.qte : -l.qte));
        });
        if (Object.keys(ch.potions).length) ecrire("potions", ch.potions, nom, role);
        if (Object.keys(ch.ingredients).length) ecrire("ingredients", ch.ingredients, nom, role);
      }
    } finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }

  // Accords : un employé PROPOSE un accord (statut « propose ») ; seuls
  // Elvara, Amaury et Edmond le valident ou le modifient (action « ecrire »).
  if (d.action === "proposer") {
    const a = d.accord || {}, o = {};
    ["partenaire", "lieu", "chatellerie", "type", "produits", "conditions", "debut", "fin", "contact"].forEach(k => o[k] = String(a[k] || "").trim().slice(0, 500));
    if (!o.partenaire) return json({ erreur: "Indiquez le partenaire." });
    o.statut = "propose"; o.proposePar = d.nom; o.proposeLe = new Date().toISOString();
    return avecVerrou(() => ecrire("accords", { ["accord-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)]: o }, d.nom, role), role, d.nom);
  }

  // Offres d'achat :
  //   offrir  : Elvara / Amaury (alchimie) ou Edmond (cuisine) créent l'offre
  //   prendre : n'importe qui (Fiole ou Marmite) l'accepte -> statut « en-cours »
  //   lacher  : celui qui l'a prise (ou le responsable) la remet « ouverte »
  //   valider : le responsable, une fois l'achat fait en jeu -> « validee » ;
  //             l'achat est inscrit dans la trésorerie et ajouté au stock
  if (["offrir", "prendre", "lacher", "valider"].indexOf(d.action) >= 0) {
    if (d.action === "offrir") {
      const dmn = d.domaine === "cuisine" ? "cuisine" : "alchimie";
      if (!gere(role)) return json({ erreur: "Seuls Elvara, Amaury et Edmond peuvent créer une offre d'achat." });
      const catalogue = lireTout(), lignes = Array.isArray(d.lignes) ? d.lignes.slice(0, 40) : [], propres = [];
      for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i], type = ["potion", "nourriture", "ingredient"].indexOf(l.type) >= 0 ? l.type : null, art = String(l.article || "").slice(0, 80);
        if (!type || !art) return json({ erreur: "Ligne " + (i + 1) + " incomplète." });
        const col = type === "ingredient" ? "ingredients" : "potions";
        if (domaines(col, art).indexOf(dmn) < 0) return json({ erreur: "Ligne " + (i + 1) + " : cet article n'appartient pas à la partie " + dmn + "." });
        // Prix de rachat : proposé par le site (prix de rachat du catalogue) et modifiable
        // par le responsable qui crée l'offre
        const rachat = (catalogue[col][art] || {}).prixAchat;
        const prix = l.prix != null && l.prix !== "" && !isNaN(Number(l.prix)) ? Number(l.prix) : Number(rachat) || 0;
        propres.push({ type: type, article: art, qte: Math.max(1, Math.round(Number(l.qte) || 1)), prix: Math.max(0, Math.round(prix * 100) / 100) });
      }
      if (!propres.length) return json({ erreur: "Ajoutez au moins un article à l'offre." });
      const o = { domaine: dmn, lignes: propres, fournisseur: String(d.tiers || "").slice(0, 80), note: String(d.note || "").slice(0, 500),
        reserve: d.reserve === "edmond" ? "edmond" : "eau-noire", statut: "ouverte", creePar: d.nom, cree: new Date().toISOString() };
      return avecVerrou(() => ecrire("offres", { ["offre-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)]: o }, d.nom, role), role, d.nom);
    }
    const oid = String(d.offre || "");
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      const tout = lireTout(), o = tout.offres[oid];
      if (!o) return json({ erreur: "Cette offre n'existe plus." });
      if (d.action === "prendre") {
        if (o.statut !== "ouverte") return json({ erreur: "Cette offre a déjà été prise par " + (o.preneur || "quelqu'un") + "." });
        ecrire("offres", { [oid]: { statut: "en-cours", preneur: d.nom, prisLe: new Date().toISOString() } }, d.nom, role);
      } else if (d.action === "lacher") {
        if (o.statut !== "en-cours") return json({ erreur: "Cette offre n'est pas en cours." });
        if (o.preneur !== d.nom && !gere(role)) return json({ erreur: "Seul " + o.preneur + " ou le responsable peut libérer cette offre." });
        ecrire("offres", { [oid]: { statut: "ouverte", preneur: null, prisLe: null } }, d.nom, role);
      } else {
        if (!gere(role)) return json({ erreur: "Seuls Elvara, Amaury et Edmond peuvent valider une offre." });
        if (o.statut !== "en-cours") return json({ erreur: "L'offre doit d'abord être acceptée (statut « en cours »)." });
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || "")) ? d.date : Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd");
        const maintenant = new Date().toISOString(), recs = {}, ch = { potions: {}, ingredients: {} };
        (o.lignes || []).forEach((l, i) => {
          const r = { date: date, type: l.type, article: l.article, qte: l.qte, prix: l.prix, domaine: o.domaine, cree: maintenant,
            fournisseur: o.fournisseur || "", acheteur: o.preneur || "", offre: oid };
          if (l.type === "nourriture") r.reserve = o.reserve === "edmond" ? "edmond" : "eau-noire";
          recs[oid + "-" + i] = r;
          const col = l.type === "ingredient" ? "ingredients" : "potions";
          const c = l.type === "ingredient" ? (o.domaine === "cuisine" && COMMUN_INGREDIENTS.indexOf(l.article) >= 0 ? "stockCuisine" : "stock")
            : l.type === "nourriture" && o.reserve === "edmond" ? "stockEdmond" : "stock";
          const cur = ch[col][l.article] || (ch[col][l.article] = {});
          const avant = cur[c] != null ? cur[c] : (Number((tout[col][l.article] || {})[c]) || 0);
          cur[c] = avant + l.qte;
        });
        ecrire("achats", recs, d.nom, role);
        if (Object.keys(ch.potions).length) ecrire("potions", ch.potions, d.nom, role);
        if (Object.keys(ch.ingredients).length) ecrire("ingredients", ch.ingredients, d.nom, role);
        ecrire("offres", { [oid]: { statut: "validee", validePar: d.nom, valideLe: maintenant, date: date } }, d.nom, role);
      }
    } finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }

  // Champ de stock d'une ligne (vente, achat, mouvement) selon sa partie
  function champStockLigne(r) {
    if (r.type === "ingredient") return r.domaine === "cuisine" && COMMUN_INGREDIENTS.indexOf(String(r.article)) >= 0 ? "stockCuisine" : "stock";
    return r.type === "nourriture" && r.reserve === "edmond" ? "stockEdmond" : "stock";
  }
  const CHAMPS_STOCK = ["stock", "stockEdmond", "stockCuisine"];
  const typeArticle = (col, art) => col === "ingredients" ? "ingredient" : domaines("potions", art)[0] === "cuisine" ? "nourriture" : "potion";

  // Corrections manuelles et inventaire : nouvelles quantités + motif obligatoire,
  // chaque écart est inscrit au journal des stocks (collection « mouvements »)
  if (d.action === "corriger") {
    if (!gere(role)) return json({ erreur: "Seuls Elvara, Amaury et Edmond corrigent les stocks." });
    const motif = String(d.motif || "").trim().slice(0, 200), genre = d.genre === "inventaire" ? "inventaire" : "correction";
    if (!motif) return json({ erreur: "Le motif de la correction est obligatoire." });
    const lignes = Array.isArray(d.lignes) ? d.lignes.slice(0, 400) : [];
    if (!lignes.length) return json({ erreur: "Aucune correction à enregistrer." });
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      const tout = lireTout(), ch = { potions: {}, ingredients: {} }, recs = {}, maintenant = new Date().toISOString();
      const base = "corr-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      const date = Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd");
      lignes.forEach((l, i) => {
        const col = l.col === "ingredients" ? "ingredients" : l.col === "potions" ? "potions" : null, champ = String(l.champ || ""), art = String(l.article || "");
        if (!col || CHAMPS_STOCK.indexOf(champ) < 0 || !art) return;
        const avant = Number((tout[col][art] || {})[champ]) || 0, apres = Math.max(0, Math.round(Number(l.valeur) || 0));
        if (avant === apres) return;
        (ch[col][art] || (ch[col][art] = {}))[champ] = apres;
        const type = typeArticle(col, art);
        const r = { sens: genre, type: type, article: art, champ: champ, avant: avant, apres: apres, ecart: apres - avant, qte: Math.abs(apres - avant),
          domaine: champ === "stockCuisine" || type === "nourriture" ? "cuisine" : "alchimie", motif: motif, par: d.nom, date: date, cree: maintenant };
        if (type === "nourriture") r.reserve = champ === "stockEdmond" ? "edmond" : "eau-noire";
        recs[base + "-" + i] = r;
      });
      if (!Object.keys(recs).length) return json({ erreur: "Aucun écart : rien à corriger." });
      ecrire("mouvements", recs, d.nom, role);
      if (Object.keys(ch.potions).length) ecrire("potions", ch.potions, d.nom, role);
      if (Object.keys(ch.ingredients).length) ecrire("ingredients", ch.ingredients, d.nom, role);
    } finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }

  // Suppression d'une vente, d'un achat, d'un ajout ou d'un retrait, avec
  // (au choix) remise du stock ; l'annulation est inscrite au journal
  if (d.action === "supprimerLigne") {
    if (!gere(role)) return json({ erreur: "Seuls Elvara, Amaury et Edmond suppriment des lignes." });
    const col = ["ventes", "achats", "mouvements"].indexOf(d.collection) >= 0 ? d.collection : null, id = String(d.id || "");
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      const tout = lireTout(), r = col && tout[col][id];
      if (!r) return json({ erreur: "Cette ligne n'existe plus." });
      const sens = col === "ventes" ? 1 : col === "achats" ? -1 : r.sens === "ajout" ? -1 : r.sens === "retrait" ? 1 : 0;
      ecrire(col, { [id]: null }, d.nom, role);
      if (d.remettre && sens && (col !== "ventes" || r.stock !== false)) {
        const pc = r.type === "ingredient" ? "ingredients" : "potions", c = champStockLigne(r), q = Number(r.qte) || 0;
        const avant = Number((tout[pc][r.article] || {})[c]) || 0, apres = Math.max(0, avant + sens * q);
        ecrire(pc, { [r.article]: { [c]: apres } }, d.nom, role);
        const quoi = col === "ventes" ? "d'une vente" : col === "achats" ? "d'un achat" : r.sens === "ajout" ? "d'un ajout" : "d'un retrait";
        ecrire("mouvements", { ["annul-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)]: { sens: "annulation", type: r.type, article: r.article,
          champ: c, avant: avant, apres: apres, ecart: apres - avant, qte: Math.abs(apres - avant), domaine: r.domaine || (r.type === "nourriture" ? "cuisine" : "alchimie"),
          reserve: r.reserve, motif: "Suppression " + quoi + " du " + (r.date || "") + (r.vendeur || r.acheteur || r.par ? " (" + (r.vendeur || r.acheteur || r.par) + ")" : ""),
          par: d.nom, date: Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd"), cree: new Date().toISOString() } }, d.nom, role);
      }
    } finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }

  // Fabrication d'une potion : les ingrédients de la recette sortent du stock
  // d'alchimie et la potion y entre, en un seul mouvement (tout le monde)
  if (d.action === "fabriquer") {
    const pot = String(d.potion || ""), qte = Math.max(1, Math.round(Number(d.qte) || 1));
    if (!pot || domaines("potions", pot)[0] !== "alchimie") return json({ erreur: "Potion inconnue." });
    const ingr = (Array.isArray(d.ingredients) ? d.ingredients.slice(0, 40) : []).map(l => ({ article: String(l.article || ""), col: l.type === "potion" ? "potions" : "ingredients", qte: Math.max(0, Math.round(Number(l.qte) || 0)) })).filter(l => l.article && l.qte);
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      const tout = lireTout(), ch = { potions: {}, ingredients: {} };
      const val = (col, art) => ch[col][art] && ch[col][art].stock != null ? ch[col][art].stock : (Number((tout[col][art] || {}).stock) || 0);
      ingr.forEach(l => { (ch[l.col][l.article] || (ch[l.col][l.article] = {})).stock = Math.max(0, val(l.col, l.article) - l.qte); });
      (ch.potions[pot] || (ch.potions[pot] = {})).stock = val("potions", pot) + qte;
      ecrire("mouvements", { ["fab-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)]: { sens: "fabrication", type: "potion", article: pot, qte: qte,
        ingredients: ingr.map(l => ({ article: l.article, type: l.col === "potions" ? "potion" : "ingredient", qte: l.qte })), domaine: "alchimie",
        motif: String(d.motif || "").slice(0, 200), par: d.nom, date: Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd"), cree: new Date().toISOString() } }, d.nom, role);
      if (Object.keys(ch.potions).length) ecrire("potions", ch.potions, d.nom, role);
      if (Object.keys(ch.ingredients).length) ecrire("ingredients", ch.ingredients, d.nom, role);
    } finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }

  // Vente d'un pack promo : le prix du pack est réparti entre ses produits
  // (au prorata de leur prix de vente) ; chaque produit est inscrit dans la
  // trésorerie de sa partie (Fiole ou Marmite), avec le nom du pack.
  if (d.action === "vendrePack") {
    const tout = lireTout(), k = tout.packs[String(d.pack || "")];
    if (!k) return json({ erreur: "Ce pack n'existe plus." });
    if (!d.stock) { if (!gere(role)) d.stock = true; else if (!String(d.motifStock || "").trim()) return json({ erreur: "Indiquez pourquoi le stock n'est pas retiré." }); }
    const n = Math.max(1, Math.round(Number(d.qte) || 1)), date = String(d.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ erreur: "Vente incomplète." });
    const lignes = (k.lignes || []).filter(l => INTERDITS.indexOf(String(l.article)) < 0 && Number(l.qte) > 0);
    if (!lignes.length) return json({ erreur: "Ce pack est vide." });
    const poidsClient = d.poids || {};
    const poids = lignes.map(l => { const st = (tout.potions[l.article] || {}).prix;
      const pu = st != null && st !== "" ? Number(st) : Number(poidsClient[l.article]) || 1; return Math.max(0, pu) * Number(l.qte); });
    const somme = poids.reduce((t, x) => t + x, 0) || lignes.length;
    const totalC = Math.round((Number(k.prix) || 0) * n * 100);
    let reste = totalC;
    const nom = String(d.nom || "").slice(0, 60), tiers = String(d.tiers || "").slice(0, 80), maintenant = new Date().toISOString();
    const base = "vente-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), recs = {}, ch = { potions: {} };
    lignes.forEach((l, i) => {
      const part = i === lignes.length - 1 ? reste : Math.floor(totalC * (poids[i] || (somme === lignes.length ? 1 : 0)) / somme);
      reste -= part;
      const qte = Number(l.qte) * n, dom = domaines("potions", String(l.article))[0], plat = dom === "cuisine";
      const r = { date: date, type: plat ? "nourriture" : "potion", article: String(l.article), qte: qte, prix: part / 100 / qte, domaine: dom, cree: maintenant,
        client: tiers, vendeur: nom, pack: String(d.pack), packNom: k.nom || "Pack", packQte: n, packGroupe: base, stock: !!d.stock };
      if (!d.stock) r.motifStock = String(d.motifStock || "").slice(0, 200);
      if (plat) r.reserve = d.reserve === "edmond" ? "edmond" : "eau-noire";
      recs[base + "-" + i] = r;
      if (d.stock) {
        const c = plat && d.reserve === "edmond" ? "stockEdmond" : "stock", cur = ch.potions[l.article] || (ch.potions[l.article] = {});
        const avant = cur[c] != null ? cur[c] : (Number((tout.potions[l.article] || {})[c]) || 0);
        cur[c] = Math.max(0, avant - qte);
      }
    });
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      ecrire("ventes", recs, nom, role);
      if (Object.keys(ch.potions).length) ecrire("potions", ch.potions, nom, role);
    } finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }

  // Notes d'alchimistes (boîte à idées) : tout le monde peut écrire une note ;
  // Elvara, Amaury et Edmond les lisent toutes, les marquent lues ou les suppriment.
  if (d.action === "noter") {
    const texte = String(d.texte || "").trim().slice(0, 2000), titre = String(d.titre || "").trim().slice(0, 120);
    if (!texte) return json({ erreur: "La note est vide." });
    const categorie = ["idee", "recette", "probleme", "autre"].indexOf(d.categorie) >= 0 ? d.categorie : "idee";
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      ecrire("notes", { ["note-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)]:
        { titre: titre, texte: texte, categorie: categorie, auteur: d.nom, cree: new Date().toISOString(), statut: "nouvelle" } }, d.nom, role);
    } finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }

  if (d.action === "ecrire") {
    const col = d.collection, ch = d.changements || {};
    if (COLLECTIONS.indexOf(col) < 0) return json({ erreur: "Collection inconnue." });
    const r = col === "eaunoire" ? refusEauNoire(role, d.nom, ch)
      : col === "carte" ? (editeurCarte(d.nom) ? "" : "Seul " + EDITEURS_CARTE.join(", ") + " peut modifier la carte des récoltes.")
      : refus(role, col, ch);
    if (r) return json({ erreur: r });
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try { ecrire(col, ch, String(d.nom || "").slice(0, 60), role); }
    finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }
  return json({ erreur: "Action inconnue." });
}

function avecVerrou(f, role, nom) {
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
  try { f(); } finally { verrou.releaseLock(); }
  return json(reponse(role, nom));
}

function reponse(role, nom) {
  const d = lireTout();
  // Notes d'alchimistes : les employés ne voient que les leurs
  if (role === "employe") Object.keys(d.notes).forEach(id => { if (d.notes[id].auteur !== nom) delete d.notes[id]; });
  // Stock de l'Eau Noire : seulement pour Elvara et Edmond
  if (!accesEauNoire(nom)) d.eaunoire = {};
  // Carte des récoltes : seulement pour les comptes de COMPTES_CARTE
  if (!accesCarte(nom)) { d.recoltes = {}; d.carte = {}; }
  return { role: role, nom: nom || "", donnees: d, maj: prop("maj"), par: prop("par") };
}

// Identifiants qui ressemblent à des nombres (« 00039e52 » = 3,9 × 10^53 pour Google Sheets,
// « 00039968 » = 39968) : Sheets les convertissait en nombres et la ligne n'était plus retrouvée.
// On les écrit désormais en texte, et on reconnaît les anciennes lignes converties.
const IDS_NUMERIQUES = ["00039e52", "00039e53", "00039968", "00039969"];
function idTexte(id) {
  if (typeof id === "number") { const t = IDS_NUMERIQUES.filter(x => Number(x) === id)[0]; return t || String(id); }
  return String(id);
}
const celluleId = id => "'" + id;   // l'apostrophe force Google Sheets à garder le texte tel quel

function lireTout() {
  const out = {};
  COLLECTIONS.forEach(c => out[c] = {});
  const v = feuille("Données").getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    const col = v[i][0], id = v[i][1] === "" || v[i][1] == null ? "" : idTexte(v[i][1]);
    if (!out[col] || !id) continue;
    // plusieurs lignes pour le même article (ancien bug des identifiants numériques) : fusionnées dans l'ordre
    try { out[col][id] = Object.assign(out[col][id] || {}, JSON.parse(v[i][2])); } catch (e) {}
  }
  return out;
}

function ecrire(col, changements, nom, role) {
  const f = feuille("Données"), h = feuille("Historique");
  const v = f.getDataRange().getValues();
  const ligne = {}, doublons = {};
  for (let i = 1; i < v.length; i++) {
    const k = v[i][0] + "|" + idTexte(v[i][1]);
    if (ligne[k]) (doublons[k] = doublons[k] || [ligne[k]]).push(i + 1); else ligne[k] = i + 1;
  }
  const maintenant = new Date();
  const aSupprimer = [];
  Object.keys(changements).forEach(id => {
    const c = changements[id], k = col + "|" + id;
    if (c === null) {
      if (ligne[k]) aSupprimer.push(ligne[k]);
      if (doublons[k]) { doublons[k].slice(1).forEach(n => aSupprimer.push(n)); delete doublons[k]; }
    } else {
      let actuel = {};
      if (ligne[k]) { try { actuel = JSON.parse(f.getRange(ligne[k], 3).getValue()); } catch (e) {} }
      // Réparation : lignes en double regroupées sur la première, identifiant réécrit en texte
      if (doublons[k]) {
        doublons[k].slice(1).forEach(n => { try { Object.assign(actuel, JSON.parse(v[n - 1][2])); } catch (e) {} aSupprimer.push(n); });
        delete doublons[k];
      }
      if (ligne[k] && typeof v[ligne[k] - 1][1] === "number") f.getRange(ligne[k], 2).setValue(celluleId(id));
      Object.keys(c).forEach(champ => { if (c[champ] === null) delete actuel[champ]; else actuel[champ] = c[champ]; });
      const valeur = [JSON.stringify(actuel), maintenant, nom];
      if (ligne[k]) f.getRange(ligne[k], 3, 1, 3).setValues([valeur]);
      else { f.appendRow([col, celluleId(id)].concat(valeur)); ligne[k] = f.getLastRow(); }
    }
    h.appendRow([maintenant, nom, role === "gerante" ? "gérante" : role === "cuisinier" ? "cuisinier" : "employé", col, celluleId(id), c === null ? "supprimé" : JSON.stringify(c).slice(0, 300)]);
  });
  aSupprimer.filter((n, i, t) => t.indexOf(n) === i).sort((a, b) => b - a).forEach(n => f.deleteRow(n));
  const props = PropertiesService.getScriptProperties();
  props.setProperty("maj", maintenant.toISOString());
  props.setProperty("par", nom);
}

/* ---------- REMISE À ZÉRO (à lancer depuis l'éditeur, bouton « Exécuter ») ----------
   Efface toutes les ventes, tous les achats, offres d'achat, ajouts et retraits, et remet
   à 0 tous les stocks et seuils (y compris le stock d'Edmond).
   Sont CONSERVÉS : les prix fixés, la vitrine, la carte, les accords, les
   notes d'alchimistes et l'onglet « Historique » (une ligne y est ajoutée).
   Irréversible : faites une copie de la feuille avant si besoin
   (Fichier > Créer une copie). */
function remiseAZero() {
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const f = feuille("Données"), v = f.getDataRange().getValues();
    const effacer = ["ventes", "achats", "offres", "mouvements"], chiffres = ["stock", "seuil", "stockEdmond", "seuilEdmond", "stockCuisine", "seuilCuisine"];
    const garder = [v[0]];
    let nVentes = 0, nStocks = 0;
    for (let i = 1; i < v.length; i++) {
      const col = v[i][0];
      if (effacer.indexOf(col) >= 0) { nVentes++; continue; }
      if (col === "potions" || col === "ingredients") {
        let o = {}; try { o = JSON.parse(v[i][2]); } catch (e) {}
        let touche = false;
        chiffres.forEach(k => { if (k in o) { delete o[k]; touche = true; } });
        if (touche) nStocks++;
        if (!Object.keys(o).length) continue;   // ligne devenue vide : supprimée
        v[i][2] = JSON.stringify(o);
      }
      garder.push(v[i]);
    }
    f.clearContents();
    f.getRange(1, 1, garder.length, garder[0].length).setValues(garder);
    const maintenant = new Date();
    feuille("Historique").appendRow([maintenant, "Remise à zéro", "", "tout", "",
      nVentes + " ventes/achats/mouvements effacés, " + nStocks + " stocks et seuils remis à 0"]);
    const props = PropertiesService.getScriptProperties();
    props.setProperty("maj", maintenant.toISOString()); props.setProperty("par", "Remise à zéro");
    Logger.log("Remise à zéro faite : " + nVentes + " lignes de trésorerie effacées, " + nStocks + " articles remis à 0.");
  } finally { verrou.releaseLock(); }
}

/* ---------- CORRECTION (à lancer une fois depuis l'éditeur, bouton « Exécuter ») ----------
   Les anciennes ventes de la cuisine enregistrées au nom d'Elvara passent
   au nom d'Edmond. Une ligne est ajoutée dans l'onglet « Historique ». */
function corrigerVendeursCuisine() {
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const ventes = lireTout().ventes, ch = {};
    Object.keys(ventes).forEach(id => {
      const v = ventes[id];
      const dom = v.domaine || domaines(v.type === "ingredient" ? "ingredients" : "potions", String(v.article || ""))[0];
      if (dom === "cuisine" && normId(v.vendeur) === "elvara") ch[id] = { vendeur: "Edmond", domaine: "cuisine" };
    });
    const n = Object.keys(ch).length;
    if (n) ecrire("ventes", ch, "Correction", "gerante");
    Logger.log(n + " vente(s) de la cuisine passée(s) du nom d'Elvara à celui d'Edmond.");
  } finally { verrou.releaseLock(); }
}

/* ---------- À lancer une fois depuis l'éditeur (bouton « Exécuter ») ---------- */
function installer() {
  feuille("Données"); feuille("Historique");
  Logger.log("Feuille de données : " + classeur().getUrl());
}

function classeur() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("feuille");
  if (id) return SpreadsheetApp.openById(id);
  const nouveau = SpreadsheetApp.create("La Fiole et la Marmite — données");
  props.setProperty("feuille", nouveau.getId());
  return nouveau;
}

function feuille(nom) {
  const c = classeur();
  let f = c.getSheetByName(nom);
  if (!f) {
    f = c.insertSheet(nom);
    f.appendRow(nom === "Données"
      ? ["collection", "id", "contenu", "modifié le", "par"]
      : ["date", "personne", "rôle", "collection", "élément", "détail"]);
    f.setFrozenRows(1);
  }
  return f;
}

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ""; }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
