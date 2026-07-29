"use strict";

// Vérifie la sélection de méthode et la voie « pilote » sans Windows.
//
// Le module pilote-windows n'est utilisable que sous Windows ; on contrôle donc
// qu'il refuse proprement ailleurs, que la reconnaissance des étiqueteuses
// Brother par leur nom est juste, et que le serveur retombe sur l'envoi direct
// plutôt que de rester bloqué.

const assert = require('assert');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const pilote = require('./pilote-windows');

const PORT_HTTP = 3990;
let echecs = 0;
const verifier = (nom, fn) => {
  try { fn(); console.log('  ✓ ' + nom); }
  catch (e) { echecs++; console.log('  ✗ ' + nom + '\n      ' + e.message); }
};
const attendre = (ms) => new Promise(r => setTimeout(r, ms));

function requete(chemin, corps) {
  return new Promise((resoudre, rejeter) => {
    const d = corps ? Buffer.from(JSON.stringify(corps)) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT_HTTP, path: chemin,
      method: corps ? 'POST' : 'GET',
      headers: d ? { 'Content-Type': 'application/json', 'Content-Length': d.length } : {} },
      (rep) => {
        const m = [];
        rep.on('data', c => m.push(c));
        rep.on('end', () => {
          const t = Buffer.concat(m).toString();
          try { resoudre({ code: rep.statusCode, corps: JSON.parse(t) }); }
          catch (e) { resoudre({ code: rep.statusCode, corps: t }); }
        });
      });
    req.on('error', rejeter);
    if (d) req.write(d);
    req.end();
  });
}

(async () => {
  console.log('\nImpression par le pilote Brother\n');

  verifier('les etiqueteuses Brother sont reconnues a leur nom', () => {
    const ouiKo = [
      ['Brother QL-820NWBc', true],
      ['Brother QL-800', true],
      ['QL-1110NWB', true],
      ['Brother QL-820NWBc (Copie 1)', true],
      ['Brother DCP-L2530DW', false],     // imprimante bureautique
      ['Microsoft Print to PDF', false],
      ['OneNote (Desktop)', false],
      ['HP LaserJet', false]
    ];
    ouiKo.forEach(([nom, attendu]) => {
      assert.strictEqual(pilote.estEtiqueteuseBrother(nom), attendu, nom);
    });
  });

  verifier('le module se declare indisponible hors Windows', () => {
    assert.strictEqual(pilote.disponible(), process.platform === 'win32');
  });

  if (!pilote.disponible()) {
    const liste = await pilote.listerImprimantes();
    verifier('lister refuse proprement hors Windows', () => {
      assert.strictEqual(liste.ok, false);
      assert.match(liste.erreur, /Windows/);
    });

    const imp = await pilote.imprimerPng(Buffer.alloc(10), {
      imprimante: 'X', largeurPoints: 696, hauteurPoints: 100 });
    verifier('imprimer refuse proprement hors Windows', () => {
      assert.strictEqual(imp.ok, false);
      assert.match(imp.erreur, /Windows/);
    });
  }

  const sansNom = await pilote.imprimerPng(Buffer.alloc(10), { hauteurPoints: 10 });
  verifier('un appel sans nom d\'imprimante est refuse', () => {
    assert.strictEqual(sansNom.ok, false);
    assert.ok(sansNom.erreur, 'aucune raison donnée');
  });

  // Le serveur doit retomber sur l'envoi direct hors Windows, sans se bloquer.
  const imprimante = net.createServer(socket => {
    socket.on('data', c => {
      if (c.length < 300) {
        const e = Buffer.alloc(32, 0);
        e[0] = 0x80; e[1] = 0x20; e[2] = 0x42; e[10] = 62; e[11] = 0x0a;
        socket.write(e);
      }
    });
  });
  await new Promise(r => imprimante.listen(9100, '127.0.0.1', r));
  const serveur = spawn(process.execPath, [__dirname + '/serveur.js',
    '--imprimante', '127.0.0.1', '--port', String(PORT_HTTP)], { stdio: 'ignore' });
  await attendre(3000);

  try {
    const etat = await requete('/etat');
    verifier('le serveur demarre et annonce sa methode', () => {
      assert.strictEqual(etat.code, 200);
      assert.strictEqual(etat.corps.methode, 'direct',
        `methode ${etat.corps.methode} au lieu de direct hors Windows`);
    });

    // En méthode pilote, une page sans PNG doit être refusée avec un message clair.
    const serveurPilote = spawn(process.execPath, [__dirname + '/serveur.js',
      '--imprimante', '127.0.0.1', '--port', String(PORT_HTTP + 1),
      '--methode', 'pilote', '--nom-imprimante', 'Brother QL-820NWBc'], { stdio: 'ignore' });
    await attendre(3000);
    const sansPng = await new Promise((res, rej) => {
      const d = Buffer.from(JSON.stringify({ pages: [{ largeurPoints: 696, hauteur: 100 }] }));
      const req = http.request({ host: '127.0.0.1', port: PORT_HTTP + 1, path: '/imprimer',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': d.length } },
        (rep) => {
          const m = [];
          rep.on('data', c => m.push(c));
          rep.on('end', () => res({ code: rep.statusCode, corps: JSON.parse(Buffer.concat(m).toString()) }));
        });
      req.on('error', rej);
      req.write(d); req.end();
    });
    serveurPilote.kill();
    verifier('en methode pilote, une page sans image PNG est refusee clairement', () => {
      assert.strictEqual(sansPng.code, 400);
      assert.match(sansPng.corps.erreur, /PNG absente/);
      assert.match(sansPng.corps.erreur, /Rechargez/);
    });

  } finally {
    serveur.kill();
    imprimante.close();
  }

  console.log(echecs ? `\n${echecs} echec(s)\n` : '\nTout est vert.\n');
  process.exit(echecs ? 1 : 0);
})();
