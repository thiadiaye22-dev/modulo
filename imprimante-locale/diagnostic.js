"use strict";

// Interroge l'imprimante et affiche tout ce qu'elle déclare.
// À lancer quand l'impression est refusée : le résultat dit exactement quel
// rouleau l'imprimante croit avoir et quelles erreurs sont en cours.

const recherche = require('./recherche');
const etatImprimante = require('./etat');

function lireOption(nom, defaut) {
  const i = process.argv.indexOf('--' + nom);
  return (i !== -1 && process.argv[i + 1]) ? process.argv[i + 1] : defaut;
}

(async () => {
  console.log('');
  console.log('  =========================================');
  console.log('    DIAGNOSTIC DE L\'IMPRIMANTE');
  console.log('  =========================================');
  console.log('');

  let ip = lireOption('imprimante', '');
  if (!ip) {
    console.log('  Recherche de l\'imprimante, patientez...');
    const r = await recherche.chercherImprimantes(t => console.log('    ' + t));
    ip = r.brother[0] || r.autres[0] || '';
    console.log('');
  }
  if (!ip) {
    console.log('  Aucune imprimante trouvee. Verifiez qu\'elle est allumee');
    console.log('  et connectee en Wi-Fi.');
    console.log('');
    return;
  }

  console.log(`  Imprimante : ${ip}`);
  console.log('  Interrogation (jusqu\'a 3 essais)...');
  console.log('');

  const lu = await etatImprimante.lireEtatAvecReprises(ip, 3);

  if (!lu.ok) {
    console.log('  L\'IMPRIMANTE N\'A PAS REPONDU.');
    console.log(`  Detail : ${lu.erreur}`);
    console.log('');
    console.log('  Cause la plus frequente : elle est restee bloquee sur une');
    console.log('  erreur. A FAIRE :');
    console.log('   1. Eteignez l\'imprimante avec son bouton');
    console.log('   2. Attendez 10 secondes');
    console.log('   3. Rallumez-la, attendez que le voyant soit FIXE');
    console.log('   4. Relancez ce diagnostic');
    console.log('');
    console.log('  Verifiez aussi son petit ecran : un message d\'erreur peut');
    console.log('  y etre affiche (capot ouvert, rouleau absent, bourrage).');
    console.log('');
    return;
  }

  const e = lu.etat;
  console.log('  REPONSE RECUE :');
  console.log('');
  console.log(`    Rouleau        : ${e.libelle}`);
  console.log(`    Largeur        : ${e.largeurMm} mm`);
  console.log(`    Longueur       : ${e.longueurMm ? e.longueurMm + ' mm' : '0 (rouleau continu)'}`);
  console.log(`    Type (code)    : 0x${e.typeSupport.toString(16)} — ${e.typeCle}`);
  console.log(`    Points imprim. : ${e.pointsImprimables || 'inconnu pour cette largeur'}`);
  console.log('');
  if (e.erreurs.length) {
    console.log('    ERREURS EN COURS :');
    e.erreurs.forEach(x => console.log('      - ' + x));
  } else {
    console.log('    Aucune erreur signalee : l\'imprimante est prete.');
  }
  console.log('');
  console.log('  Octets bruts (a recopier en cas de probleme) :');
  console.log('    ' + e.brut.map(o => o.toString(16).padStart(2, '0')).join(' '));
  console.log('');
})().catch(e => {
  console.error('  Erreur du diagnostic : ' + e.message);
});
