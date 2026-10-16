/* =====================================================================
   LA FIOLE ET LA MARMITTE — SERVEUR (Google Apps Script)
   ---------------------------------------------------------------------
   Ce code ne va PAS sur GitHub : il se colle dans un projet Apps Script
   (script.google.com). Voir LISEZMOI.txt, « Mise en place ».

   Il crée tout seul une feuille Google « La Fiole et la Marmitte — données »
   dans le Drive de la gérante, avec deux onglets :
     Données    : collection | id | contenu | modifié le | par
     Historique : date | personne | rôle | collection | élément | détail

   Deux mots de passe :
     - gérante  : voit et modifie tout (stocks, prix, vitrine, carte,
                  accords, ventes)
     - employés : consultation, sans la carte, et saisie de leurs ventes
     - cuisinier : stocks et seuils de la nourriture et des denrées de
                  cuisine ; pas d'accès aux ventes ni à la carte
   ===================================================================== */

const MDP_GERANTE = "change-moi-gerante";
const MDP_EMPLOYE = "change-moi-employe";
const MDP_CUISINIER = "change-moi-cuisinier";

const COLLECTIONS = ["ingredients", "potions", "carte", "accords", "ventes", "reglages"];
// Collections que les employés ne voient pas
const CACHE_EMPLOYE = ["carte"];
const CACHE_CUISINIER = ["carte", "ventes"];

// Ce que le cuisinier peut modifier (stock et seuil uniquement).
// Liste tirée de data.js : nourriture et denrées de cuisine.
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
  "friandise-miel"
];
const CUISINE_INGREDIENTS = [
  "miel", "sac-de-farine", "beurre", "pot-de-lait", "pomme-de-terre", "poireau", "chou", "carotte",
  "tomate", "pomme-rouge", "pomme-verte", "boeuf-cru", "venaison", "blanc-de-poulet",
  "viande-de-horqueur", "viande-de-cheval", "gigot-de-chevre", "poitrine-de-faisan",
  "patte-de-lapin-crue", "chair-de-saumon", "chair-de-palourde", "pattes-de-vasard",
  "pomme-de-cendres", "viande-de-sanglier"
];
function cuisinierPeut(col, ch) {
  const liste = col === "potions" ? CUISINE_POTIONS : col === "ingredients" ? CUISINE_INGREDIENTS : null;
  if (!liste) return false;
  return Object.keys(ch).every(id => liste.indexOf(id) >= 0 && ch[id] && typeof ch[id] === "object"
    && Object.keys(ch[id]).every(k => (k === "stock" || k === "seuil") && typeof ch[id][k] === "number"));
}

/* ---------- Lecture publique (vitrine) : prix et disponibilité ---------- */
function doGet() {
  try { return json(publique()); }
  catch (err) { return json({ erreur: "Erreur du serveur Google : " + (err && err.message ? err.message : err) }); }
}

function publique() {
  const d = lireTout();
  const potions = {};
  Object.keys(d.potions).forEach(id => {
    const v = d.potions[id];
    potions[id] = { prix: v.prix, vitrine: v.vitrine, dispo: v.stock == null ? null : v.stock > 0 };
  });
  const r = d.reglages.vitrine || {};
  return { potions: potions, vedettes: r.vedettes || null, maj: prop("maj") };
}

/* ---------- Espace privé ---------- */
// Toute erreur est renvoyée au site (au lieu d'une page d'erreur Google,
// que le navigateur bloque en affichant une fausse erreur « CORS »).
function doPost(e) {
  try { return traiter(e); }
  catch (err) { return json({ erreur: "Erreur du serveur Google : " + (err && err.message ? err.message : err) }); }
}

function traiter(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json({ erreur: "Requête invalide." }); }
  const mdp = String(d.mdp || "").trim();
  const role = mdp === MDP_GERANTE.trim() ? "gerante" : mdp === MDP_EMPLOYE.trim() ? "employe"
    : mdp === MDP_CUISINIER.trim() ? "cuisinier" : null;
  if (!role) return json({ erreur: "Mot de passe incorrect." });

  if (d.action === "lire") return json(reponse(role));

  // Saisie d'une vente (gérante et employés) : la vente est enregistrée et,
  // si demandé, la quantité est retirée du stock (calculée ici, côté serveur).
  if (d.action === "vendre") {
    if (role === "cuisinier") return json({ erreur: "Le cuisinier n'a pas accès aux ventes." });
    const v = d.vente || {};
    const type = ["potion", "nourriture", "ingredient"].indexOf(v.type) >= 0 ? v.type : null;
    const qte = Math.max(1, Math.round(Number(v.qte) || 1));
    const prix = Math.max(0, Math.round((Number(v.prix) || 0) * 100) / 100);
    if (!type || !v.article || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ""))) return json({ erreur: "Vente incomplète." });
    const nom = String(d.nom || "").slice(0, 60);
    const vente = { date: String(v.date), type: type, article: String(v.article).slice(0, 80), qte: qte, prix: prix,
      client: String(v.client || "").slice(0, 80), vendeur: nom, cree: new Date().toISOString() };
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try {
      ecrire("ventes", { ["vente-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)]: vente }, nom, role);
      if (d.destock) {
        const col = type === "ingredient" ? "ingredients" : "potions";
        const actuel = lireTout()[col][vente.article] || {};
        ecrire(col, { [vente.article]: { stock: Math.max(0, (Number(actuel.stock) || 0) - qte) } }, nom, role);
      }
    } finally { verrou.releaseLock(); }
    return json(reponse(role));
  }

  if (d.action === "ecrire") {
    const col = d.collection, ch = d.changements || {};
    if (COLLECTIONS.indexOf(col) < 0) return json({ erreur: "Collection inconnue." });
    if (role === "cuisinier" && !cuisinierPeut(col, ch)) return json({ erreur: "Le cuisinier ne peut modifier que les stocks de la nourriture et des denrées de cuisine." });
    if (role === "employe") return json({ erreur: "Accès en lecture seule : seule la gérante peut modifier." });
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(20000)) return json({ erreur: "Le serveur est occupé, réessayez dans quelques secondes." });
    try { ecrire(col, ch, String(d.nom || "").slice(0, 60), role); }
    finally { verrou.releaseLock(); }
    return json(reponse(role));
  }
  return json({ erreur: "Action inconnue." });
}

function reponse(role) {
  const d = lireTout();
  if (role === "employe") CACHE_EMPLOYE.forEach(c => delete d[c]);
  if (role === "cuisinier") CACHE_CUISINIER.forEach(c => delete d[c]);
  return { role: role, donnees: d, maj: prop("maj"), par: prop("par") };
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
  const nouveau = SpreadsheetApp.create("La Fiole et la Marmitte — données");
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
