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
     - Elvara (gérante)   : l'alchimie (potions, ingrédients d'alchimie :
                            stocks, prix, vitrine), plus la carte, les
                            accords et les ventes
     - Edmond (cuisinier) : la cuisine (nourriture, denrées de cuisine :
                            stocks, prix, vitrine), plus la carte, les
                            accords et les ventes
     - Belrand, Askaal, Aldéric (employés) : voient tout ; enregistrent
                            des ventes, achats, ajouts et retraits
   Le nom enregistré dans les ventes est celui du compte (impossible de
   signer au nom d'un autre). Après 8 essais ratés sur un identifiant,
   celui-ci est bloqué 15 minutes.
   ===================================================================== */

// Mots de passe : à remplacer ICI, dans l'éditeur Apps Script uniquement
// (jamais dans le fichier publié sur GitHub). Un mot de passe qui commence
// encore par « change-moi » est refusé.
const MDP_GERANTE = "change-moi-gerante";      // Elvara (alchimie)
const MDP_CUISINIER = "change-moi-cuisinier";  // Edmond (cuisine)
const MDP_BELRAND = "change-moi-belrand";      // employé
const MDP_ASKAAL = "change-moi-askaal";        // employé
const MDP_ALDERIC = "change-moi-alderic";      // employé

const COMPTES = {
  "Elvara":  { mdp: MDP_GERANTE, role: "gerante" },
  "Edmond":  { mdp: MDP_CUISINIER, role: "cuisinier" },
  "Belrand": { mdp: MDP_BELRAND, role: "employe" },
  "Askaal":  { mdp: MDP_ASKAAL, role: "employe" },
  "Aldéric": { mdp: MDP_ALDERIC, role: "employe" },
};
// MODE MAINTENANCE : mettre true pour fermer la boutique à TOUT le monde
// (vitrine et espace privé), puis publier une nouvelle version.
// Remettre false (et publier une nouvelle version) pour rouvrir.
const MAINTENANCE = false;
const MESSAGE_MAINTENANCE = "La boutique est fermée pour maintenance. Revenez un peu plus tard.";

const ESSAIS_MAX = 8, BLOCAGE_SECONDES = 900;
const normId = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const COLLECTIONS = ["ingredients", "potions", "carte", "accords", "ventes", "achats", "mouvements", "reglages"];
// Partie « cuisine » (gérée par Edmond). Tout le reste est l'alchimie
// (gérée par Elvara). Les ingrédients « communs » appartiennent aux deux.
// Listes tirées de data.js : en cas d'ajout d'un plat ou d'une denrée
// dans data.js, l'ajouter ici aussi.
const CUISINE_POTIONS = [
  "chausson-pommes", "tarte-pommes", "tarte-jazbay", "tarte-genievres", "tarte-givreboises",
  "chausson-poulet", "chausson-lavande", "petit-pain", "bouchee-creme", "pain", "pain-tresse",
  "pain-pommes-de-terre", "pain-ail", "pommes-de-terre-four", "fondue-elsweyr", "ragout-boeuf",
  "ragout-venaison", "ragout-horqueur", "ragout-horqueur-cendres", "ragout-chou",
  "soupe-chou-pommes-de-terre", "soupe-chou", "soupe-palourdes", "soupe-pommes-de-terre",
  "soupe-tomates", "soupe-legumes", "steak-mammouth", "sanglier-grille", "boeuf-cuit",
  "boeuf-epice", "cotelette-venaison", "cuissot-cheval", "gigot-chevre-grille", "tourte-horqueur",
  "poulet-grille", "roti-faisan", "cuisse-lapin", "filet-saumon", "poisson-carnassier-grille",
  "pattes-vasard-vapeur", "poireaux-grilles", "meule-eidar", "tranches-eidar", "morceau-eidar",
  "meule-chevre", "tranches-chevre", "morceau-chevre", "bol-fromage-mammouth", "bonbon-caramel",
  "friandise-miel", "flasque-eau-de-vie", "rat-cuit", "vide-d-ame"
];
const CUISINE_INGREDIENTS = [
  "miel", "sac-de-farine", "beurre", "pot-de-lait", "pomme-de-terre", "poireau", "chou", "carotte",
  "tomate", "pomme-rouge", "pomme-verte", "boeuf-cru", "venaison", "blanc-de-poulet",
  "viande-de-horqueur", "viande-de-cheval", "gigot-de-chevre", "poitrine-de-faisan",
  "patte-de-lapin-crue", "chair-de-saumon", "chair-de-palourde", "pattes-de-vasard",
  "pomme-de-cendres", "viande-de-sanglier", "cerise", "orange", "peche", "poire", "gourde",
  "viande-de-chien", "viande-de-rat"
];
const COMMUN_INGREDIENTS = [
  "ail", "genievres", "givreboises", "lavande", "raisin-jazbay", "sucrelune", "tas-de-sel"
];
// Parties auxquelles appartient un article
function domaines(col, id) {
  if (col === "ingredients" && COMMUN_INGREDIENTS.indexOf(id) >= 0) return ["alchimie", "cuisine"];
  return [(col === "potions" ? CUISINE_POTIONS : CUISINE_INGREDIENTS).indexOf(id) >= 0 ? "cuisine" : "alchimie"];
}
const domaineRole = role => role === "gerante" ? "alchimie" : role === "cuisinier" ? "cuisine" : null;
// Vérifie qu'un changement est permis au rôle (renvoie un message d'erreur, ou "")
function refus(role, col, ch) {
  if (role === "employe") return "Les employés peuvent seulement enregistrer des ventes et des achats.";
  const dom = domaineRole(role), cuisine = role === "cuisinier";
  if (col === "potions" || col === "ingredients") {
    const ok = Object.keys(ch).every(id => domaines(col, id).indexOf(dom) >= 0);
    return ok ? "" : cuisine ? "Edmond ne peut modifier que la partie cuisine." : "Elvara ne peut modifier que la partie alchimie.";
  }
  if (col === "reglages") {
    const cle = cuisine ? "plats" : "potions";
    const ok = Object.keys(ch).every(id => id === "vitrine" && ch[id] && Object.keys(ch[id]).every(k => k === cle));
    return ok ? "" : "Réglage non autorisé.";
  }
  return ""; // carte, accords, suppression de ventes et d'achats : gérante et cuisinier
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
    const q = v.stock == null && v.stockEdmond == null ? null : (Number(v.stock) || 0) + (Number(v.stockEdmond) || 0);
    potions[id] = { prix: v.prix, vitrine: v.vitrine, dispo: q == null ? null : q > 0 };
  });
  const r = d.reglages.vitrine || {};
  return { potions: potions, vedettes: { potions: r.potions || null, plats: r.plats || null, vedettes: r.vedettes || null }, maj: prop("maj") };
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
  //   achat : alchimie = Elvara et employés ; cuisine = Edmond et employés
  // Si demandé, les quantités sont retirées (vente) ou ajoutées (achat) au stock.
  // Ajouts et retraits de stock (récolte, fabrication, perte…) : même règles que les achats.
  if (d.action === "vendre" || d.action === "acheter" || d.action === "ajouter" || d.action === "retirer") {
    const mvt = d.action === "ajouter" || d.action === "retirer", plus = d.action === "acheter" || d.action === "ajouter";
    const achat = d.action === "acheter" || mvt;   // mêmes droits que l'achat
    // Ancien format (une seule vente) accepté
    if (!d.lignes && d.vente) d = { action: d.action, mdp: d.mdp, nom: d.nom, date: d.vente.date, tiers: d.vente.client, lignes: [d.vente], stock: d.destock, reserve: d.reserve };
    const dom = d.domaine === "cuisine" ? "cuisine" : d.domaine === "alchimie" ? "alchimie" : null;
    const lignes = Array.isArray(d.lignes) ? d.lignes.slice(0, 40) : [];
    const mien = domaineRole(role);
    const date = String(d.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !lignes.length) return json({ erreur: (achat ? "Achat" : "Vente") + " incomplet" + (achat ? "." : "e.") });
    const dmn = dom || (function () { const l = lignes[0]; return domaines(l.type === "ingredient" ? "ingredients" : "potions", String(l.article))[0]; })();
    if (mvt) d.stock = true;
    if (mien && mien !== dmn) return json({ erreur: (mvt ? "Opération" : achat ? "Achat" : "Vente") + " non autorisé" + (achat ? "" : "e") + " pour cette partie." });
    const propres = [], catalogue = lireTout();
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i], type = ["potion", "nourriture", "ingredient"].indexOf(l.type) >= 0 ? l.type : null, art = String(l.article || "").slice(0, 80);
      if (!type || !art) return json({ erreur: "Ligne " + (i + 1) + " incomplète." });
      const col = type === "ingredient" ? "ingredients" : "potions";
      if (domaines(col, art).indexOf(dmn) < 0) return json({ erreur: "Ligne " + (i + 1) + " : cet article n'appartient pas à la partie " + dmn + "." });
      // Le prix ne se modifie pas à la vente / à l'achat : prix du catalogue s'il a été fixé
      const fixe = (catalogue[col][art] || {}).prix;
      const prix = fixe != null && fixe !== "" ? Number(fixe) : Number(l.prix) || 0;
      propres.push({ type: type, article: art, col: col, qte: Math.max(1, Math.round(Number(l.qte) || 1)), prix: Math.max(0, Math.round(prix * 100) / 100) });
    }
    const nom = String(d.nom || "").slice(0, 60), tiers = String(d.tiers || "").slice(0, 80), maintenant = new Date().toISOString();
    const champStock = l => l.type === "nourriture" && d.reserve === "edmond" ? "stockEdmond" : "stock";
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      const recs = {}, base = (mvt ? "mvt-" : achat ? "achat-" : "vente-") + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      propres.forEach((l, i) => {
        const r = { date: date, type: l.type, article: l.article, qte: l.qte, prix: l.prix, domaine: dmn, cree: maintenant };
        if (mvt) { r.sens = plus ? "ajout" : "retrait"; r.motif = tiers; r.par = nom; delete r.prix; }
        else if (achat) { r.fournisseur = tiers; r.acheteur = nom; } else { r.client = tiers; r.vendeur = nom; }
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

  if (d.action === "ecrire") {
    const col = d.collection, ch = d.changements || {};
    if (COLLECTIONS.indexOf(col) < 0) return json({ erreur: "Collection inconnue." });
    const r = refus(role, col, ch);
    if (r) return json({ erreur: r });
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try { ecrire(col, ch, String(d.nom || "").slice(0, 60), role); }
    finally { verrou.releaseLock(); }
    return json(reponse(role, d.nom));
  }
  return json({ erreur: "Action inconnue." });
}

function reponse(role, nom) {
  const d = lireTout();
  return { role: role, nom: nom || "", donnees: d, maj: prop("maj"), par: prop("par") };
}

function lireTout() {
  const out = {};
  COLLECTIONS.forEach(c => out[c] = {});
  const v = feuille("Données").getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    const col = v[i][0], id = v[i][1];
    if (!out[col] || !id) continue;
    try { out[col][id] = JSON.parse(v[i][2]); } catch (e) {}
  }
  return out;
}

function ecrire(col, changements, nom, role) {
  const f = feuille("Données"), h = feuille("Historique");
  const v = f.getDataRange().getValues();
  const ligne = {};
  for (let i = 1; i < v.length; i++) ligne[v[i][0] + "|" + v[i][1]] = i + 1;
  const maintenant = new Date();
  const aSupprimer = [];
  Object.keys(changements).forEach(id => {
    const c = changements[id], k = col + "|" + id;
    if (c === null) {
      if (ligne[k]) aSupprimer.push(ligne[k]);
    } else {
      let actuel = {};
      if (ligne[k]) { try { actuel = JSON.parse(f.getRange(ligne[k], 3).getValue()); } catch (e) {} }
      Object.keys(c).forEach(champ => { if (c[champ] === null) delete actuel[champ]; else actuel[champ] = c[champ]; });
      const valeur = [JSON.stringify(actuel), maintenant, nom];
      if (ligne[k]) f.getRange(ligne[k], 3, 1, 3).setValues([valeur]);
      else { f.appendRow([col, id].concat(valeur)); ligne[k] = f.getLastRow(); }
    }
    h.appendRow([maintenant, nom, role === "gerante" ? "gérante" : role === "cuisinier" ? "cuisinier" : "employé", col, id, c === null ? "supprimé" : JSON.stringify(c).slice(0, 300)]);
  });
  aSupprimer.sort((a, b) => b - a).forEach(n => f.deleteRow(n));
  const props = PropertiesService.getScriptProperties();
  props.setProperty("maj", maintenant.toISOString());
  props.setProperty("par", nom);
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
