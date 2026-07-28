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
const fs = require('fs');
const path = require('path');
const raster = require('./raster');
const recherche = require('./recherche');
const etatImprimante = require('./etat');

const PORT_IMPRIMANTE = 9100;

function lireOption(nom, valeurParDefaut) {
  const i = process.argv.indexOf('--' + nom);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const env = process.env['QL_' + nom.toUpperCase()];
  return env || valeurParDefaut;
}

// L'adresse peut être fournie ; sinon le serveur cherche l'imprimante tout seul.
let IMPRIMANTE = lireOption('imprimante', '');
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
  // Chrome refuse depuis 2022 qu'une page appelle une adresse du réseau local
  // sans cet en-tête (Private Network Access). Sans lui, l'application ouverte
  // depuis un fichier local ne peut pas joindre ce serveur.
  rep.setHeader('Access-Control-Allow-Private-Network', 'true');
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

  // On demande à l'imprimante quel rouleau est chargé plutôt que de le supposer :
  // un support déclaré différent de celui en place est refusé avec
  // « mauvais type de rouleau ».
  let support = null;
  if (!demande.simulation) {
    const lu = await etatImprimante.lireEtat(IMPRIMANTE);
    if (lu.ok) {
      support = lu.etat;
      const bloquantes = support.erreurs.filter(e => !/occupée/.test(e));
      if (support.typeCle === 'aucun' || bloquantes.length) {
        return json(rep, 409, { ok: false,
          erreur: 'Imprimante non prête : ' + (bloquantes.join(', ') || 'aucun rouleau chargé'),
          support });
      }
      const largeurDemandee = demande.pages[0].largeurPoints || raster.POINTS_IMPRIMABLES_62;
      if (support.pointsImprimables && largeurDemandee > support.pointsImprimables) {
        return json(rep, 409, { ok: false,
          erreur: `L'étiquette fait ${largeurDemandee} points de large, or le rouleau ` +
                  `chargé (${support.libelle}) n'en imprime que ${support.pointsImprimables}. ` +
                  `Choisissez la bonne largeur de rouleau dans les réglages.`,
          support });
      }
    }
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
    const options = Object.assign({}, demande.options || {});
    if (support) {
      options.largeurMm = support.largeurMm;
      options.longueurMm = support.longueurMm;
      options.typeSupport = support.typeSupport;
    }
    flux = raster.construireFlux(pages, options);
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

  // L'application est servie par ce serveur : la page et les requêtes
  // d'impression partagent alors la même origine, ce qui évite tous les
  // blocages du navigateur (CORS, réseau privé, fichier local).
  if ((chemin === '/' || chemin === '/index.html') && req.method === 'GET') {
    const fichier = trouverApplication();
    if (fichier) {
      cors(rep);
      rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
                           'Cache-Control': 'no-store' });
      return rep.end(fs.readFileSync(fichier));
    }
    cors(rep);
    rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return rep.end(PAGE_ACCUEIL.replace('IMPRIMANTE', IMPRIMANTE));
  }

  if (chemin === '/etat.html' && req.method === 'GET') {
    cors(rep);
    rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return rep.end(PAGE_ACCUEIL.replace('IMPRIMANTE', IMPRIMANTE));
  }

  if (chemin === '/etat' && req.method === 'GET') {
    const base = await testerImprimante();
    const reponse = Object.assign({ imprimante: IMPRIMANTE, port: PORT_IMPRIMANTE }, base);
    if (base.joignable) {
      const lu = await etatImprimante.lireEtat(IMPRIMANTE);
      if (lu.ok) {
        reponse.support = lu.etat;
        if (lu.etat.erreurs.length) reponse.avertissements = lu.etat.erreurs;
      }
    }
    return json(rep, 200, reponse);
  }

  if (chemin === '/imprimer' && req.method === 'POST') return traiterImpression(req, rep);

  json(rep, 404, { ok: false, erreur: 'route inconnue' });
});

// L'application est cherchée à côté du serveur, puis dans public/ du dépôt.
function trouverApplication() {
  const candidats = [
    path.join(__dirname, 'etiquettes-dlc.html'),
    path.join(__dirname, '..', 'public', 'etiquettes-dlc.html')
  ];
  return candidats.find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }) || null;
}

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

const encadre = (lignes) => {
  const largeur = Math.max.apply(null, lignes.map(l => l.length)) + 4;
  console.log('  +' + '-'.repeat(largeur) + '+');
  lignes.forEach(l => console.log('  |  ' + l + ' '.repeat(largeur - l.length - 2) + '|'));
  console.log('  +' + '-'.repeat(largeur) + '+');
};

// Démarrage guidé : on cherche l'imprimante si son adresse n'a pas été fournie,
// puis on affiche en clair l'adresse à recopier sur la tablette.
async function demarrer() {
  console.log('');
  console.log('  ===========================================');
  console.log('    SERVEUR D\'IMPRESSION DES ETIQUETTES DLC');
  console.log('  ===========================================');
  console.log('');

  if (IMPRIMANTE) {
    process.stdout.write(`  Verification de l'imprimante ${IMPRIMANTE} ... `);
    const ok = await recherche.testerAdresse(IMPRIMANTE, 2000);
    console.log(ok ? 'trouvee.' : 'pas de reponse.');
    if (!ok) IMPRIMANTE = '';
  }

  if (!IMPRIMANTE) {
    console.log('  Recherche de l\'imprimante sur le reseau, patientez...');
    console.log('');
    const r = await recherche.chercherImprimantes(t => console.log('    ' + t));
    console.log('');

    if (r.brother.length) {
      IMPRIMANTE = r.brother[0];
      console.log(`  Imprimante Brother trouvee : ${IMPRIMANTE}`);
      if (r.brother.length > 1) {
        console.log('  Autres Brother sur le reseau : ' + r.brother.slice(1).join(', '));
        console.log('  Pour en choisir une autre, relancez avec :');
        console.log(`      node serveur.js --imprimante ${r.brother[1]}`);
      }
      if (r.autres.length) {
        console.log('  (ignore : ' + r.autres.join(', ') + ' — pas des imprimantes Brother)');
      }
    } else if (r.autres.length) {
      // Des imprimantes repondent, mais aucune ne s'annonce comme Brother.
      IMPRIMANTE = r.autres[0];
      console.log('  Imprimantes trouvees : ' + r.autres.join(', '));
      console.log('  AUCUNE NE S\'IDENTIFIE COMME UNE BROTHER.');
      console.log(`  La premiere est retenue (${IMPRIMANTE}), mais ce n'est`);
      console.log('  peut-etre pas la bonne. Si rien ne sort a l\'impression,');
      console.log('  relancez en indiquant la bonne adresse, par exemple :');
      console.log(`      node serveur.js --imprimante ${r.autres[r.autres.length - 1]}`);
    } else {
      console.log('  AUCUNE IMPRIMANTE TROUVEE.');
      console.log('');
      console.log('  A verifier :');
      console.log('   1. L\'imprimante est allumee');
      console.log('   2. Elle est connectee en Wi-Fi (le Bluetooth ne suffit pas)');
      console.log('   3. Cet ordinateur est sur le meme Wi-Fi que l\'imprimante');
      console.log('');
      console.log('  Le serveur demarre quand meme : corrigez, puis relancez-le.');
    }
  }

  if (IMPRIMANTE) {
    const lu = await etatImprimante.lireEtat(IMPRIMANTE);
    if (lu.ok) {
      console.log(`  Rouleau charge : ${lu.etat.libelle}` +
        (lu.etat.pointsImprimables ? ` (${lu.etat.pointsImprimables} points imprimables)` : ''));
      lu.etat.erreurs.forEach(e => console.log('  ATTENTION : ' + e));
    }
  }

  console.log('');
  await new Promise(res => serveur.listen(PORT, '0.0.0.0', res));

  const adresses = adressesLocales();
  console.log('  OUVREZ CETTE ADRESSE DANS LE NAVIGATEUR DE LA TABLETTE :');
  console.log('');
  encadre(adresses.map(a => `http://${a}:${PORT}`));
  console.log('');
  console.log('    L\'application s\'affiche directement. Rien a saisir,');
  console.log('    rien a copier sur la tablette.');
  console.log('    Astuce : ajoutez la page a l\'ecran d\'accueil de la');
  console.log('    tablette pour la retrouver comme une vraie application.');
  console.log('');
  console.log('  LAISSEZ CETTE FENETRE OUVERTE.');
  console.log('  Si vous la fermez, l\'impression ne fonctionnera plus.');
  console.log('');
  console.log('  --------------------------------------------------------');
  console.log('  Si la tablette affiche "Serveur injoignable" :');
  console.log('   - le pare-feu Windows bloque les connexions entrantes.');
  console.log('     Lancez autoriser-pare-feu.bat (clic droit, Executer en');
  console.log('     tant qu\'administrateur), puis relancez ce serveur.');
  console.log('   - verifiez aussi que la tablette est sur le MEME Wi-Fi');
  console.log('     que cet ordinateur (ni 4G, ni reseau invite).');
  console.log('  --------------------------------------------------------');
  console.log('');
}

demarrer().catch(e => {
  console.error('');
  console.error('  ERREUR AU DEMARRAGE : ' + e.message);
  console.error('');
  process.exitCode = 1;
});
