# 🍽️ Mon Planning Resto

Application web (PWA) de gestion d'équipe pour restaurant : planning hebdomadaire,
pointage avec géolocalisation, congés avec validation, créneaux de dernière minute,
notifications push et récap paie mensuel exportable.

## Fonctionnalités

- **Planning** : grille semaine par employé, horaires types en 1 clic, copier/coller,
  duplication de la semaine précédente, impression, coût estimé de la semaine (gérant).
- **Pointage** : arrivée/départ en un clic, services après minuit gérés, correction
  manuelle par le gérant, alerte si le pointage est loin du restaurant (géolocalisation).
- **Congés** : demandes par les employés, validation/refus par le gérant,
  affichage automatique dans le planning.
- **Créneaux de dernière minute** : le gérant propose un créneau, notification push
  à toute l'équipe, premier arrivé premier servi (refusé si l'employé est en congé ce jour-là).
- **Récap paie** : heures planning vs heures pointées, heures sup par semaine,
  jours d'absence par type (approuvées uniquement), export CSV pour le comptable.
- **Notifications push** : planning modifié, demande de congé, rappel de pointage
  15 min avant le service.
- **Multi-restaurant** : chaque compte gérant a ses propres données, isolées.

## Rôles

| | Gérant | Employé |
|---|---|---|
| Planning | modification | lecture seule (sans les taux horaires des collègues) |
| Pointage | tous les employés + correction | le sien uniquement |
| Congés | pose directe + validation | demandes personnelles |
| Équipe / Récap paie | oui | non |

## Démarrer en local

```bash
npm install
npm start          # http://localhost:3000
```

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `JWT_SECRET` | valeur de dev | **Obligatoire en production** – secret des sessions |
| `DATA_DIR` | `./data` | Dossier des données (à pointer vers un disque persistant) |
| `VAPID_CONTACT` | `mailto:contact@example.com` | Email de contact pour les notifications push |
| `NODE_ENV` | – | `production` active les cookies `secure` |

## Déploiement (Render)

Le fichier `render.yaml` déploie l'app telle quelle. **Attention : sur le plan
gratuit de Render, le disque est éphémère** – toutes les données (comptes,
plannings, pointages) sont perdues à chaque déploiement ou redémarrage.
Pour un usage réel :

1. Passer au plan `starter` et monter un disque persistant (voir les commentaires
   dans `render.yaml`), avec `DATA_DIR=/var/data` ;
2. ou migrer le stockage vers une base gérée (Postgres, Supabase…).

## Sécurité

- Mots de passe hachés (bcrypt), sessions JWT en cookie `httpOnly` + `secure` en production.
- Révocation d'un compte effective immédiatement (le compte est revérifié à chaque requête).
- Limitation des tentatives de connexion (anti brute-force), mot de passe de 6 caractères minimum.
- Les employés ne reçoivent jamais les taux horaires, heures contrat, ni les motifs/types
  d'absence de leurs collègues.
- Validation des entrées côté serveur (dates, heures, longueurs de texte).

## Structure

```
server/
  index.js      # API Express (auth, planning, pointage, congés, créneaux, push)
  auth.js       # bcrypt + JWT en cookie, middlewares requireAuth / requireManager
  store.js      # persistance JSON (users.json + un fichier par restaurant)
  push.js       # clés VAPID + envoi des notifications web-push
  reminders.js  # rappel de pointage 15 min avant le service
public/
  app.html/js   # application (onglets planning, pointage, équipe, congés, paie)
  login.html / signup.html
  sw.js         # service worker (réseau d'abord, cache de secours hors ligne)
```

> ⚠️ Le récap paie est une **aide à la préparation** : les montants exacts
> (convention HCR, majorations d'heures sup, jours fériés…) restent à valider
> avec un comptable.
