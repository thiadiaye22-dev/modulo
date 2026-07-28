"use strict";

// Serveur d'impression local pour Brother QL-820NWBc.
//
// À lancer sur un ordinateur du même réseau Wi-Fi que l'imprimante :
//     node serveur.js --imprimante 192.168.1.46
//
// La tablette de cuisine envoie l'étiquette déjà tramée ; ce serveur l'habille
// du protocole raster Brother et l'expédie en TCP sur le port 9100. Le navigateur
// n'intervient plus dans l'impression : ni boîte de dialogue, ni format de page.

const http = require('http');
const net = require('net');
const raster = require('./raster');

const PORT_IMPRIMANTE = 9100;

function lireOption(nom, valeurParDefaut) {
  const i = process.argv.indexOf('--' + nom);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const env = process.env['QL_' + nom.toUpperCase()];
  return env || valeurParDefaut;
}

const IMPRIMANTE = lireOption('imprimante', '192.168.1.46');
const PORT = parseInt(lireOption('port', '3001'), 10);

// --- Envoi TCP ---

function envoyerAImprimante(flux) {
  return new Promise((resoudre, rejeter) => {
    const socket = new net.Socket();
    let fini = false;
    const terminer = (err) => {
      if (fini) return;
      fini = true;
      socket.destroy();
      err ? rejeter(err) : resoudre();
    };

    socket.setTimeout(10000);
    socket.on('timeout', () => terminer(new Error(
      `l'imprimante ${IMPRIMANTE}:${PORT_IMPRIMANTE} ne répond pas (délai dépassé)`)));
    socket.on('error', (e) => terminer(new Error(
      `connexion à ${IMPRIMANTE}:${PORT_IMPRIMANTE} impossible — ${e.message}`)));

    socket.connect(PORT_IMPRIMANTE, IMPRIMANTE, () => {
      socket.write(flux, () => {
        // Laisser le temps au tampon de partir avant de fermer.
        setTimeout(() => terminer(null), 400);
      });
    });
  });
}

function testerImprimante() {
  return new Promise((resoudre) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    const repondre = (joignable, detail) => {
      socket.destroy();
      resoudre({ joignable, detail });
    };
    socket.on('timeout', () => repondre(false, 'délai dépassé'));
    socket.on('error', (e) => repondre(false, e.message));
    socket.connect(PORT_IMPRIMANTE, IMPRIMANTE, () => repondre(true, 'connexion établie'));
  });
}

// --- HTTP ---

function cors(rep) {
  rep.setHeader('Access-Control-Allow-Origin', '*');
  rep.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  rep.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(rep, code, corps) {
  cors(rep);
  rep.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  rep.end(JSON.stringify(corps));
}

function lireCorps(req, maxOctets) {
  return new Promise((resoudre, rejeter) => {
    const morceaux = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxOctets) { rejeter(new Error('requête trop volumineuse')); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on('end', () => resoudre(Buffer.concat(morceaux)));
    req.on('error', rejeter);
  });
}

// Corps attendu : { pages: [{ bits: base64, largeurPoints, hauteur }], options }
async function traiterImpression(req, rep) {
  let demande;
  try {
    demande = JSON.parse((await lireCorps(req, 32 * 1024 * 1024)).toString('utf8'));
  } catch (e) {
    return json(rep, 400, { ok: false, erreur: 'JSON invalide : ' + e.message });
  }

  if (!Array.isArray(demande.pages) || !demande.pages.length) {
    return json(rep, 400, { ok: false, erreur: 'aucune page fournie' });
  }

  let flux;
  try {
    const pages = demande.pages.map((p, i) => {
      const largeur = p.largeurPoints || raster.POINTS_IMPRIMABLES_62;
      const hauteur = p.hauteur;
      if (!hauteur || hauteur < 1) throw new Error(`page ${i + 1} : hauteur manquante`);
      const bits = Buffer.from(p.bits, 'base64');
      const attendu = Math.ceil(largeur / 8) * hauteur;
      if (bits.length !== attendu) {
        throw new Error(`page ${i + 1} : ${bits.length} octets reçus, ${attendu} attendus ` +
                        `(${largeur} points × ${hauteur} lignes)`);
      }
      return { lignes: raster.centrerSurTete(bits, largeur, hauteur), hauteur };
    });
    flux = raster.construireFlux(pages, demande.options || {});
  } catch (e) {
    return json(rep, 400, { ok: false, erreur: e.message });
  }

  if (demande.simulation) {
    return json(rep, 200, { ok: true, simulation: true, octets: flux.length,
      pages: demande.pages.length });
  }

  try {
    await envoyerAImprimante(flux);
  } catch (e) {
    return json(rep, 502, { ok: false, erreur: e.message });
  }
  json(rep, 200, { ok: true, pages: demande.pages.length, octets: flux.length });
}

const PAGE_ACCUEIL = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Serveur d'impression DLC</title><style>
body{font:16px/1.6 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px}
code{background:#eee;padding:2px 6px;border-radius:4px}
.ok{color:#1B5E20;font-weight:700}.ko{color:#B71C1C;font-weight:700}</style></head><body>
<h1>Serveur d'impression DLC</h1>
<p>Imprimante configurée : <code>IMPRIMANTE:9100</code></p>
<p id="etat">Vérification…</p>
<p>Adresse à saisir dans l'application HACCP, sur la tablette :<br><code id="url"></code></p>
<script>
document.getElementById('url').textContent = location.origin;
fetch('/etat').then(r=>r.json()).then(d=>{
  document.getElementById('etat').innerHTML = d.joignable
    ? '<span class="ok">✓ Imprimante joignable</span>'
    : '<span class="ko">✗ Imprimante injoignable</span> — ' + d.detail;
});
</script></body></html>`;

const serveur = http.createServer(async (req, rep) => {
  if (req.method === 'OPTIONS') { cors(rep); rep.writeHead(204); return rep.end(); }

  const chemin = (req.url || '/').split('?')[0];

  if (chemin === '/' && req.method === 'GET') {
    cors(rep);
    rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return rep.end(PAGE_ACCUEIL.replace('IMPRIMANTE', IMPRIMANTE));
  }

  if (chemin === '/etat' && req.method === 'GET') {
    const etat = await testerImprimante();
    return json(rep, 200, Object.assign({ imprimante: IMPRIMANTE, port: PORT_IMPRIMANTE }, etat));
  }

  if (chemin === '/imprimer' && req.method === 'POST') return traiterImpression(req, rep);

  json(rep, 404, { ok: false, erreur: 'route inconnue' });
});

serveur.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Serveur d\'impression DLC démarré');
  console.log('  ---------------------------------');
  console.log(`  Imprimante : ${IMPRIMANTE}:${PORT_IMPRIMANTE}`);
  console.log(`  À saisir dans l'application HACCP :`);
  adressesLocales().forEach(a => console.log(`      http://${a}:${PORT}`));
  console.log('');
  testerImprimante().then(e => {
    console.log(e.joignable
      ? '  ✓ Imprimante joignable.'
      : `  ✗ Imprimante injoignable (${e.detail}). Vérifiez son adresse IP et le Wi-Fi.`);
    console.log('');
  });
});

function adressesLocales() {
  const interfaces = require('os').networkInterfaces();
  const sorties = [];
  Object.keys(interfaces).forEach(nom => {
    (interfaces[nom] || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) sorties.push(i.address);
    });
  });
  return sorties.length ? sorties : ['localhost'];
}
