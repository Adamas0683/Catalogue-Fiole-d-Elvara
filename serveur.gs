/* =====================================================================
   LA FIOLE D'ELVARA — SERVEUR (Google Apps Script)
   ---------------------------------------------------------------------
   Ce code ne va PAS sur GitHub : il se colle dans un projet Apps Script
   (script.google.com). Voir LISEZMOI.txt, « Mise en place ».

   Il crée tout seul une feuille Google « La Fiole d'Elvara — données »
   dans le Drive de la gérante, avec deux onglets :
     Données    : collection | id | contenu | modifié le | par
     Historique : date | personne | rôle | collection | élément | détail

   Deux mots de passe :
     - gérante  : voit et modifie tout (stocks, prix, vitrine, carte,
                  accords, ventes)
     - employés : consultation uniquement, sans la carte
   ===================================================================== */

const MDP_GERANTE = "change-moi-gerante";
const MDP_EMPLOYE = "change-moi-employe";

const COLLECTIONS = ["ingredients", "potions", "carte", "accords", "ventes", "reglages"];
// Collections que les employés ne voient pas
const CACHE_EMPLOYE = ["carte"];

/* ---------- Lecture publique (vitrine) : prix et disponibilité ---------- */
function doGet() {
  const d = lireTout();
  const potions = {};
  Object.keys(d.potions).forEach(id => {
    const v = d.potions[id];
    potions[id] = { prix: v.prix, vitrine: v.vitrine, dispo: v.stock == null ? null : v.stock > 0 };
  });
  const r = d.reglages.vitrine || {};
  return json({ potions: potions, vedettes: r.vedettes || null, maj: prop("maj") });
}

/* ---------- Espace privé ---------- */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json({ erreur: "Requête invalide." }); }
  const mdp = String(d.mdp || "").trim();
  const role = mdp === MDP_GERANTE.trim() ? "gerante" : mdp === MDP_EMPLOYE.trim() ? "employe" : null;
  if (!role) return json({ erreur: "Mot de passe incorrect." });

  if (d.action === "lire") return json(reponse(role));

  if (d.action === "ecrire") {
    const col = d.collection, ch = d.changements || {};
    if (COLLECTIONS.indexOf(col) < 0) return json({ erreur: "Collection inconnue." });
    if (role !== "gerante") return json({ erreur: "Accès en lecture seule : seule la gérante peut modifier." });
    const verrou = LockService.getScriptLock();
    verrou.waitLock(15000);
    try { ecrire(col, ch, String(d.nom || "").slice(0, 60), role); }
    finally { verrou.releaseLock(); }
    return json(reponse(role));
  }
  return json({ erreur: "Action inconnue." });
}

function reponse(role) {
  const d = lireTout();
  if (role !== "gerante") CACHE_EMPLOYE.forEach(c => delete d[c]);
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
    h.appendRow([maintenant, nom, role === "gerante" ? "gérante" : "employé", col, id, c === null ? "supprimé" : JSON.stringify(c).slice(0, 300)]);
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
  const nouveau = SpreadsheetApp.create("La Fiole d'Elvara — données");
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
