"use strict";

// Vérifie la recherche automatique : une fausse imprimante est ouverte sur
// 127.0.0.1:9100 et l'on contrôle qu'elle est détectée, et qu'une adresse
// sans rien derrière ne l'est pas.

const net = require('net');
const assert = require('assert');
const r = require('./recherche');

let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};

(async () => {
  console.log('\nRecherche automatique de l\'imprimante\n');

  const faux = net.createServer(() => {});
  await new Promise(res => faux.listen(9100, '127.0.0.1', res));

  const trouve = await r.testerAdresse('127.0.0.1', 1000);
  verifier('une adresse qui écoute sur 9100 est détectée',
    () => assert.strictEqual(trouve, '127.0.0.1'));

  faux.close();
  await new Promise(res => setTimeout(res, 200));

  const absent = await r.testerAdresse('127.0.0.1', 500);
  verifier('une adresse sans imprimante n\'est pas retenue',
    () => assert.strictEqual(absent, null));

  const injoignable = await r.testerAdresse('192.0.2.1', 400);   // réseau de test, RFC 5737
  verifier('une adresse injoignable rend la main dans le délai',
    () => assert.strictEqual(injoignable, null));

  verifier('les réseaux locaux sont listés avec leur base /24', () => {
    const reseaux = r.reseauxLocaux();
    reseaux.forEach(x => {
      assert.match(x.base, /^\d+\.\d+\.\d+$/, 'base ' + x.base);
      assert.ok(x.adresse.startsWith(x.base + '.'), 'adresse hors de sa base');
    });
  });

  // --- Identification Brother ---
  // Une vraie QL répond 32 octets commençant par 0x80 0x20 0x42 ('B').
  const brother = net.createServer(socket => {
    socket.on('data', () => {
      const etat = Buffer.alloc(32, 0);
      etat[0] = 0x80; etat[1] = 0x20; etat[2] = 0x42; etat[3] = 0x30;
      socket.write(etat);
    });
  });
  await new Promise(res => brother.listen(9101, '127.0.0.1', res));

  // Une imprimante d'un autre constructeur : accepte la connexion, ne répond rien.
  const muette = net.createServer(() => {});
  await new Promise(res => muette.listen(9102, '127.0.0.1', res));

  const avecPort = (port) => new Promise(resoudre => {
    const s = new net.Socket();
    const recu = [];
    let fini = false;
    const fin = (ok) => { if (fini) return; fini = true; s.destroy(); resoudre(ok); };
    s.setTimeout(1200);
    s.on('timeout', () => fin(false));
    s.on('error', () => fin(false));
    s.on('data', c => {
      recu.push(c);
      const r = Buffer.concat(recu);
      if (r.length >= 3) fin(r[0] === 0x80 && r[1] === 0x20 && r[2] === 0x42);
    });
    s.connect(port, '127.0.0.1', () => s.write(Buffer.concat([
      Buffer.alloc(200, 0), Buffer.from([0x1b, 0x40]), Buffer.from([0x1b, 0x69, 0x53])])));
  });

  const reponseBrother = await avecPort(9101);
  verifier('une imprimante qui répond la signature Brother est reconnue',
    () => assert.strictEqual(reponseBrother, true));

  const reponseMuette = await avecPort(9102);
  verifier('une imprimante muette n\'est pas prise pour une Brother',
    () => assert.strictEqual(reponseMuette, false));

  brother.close(); muette.close();

  console.log(echecs ? `\n${echecs} échec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
