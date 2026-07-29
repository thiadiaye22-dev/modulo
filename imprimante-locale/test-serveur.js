"use strict";

// Test de bout en bout du serveur : une fausse imprimante écoute en TCP sur le
// port 9100 et l'on vérifie que les octets reçus correspondent bien au travail
// envoyé en HTTP. Aucune imprimante réelle n'est nécessaire.

const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const r = require('./raster');

const PORT_HTTP = 3999;
let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};

function requete(chemin, corps) {
  return new Promise((resoudre, rejeter) => {
    const donnees = corps ? Buffer.from(JSON.stringify(corps)) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT_HTTP, path: chemin,
      method: corps ? 'POST' : 'GET',
      headers: donnees ? { 'Content-Type': 'application/json', 'Content-Length': donnees.length } : {}
    }, (rep) => {
      const m = [];
      rep.on('data', c => m.push(c));
      rep.on('end', () => {
        const t = Buffer.concat(m).toString('utf8');
        try { resoudre({ code: rep.statusCode, corps: JSON.parse(t) }); }
        catch (e) { resoudre({ code: rep.statusCode, corps: t }); }
      });
    });
    req.on('error', rejeter);
    if (donnees) req.write(donnees);
    req.end();
  });
}

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\nServeur d\'impression local\n');

  // Fausse imprimante
  let recu = [];
  const imprimante = net.createServer(socket => {
    socket.on('data', c => {
      recu.push(c);
      // Répondre à la demande d'état évite que le serveur épuise ses reprises
      // au démarrage, ce qui retarderait son écoute au-delà du délai du test.
      if (c.length < 300) {
        const e = Buffer.alloc(32, 0);
        e[0] = 0x80; e[1] = 0x20; e[2] = 0x42; e[10] = 62; e[11] = 0x0a;
        socket.write(e);
      }
    });
  });
  await new Promise(res => imprimante.listen(9100, '127.0.0.1', res));

  const serveur = spawn(process.execPath,
    [__dirname + '/serveur.js', '--imprimante', '127.0.0.1', '--port', String(PORT_HTTP)],
    { stdio: 'ignore' });
  await attendre(3000);

  try {
    const etat = await requete('/etat');
    verifier('/etat voit l\'imprimante', () => {
      assert.strictEqual(etat.code, 200);
      assert.ok(etat.corps.joignable, 'devrait être joignable : ' + etat.corps.detail);
    });

    // Travail de deux étiquettes 696 × 30
    const LARGEUR = 696, HAUTEUR = 30;
    const octets = LARGEUR / 8;
    const bits = Buffer.alloc(octets * HAUTEUR, 0);
    for (let y = 0; y < HAUTEUR; y++) bits[y * octets] = 0xff;   // bande noire à gauche

    recu = [];
    const rep = await requete('/imprimer', {
      pages: [
        { bits: bits.toString('base64'), largeurPoints: LARGEUR, hauteur: HAUTEUR },
        { bits: bits.toString('base64'), largeurPoints: LARGEUR, hauteur: HAUTEUR }
      ],
      options: { largeurMm: 62 }
    });
    await attendre(700);

    verifier('/imprimer répond OK pour 2 pages', () => {
      assert.strictEqual(rep.code, 200, JSON.stringify(rep.corps));
      assert.ok(rep.corps.ok);
      assert.strictEqual(rep.corps.pages, 2);
    });

    // Le serveur interroge l'état avant d'imprimer : cet échange précède le
    // travail dans le flux enregistré, on le retire pour comparer.
    const tout = Buffer.concat(recu);
    const debut = tout.length - rep.corps.octets;
    const flux = tout.slice(Math.max(0, debut));
    verifier('l\'imprimante a bien reçu le flux', () => {
      assert.ok(tout.length > 0, 'rien reçu');
      assert.ok(debut >= 0,
        `annoncé ${rep.corps.octets}, reçu seulement ${tout.length}`);
    });

    verifier('le flux reçu est un travail raster valide', () => {
      assert.ok(flux.slice(0, 200).every(o => o === 0), 'invalidation');
      assert.deepStrictEqual([...flux.slice(200, 202)], [0x1b, 0x40], 'ESC @');
      assert.strictEqual(flux[flux.length - 1], 0x1a, 'ordre final');
      assert.strictEqual(flux.filter(o => o === 0x0c).length, 1, 'un seul saut de page');
    });

    verifier('les points sont décalés de 12 pour être centrés', () => {
      const i = flux.indexOf(Buffer.from([0x67, 0x00, 90]));
      assert.ok(i > 0, 'aucun transfert de ligne trouvé');
      const ligne = flux.slice(i + 3, i + 93);
      assert.strictEqual(ligne[0], 0x00, 'les 8 premiers points doivent être blancs');
      assert.strictEqual(ligne[1], 0x0f, 'points 12-15 noirs');
      assert.strictEqual(ligne[2], 0xf0, 'points 16-19 noirs');
    });

    const mauvais = await requete('/imprimer', {
      pages: [{ bits: Buffer.alloc(10).toString('base64'), largeurPoints: 696, hauteur: 30 }]
    });
    verifier('une taille de données incohérente est refusée avec un message clair', () => {
      assert.strictEqual(mauvais.code, 400);
      assert.match(mauvais.corps.erreur, /octets reçus/);
    });

    const vide = await requete('/imprimer', { pages: [] });
    verifier('un travail vide est refusé', () => {
      assert.strictEqual(vide.code, 400);
      assert.match(vide.corps.erreur, /aucune page/);
    });

    recu = [];
    const simu = await requete('/imprimer', {
      simulation: true,
      pages: [{ bits: bits.toString('base64'), largeurPoints: LARGEUR, hauteur: HAUTEUR }]
    });
    await attendre(300);
    verifier('le mode simulation n\'envoie rien à l\'imprimante', () => {
      assert.strictEqual(simu.code, 200);
      assert.ok(simu.corps.simulation);
      assert.strictEqual(Buffer.concat(recu).length, 0, 'des octets ont été envoyés');
    });

    const inconnu = await requete('/nimportequoi');
    verifier('route inconnue → 404', () => assert.strictEqual(inconnu.code, 404));

  } finally {
    serveur.kill();
    imprimante.close();
  }

  console.log(echecs ? `\n${echecs} échec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
