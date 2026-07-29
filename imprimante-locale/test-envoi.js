"use strict";

// Vérifie que la totalité du travail parvient à l'imprimante.
//
// La fermeture brutale d'une connexion TCP (RST) fait perdre ce que le
// destinataire n'a pas encore lu. Ce test envoie un gros travail à une fausse
// imprimante qui lit lentement, et contrôle qu'aucun octet ne manque.

const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');

const PORT_HTTP = 3991;
let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

function poster(chemin, corps) {
  return new Promise((resoudre, rejeter) => {
    const d = Buffer.from(JSON.stringify(corps));
    const req = http.request({ host: '127.0.0.1', port: PORT_HTTP, path: chemin, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } }, (rep) => {
      const m = [];
      rep.on('data', c => m.push(c));
      rep.on('end', () => resoudre({ code: rep.statusCode, corps: JSON.parse(Buffer.concat(m).toString()) }));
    });
    req.on('error', rejeter);
    req.write(d); req.end();
  });
}

(async () => {
  console.log('\nIntegrite de l\'envoi a l\'imprimante\n');

  // Une connexion par échange : la demande d'état et le travail d'impression
  // sont distincts, on ne doit pas les additionner.
  let connexions = [];
  let ferme = false;
  // Imprimante lente : elle met du temps à lire, comme une tête thermique réelle.
  const imprimante = net.createServer(socket => {
    const morceaux = [];
    connexions.push(morceaux);
    socket.on('data', c => {
      morceaux.push(c);
      // Répond à la demande d'état (petit paquet) pour que le serveur démarre vite.
      if (c.length < 300) {
        const e = Buffer.alloc(32, 0);
        e[0] = 0x80; e[1] = 0x20; e[2] = 0x42; e[10] = 62; e[11] = 0x0a;
        socket.write(e);
        return;
      }
      // Lecture lente, comme une tête thermique réelle.
      socket.pause();
      setTimeout(() => socket.resume(), 60);
    });
    socket.on('end', () => { ferme = true; socket.end(); });
  });
  await new Promise(res => imprimante.listen(9100, '127.0.0.1', res));

  const serveur = spawn(process.execPath, [__dirname + '/serveur.js',
    '--imprimante', '127.0.0.1', '--port', String(PORT_HTTP)], { stdio: 'ignore' });
  await attendre(3000);

  try {
    // Étiquette réaliste : 696 points de large, 900 lignes
    const LARGEUR = 696, HAUTEUR = 900;
    const octets = LARGEUR / 8;
    const bits = Buffer.alloc(octets * HAUTEUR);
    for (let i = 0; i < bits.length; i++) bits[i] = (i * 37) & 0xff;   // motif non nul

    connexions = []; ferme = false;
    const rep = await poster('/imprimer', {
      pages: [{ bits: bits.toString('base64'), largeurPoints: LARGEUR, hauteur: HAUTEUR }],
      options: { largeurMm: 62 }
    });
    await attendre(2500);

    // Le travail d'impression est la plus grosse des connexions reçues.
    const flux = connexions
      .map(m => Buffer.concat(m))
      .reduce((a, b) => (b.length > a.length ? b : a), Buffer.alloc(0));
    verifier('le serveur annonce la reussite', () => {
      assert.strictEqual(rep.code, 200, JSON.stringify(rep.corps));
      assert.ok(rep.corps.ok);
    });

    verifier('tous les octets annonces sont bien arrives', () => {
      assert.strictEqual(flux.length, rep.corps.octets,
        `annonce ${rep.corps.octets}, recu ${flux.length} — ${rep.corps.octets - flux.length} perdus`);
    });

    verifier('le travail se termine par l\'ordre d\'impression', () => {
      assert.strictEqual(flux[flux.length - 1], 0x1a,
        `dernier octet 0x${flux[flux.length - 1].toString(16)} au lieu de 0x1a`);
    });

    verifier('la connexion est fermee proprement, pas coupee', () => {
      assert.ok(ferme, 'l\'imprimante n\'a pas recu de fin de flux (FIN)');
    });

  } finally {
    serveur.kill();
    imprimante.close();
  }

  console.log(echecs ? `\n${echecs} echec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
