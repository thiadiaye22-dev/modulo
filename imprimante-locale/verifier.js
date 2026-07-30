"use strict";

// Vérification de l'installation, et impression d'une étiquette de test.
//
// Ne fait intervenir ni la tablette, ni le navigateur, ni le réseau : seulement
// cet ordinateur et le pilote Brother. Si l'étiquette sort ici, la chaîne
// complète fonctionnera ; si elle ne sort pas, le problème est en amont de tout
// le reste et l'outil dit lequel.

const pilote = require('./pilote-windows');
const png = require('./png');

const PPP = 300;
const mm = (n) => Math.round(n * PPP / 25.4);

// Étiquette de test : un repère millimétré pour contrôler l'échelle, un aplat
// noir pour contrôler la densité, et deux traits pleins pour le centrage.
// La largeur suit le format du pilote : 696 points sur du 62 mm, 306 sur du 29.
function imageTest(largeur) {
  const octets = Math.ceil(largeur / 8);
  const hauteur = mm(40);
  const bits = Buffer.alloc(octets * hauteur);
  const poser = (x, y) => {
    if (x < 0 || x >= largeur || y < 0 || y >= hauteur) return;
    bits[y * octets + (x >> 3)] |= 0x80 >> (x & 7);
  };
  const rectangle = (x0, y0, l, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + l; x++) poser(x, y);
  };

  // Le repère fait 50 mm quand la largeur le permet, sinon 20 mm.
  const repereMm = largeur >= mm(54) ? 50 : 20;

  rectangle(0, mm(2), largeur, mm(1.5));            // trait pleine largeur, en haut
  rectangle(mm(2), mm(7), mm(repereMm), mm(1.5));   // repère millimétré
  rectangle(mm(2), mm(13), largeur - mm(4), mm(12)); // aplat noir
  rectangle(0, mm(30), largeur, mm(1.5));           // trait pleine largeur, en bas

  // Repères d'angle, pour voir si un bord est rogné.
  [[0, mm(35)], [largeur - mm(5), mm(35)]].forEach(([x, y]) => rectangle(x, y, mm(5), mm(3)));

  return { bits, largeur, hauteur, repereMm };
}

// Zone imprimable d'un format du pilote : sa largeur moins les marges de tête
// d'impression (≈ 1,5 mm de chaque côté). 62 mm → 696 points, 29 mm → 306.
const pointsPourFormat = (largeurMm) => Math.round((largeurMm - 3.1) * PPP / 25.4);

function lireOption(nom, defaut) {
  const i = process.argv.indexOf('--' + nom);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : defaut;
}

(async () => {
  console.log('');
  console.log('  ==================================================');
  console.log('    VERIFICATION DE L\'INSTALLATION');
  console.log('  ==================================================');
  console.log('');

  // 1. Système
  console.log(`  Systeme        : ${process.platform === 'win32' ? 'Windows' : process.platform}`);
  console.log(`  Node.js        : ${process.version}`);
  if (!pilote.disponible()) {
    console.log('');
    console.log('  Le pilote ne peut etre pilote que depuis Windows.');
    console.log('  Sur cet ordinateur, seul l\'envoi direct est possible — et il');
    console.log('  n\'imprime pas sur ce modele.');
    console.log('');
    return;
  }

  // 2. Le pilote est-il installé ?
  console.log('  Recherche des imprimantes installees dans Windows...');
  const liste = await pilote.listerImprimantes();
  console.log('');

  if (!liste.ok) {
    console.log('  IMPOSSIBLE D\'INTERROGER WINDOWS.');
    console.log(`  Detail : ${liste.erreur}`);
    console.log('');
    return;
  }

  console.log('  Imprimantes vues par Windows :');
  liste.toutes.forEach(n => {
    console.log(`    ${pilote.estEtiqueteuseBrother(n) ? '>> ' : '   '}${n}`);
  });
  console.log('');

  if (!liste.brother.length) {
    console.log('  ==================================================');
    console.log('    LE PILOTE BROTHER N\'EST PAS INSTALLE');
    console.log('  ==================================================');
    console.log('');
    console.log('  Aucune etiqueteuse Brother dans la liste ci-dessus.');
    console.log('');
    console.log('  A FAIRE :');
    console.log('   1. Clic DROIT sur l\'installateur Brother (CommonInstaller.exe)');
    console.log('      puis "Executer en tant qu\'administrateur". Il refuse');
    console.log('      d\'installer autrement.');
    console.log('   2. Modele QL-820NWBc, connexion "reseau sans fil" (Wi-Fi),');
    console.log('      adresse de l\'imprimante 192.168.1.46');
    console.log('   3. Verifiez ensuite dans Parametres > Imprimantes et');
    console.log('      scanners : la Brother doit y figurer, etat "Pret"');
    console.log('   4. Relancez cette verification');
    console.log('');
    console.log('  Si vous n\'avez pas l\'installateur : support.brother.com,');
    console.log('  modele QL-820NWBc, rubrique Telechargements.');
    console.log('');
    console.log('  Si l\'imprimante apparait sous un autre nom, relancez avec :');
    console.log('      node verifier.js --nom-imprimante "le nom exact"');
    console.log('');
    return;
  }

  const imprimante = lireOption('nom-imprimante', liste.brother[0]);
  console.log(`  Etiqueteuse retenue : ${imprimante}`);
  console.log('');

  // 3. L'état de la file d'attente : c'est là que « rien ne sort » se joue.
  // Une réponse « OK » du pilote dit seulement que le travail est entré dans
  // la file ; si Windows tient l'imprimante pour hors connexion, il y restera.
  const avant = await pilote.lireFile(imprimante);
  if (avant.ok && avant.port) {
    if (avant.port.type === 'TCPIP') {
      console.log(`  Port Windows      : reseau, adresse ${avant.port.adresse}` +
                  (avant.port.numero ? `:${avant.port.numero}` : ''));
    } else {
      console.log(`  Port Windows      : ${avant.port.adresse}`);
      if (/^WSD/i.test(avant.port.adresse)) {
        console.log('                      (port "WSD" : ce type de port tombe');
        console.log('                      souvent hors connexion tout seul)');
      }
    }
  }
  if (avant.ok && avant.imprimante) {
    console.log(`  Etat selon Windows: ${avant.imprimante.etat}` +
                (avant.imprimante.erreur !== 'aucune' ? ` — erreur : ${avant.imprimante.erreur}` : ''));

    if (avant.imprimante.horsLigne) {
      console.log('');
      console.log('  ==================================================');
      console.log('    WINDOWS TIENT L\'IMPRIMANTE POUR "HORS CONNEXION"');
      console.log('  ==================================================');
      console.log('');
      console.log('  Voila pourquoi rien ne sort : le pilote accepte les');
      console.log('  etiquettes, mais Windows les garde dans la file d\'attente');
      console.log('  au lieu de les envoyer.');
      console.log('');
      console.log('  A FAIRE :');
      console.log('   1. Parametres > Bluetooth et appareils > Imprimantes et');
      console.log('      scanners > Brother QL-820NWB');
      console.log('   2. "Ouvrir la file d\'attente d\'impression"');
      console.log('   3. Dans la petite fenetre, menu "Imprimante" (en haut) :');
      console.log('      DECOCHEZ "Utiliser l\'imprimante hors connexion"');
      console.log('   4. Relancez cette verification');
      console.log('');
      console.log('  Si la case se recoche toute seule, Windows n\'arrive plus a');
      console.log('  joindre l\'imprimante par le port indique ci-dessus :');
      console.log('  eteignez l\'imprimante, rallumez-la, attendez le voyant fixe,');
      console.log('  et relancez cette verification.');
      console.log('');
      return;
    }

    if (avant.travaux.length) {
      console.log(`  File d'attente    : ${avant.travaux.length} travail(aux) ` +
                  'coince(s) d\'essais precedents — on vide la file...');
      const purge = await pilote.purgerFile(imprimante);
      if (!purge.ok) console.log(`                      purge impossible : ${purge.erreur}`);
    }
  }

  // 4. Ce que le pilote déclare savoir faire
  const format = lireOption('format', '');
  const reglages = await pilote.listerFormats(imprimante);
  if (!reglages.ok) {
    console.log(`  Formats du pilote : lecture impossible (${reglages.erreur})`);
  } else {
    if (reglages.defaut) {
      const d = reglages.defaut;
      console.log(`  Format par defaut : ${d.nom} — ` +
                  `${pilote.enMm(d.largeur)} x ${pilote.enMm(d.hauteur)} mm`);
    }
    if (reglages.zone) {
      const z = reglages.zone;
      console.log(`  Zone imprimable   : ${pilote.enMm(z.largeur)} x ` +
                  `${pilote.enMm(z.hauteur)} mm, a partir de ` +
                  `${pilote.enMm(z.x)} / ${pilote.enMm(z.y)} mm`);
    }
    if (reglages.resolutions.length) {
      console.log('  Resolutions       : ' +
        reglages.resolutions.map(r => `${r.x}x${r.y}`).join(', ') + ' ppp');
    }
    if (reglages.formats.length) {
      const tous = process.argv.includes('--tous-formats');
      // Par défaut : seulement les largeurs de rouleau utilisées ici, 29 et 62.
      const visibles = tous ? reglages.formats
        : reglages.formats.filter(f => [29, 62].some(
            lg => Math.abs(pilote.enMm(f.largeur) - lg) < 1.5));
      console.log('');
      console.log(`  Formats du pilote en 29 et 62 mm de large` +
                  (tous ? '' : ` (--tous-formats pour les ${reglages.formats.length})`) + ' :');
      visibles.forEach(f => {
        console.log(`    ${pilote.enMm(f.largeur).toString().padStart(6)} x ` +
                    `${pilote.enMm(f.hauteur).toString().padEnd(6)} mm   ${f.nom}`);
      });
    }
  }
  console.log('');

  // 5. Le format d'impression. La règle d'or : la description du média dans
  // le travail doit correspondre au rouleau réellement chargé, sinon
  // l'imprimante jette le travail sans un mot — la file se vide, rien ne
  // sort. Le plus sûr est donc le format PAR DEFAUT du pilote : c'est celui
  // que l'installation Brother a réglé pour le rouleau en place.
  //   --rouleau 29|62   impose la largeur (formats du pilote correspondants)
  //   --format "nom"    impose un format précis du pilote
  const rouleau = lireOption('rouleau', '');
  let choisi = null;
  if (format && reglages.ok) {
    choisi = reglages.formats.find(f => f.nom === format) || null;
    if (!choisi) console.log(`  Format "${format}" inconnu du pilote — on continue sans.`);
  } else if (rouleau && reglages.ok) {
    choisi = pilote.formatPourRouleau(reglages.formats, +rouleau);
    if (!choisi) console.log(`  Aucun format de ${rouleau} mm declare par le pilote.`);
  }
  if (!choisi && reglages.ok && reglages.defaut) {
    choisi = reglages.defaut;
  }

  let formatRetenu, largeurImage;
  if (choisi) {
    formatRetenu = choisi.nom;
    largeurImage = pointsPourFormat(pilote.enMm(choisi.largeur));
    console.log(`  Format retenu : "${choisi.nom}" — ${pilote.enMm(choisi.largeur)} x ` +
                `${pilote.enMm(choisi.hauteur)} mm`);
    console.log('');
    console.log('  CE FORMAT DOIT CORRESPONDRE AU ROULEAU DANS L\'IMPRIMANTE.');
    console.log('  Sinon, l\'imprimante jettera le travail sans rien afficher.');
    console.log('  Pour un autre rouleau : relancez avec  --rouleau 62  (ou 29),');
    console.log('  ou changez le format par defaut dans Parametres > Imprimantes');
    console.log('  et scanners > Brother > Preferences d\'impression.');
  } else {
    formatRetenu = '';
    largeurImage = 696;
    console.log('  Formats du pilote illisibles : format sur mesure tente en 62 mm.');
  }
  console.log('');

  // 6. Impression de l'étiquette de test
  console.log('  Envoi d\'une etiquette de test au pilote...');
  const img = imageTest(largeurImage);
  const image = png.encoder1bit(img.bits, img.largeur, img.hauteur);

  const r = await pilote.imprimerPng(image, {
    imprimante,
    largeurPoints: img.largeur,
    hauteurPoints: img.hauteur,
    format: formatRetenu || undefined
  });

  console.log('');
  if (!r.ok) {
    console.log('  ==================================================');
    console.log('    LE PILOTE A REFUSE L\'ETIQUETTE');
    console.log('  ==================================================');
    console.log('');
    console.log(`  ${r.erreur}`);
    console.log('');
    console.log('  A verifier :');
    console.log('   - l\'imprimante est allumee et son voyant est FIXE');
    console.log('   - elle apparait comme "Pret" dans Imprimantes et scanners');
    console.log('   - un clic droit sur une photo > Imprimer fonctionne');
    console.log('     (si cela echoue aussi, le probleme est entre Windows et');
    console.log('      l\'imprimante, pas dans ce programme)');
    console.log('');
    return;
  }

  console.log('  ==================================================');
  console.log('    ETIQUETTE ENVOYEE AU PILOTE');
  console.log('  ==================================================');
  if (r.detail) r.detail.split(/\r?\n/).forEach(l => console.log(`  ${l}`));
  console.log('');

  // 7. Le travail est-il vraiment parti, ou coincé dans la file ?
  console.log('  On laisse 8 secondes a Windows, puis on regarde la file...');
  await new Promise(res => setTimeout(res, 8000));
  const apres = await pilote.lireFile(imprimante);
  console.log('');
  if (apres.ok) {
    if (!apres.travaux.length) {
      console.log('  La file d\'attente est VIDE : Windows a bien remis le');
      console.log('  travail a l\'imprimante.');
    } else {
      console.log('  LE TRAVAIL EST ENCORE DANS LA FILE D\'ATTENTE :');
      apres.travaux.forEach(t => {
        console.log(`    - "${t.document}" — etat : ${t.etat || t.statut || 'en attente'}`);
      });
      console.log('');
      console.log('  Tant qu\'il y reste, rien ne sortira. Le plus souvent :');
      console.log('   - l\'imprimante n\'est plus joignable par le port Windows');
      console.log('     (eteignez-la, rallumez-la, attendez le voyant fixe)');
      console.log('   - ou le rouleau ne correspond pas au format regle dans le');
      console.log('     pilote (le voyant de l\'imprimante clignote alors)');
      console.log('');
      console.log('  Relancez ensuite cette verification : elle videra la file');
      console.log('  et refera un essai propre.');
      console.log('');
      return;
    }
  }
  console.log('');
  console.log('  REGARDEZ L\'IMPRIMANTE.');
  console.log('');
  const coupe = choisi ? Math.round(pilote.enMm(choisi.hauteur)) : 90;
  console.log('  Ce qui doit sortir (le dessin occupe les 40 premiers mm, la');
  console.log(`  coupe se fait vers ${coupe} mm, le reste est blanc — c'est`);
  console.log('  normal pour ce test) :');
  console.log('   - un trait noir sur toute la largeur, en haut et en bas');
  console.log(`   - un trait de ${img.repereMm} mm exactement (mesurez a la regle)`);
  console.log('   - un rectangle noir bien uniforme');
  console.log('   - deux reperes dans les coins du bas');
  console.log('');
  console.log('  ETIQUETTE CONFORME  ->  tout fonctionne. Lancez ensuite');
  console.log('                          2-DEMARRER-SERVEUR.bat, et sur la');
  console.log('                          tablette, reglez "Largeur du rouleau"');
  console.log('                          sur la largeur du rouleau charge.');
  console.log('');
  console.log('  RIEN NE SORT        ->  le format retenu ci-dessus ne correspond');
  console.log('                          sans doute pas au rouleau charge :');
  console.log('                          relancez avec  --rouleau 62  ou  --rouleau 29');
  console.log('                          Sinon, la file d\'attente Windows dira ce');
  console.log('                          qui bloque (Parametres > Imprimantes).');
  console.log('');
  console.log('  DU PAPIER BLANC SORT ->  l\'image part au mauvais endroit ou le');
  console.log('                          format ne correspond pas. Notez la ligne');
  console.log('                          "PAGE:" ci-dessus et la longueur sortie.');
  console.log('');
  console.log('  MAUVAISE TAILLE     ->  relancez en imposant un format du pilote,');
  console.log('                          choisi dans la liste ci-dessus :');
  console.log('                          node verifier.js --format "62mm"');
  console.log('');
})().catch(e => {
  console.error('');
  console.error('  Erreur de la verification : ' + e.message);
  console.error('');
});
