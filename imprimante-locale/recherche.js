"use strict";

// Recherche automatique de l'imprimante sur le réseau local.
//
// Évite d'avoir à relever l'adresse IP sur l'écran de l'imprimante : on teste
// toutes les adresses du réseau en parallèle et on retient celles qui acceptent
// une connexion sur le port 9100, celui des imprimantes réseau.

const net = require('net');
const os = require('os');

const PORT_IMPRIMANTE = 9100;
const DELAI = 400;          // ms par adresse ; le réseau local répond vite
const SIMULTANEES = 64;

// Réseaux IPv4 privés auxquels cet ordinateur est raccordé.
function reseauxLocaux() {
  const trouves = [];
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(nom => {
    (interfaces[nom] || []).forEach(i => {
      if (i.family !== 'IPv4' || i.internal) return;
      const parties = i.address.split('.').map(Number);
      // On se limite au /24 : suffisant pour un réseau de restaurant, et rapide.
      trouves.push({ interface: nom, adresse: i.address, base: parties.slice(0, 3).join('.') });
    });
  });
  return trouves;
}

function testerAdresse(ip, delai) {
  return new Promise(resoudre => {
    const socket = new net.Socket();
    let repondu = false;
    const fin = (ok) => {
      if (repondu) return;
      repondu = true;
      socket.destroy();
      resoudre(ok ? ip : null);
    };
    socket.setTimeout(delai || DELAI);
    socket.on('timeout', () => fin(false));
    socket.on('error', () => fin(false));
    socket.connect(PORT_IMPRIMANTE, ip, () => fin(true));
  });
}

// Parcourt les adresses par paquets pour ne pas ouvrir 254 connexions d'un coup.
async function balayer(base, ignorer) {
  const trouvees = [];
  const adresses = [];
  for (let n = 1; n <= 254; n++) {
    const ip = `${base}.${n}`;
    if (ip !== ignorer) adresses.push(ip);
  }
  for (let i = 0; i < adresses.length; i += SIMULTANEES) {
    const paquet = adresses.slice(i, i + SIMULTANEES);
    const resultats = await Promise.all(paquet.map(ip => testerAdresse(ip)));
    resultats.forEach(r => { if (r) trouvees.push(r); });
  }
  return trouvees;
}

/**
 * Cherche les imprimantes joignables sur les réseaux de cet ordinateur.
 * @param {(texte: string) => void} [journal]
 * @returns {Promise<string[]>} adresses trouvées
 */
async function chercherImprimantes(journal) {
  const reseaux = reseauxLocaux();
  if (!reseaux.length) {
    if (journal) journal("Cet ordinateur n'est connecté à aucun réseau.");
    return [];
  }
  const toutes = [];
  for (const r of reseaux) {
    if (journal) journal(`Recherche sur le réseau ${r.base}.x …`);
    const trouvees = await balayer(r.base, r.adresse);
    trouvees.forEach(ip => { if (!toutes.includes(ip)) toutes.push(ip); });
  }
  return toutes;
}

module.exports = { chercherImprimantes, testerAdresse, reseauxLocaux, PORT_IMPRIMANTE };
