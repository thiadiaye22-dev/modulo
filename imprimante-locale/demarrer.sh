#!/bin/sh
# Serveur d'impression des étiquettes DLC.
# Sans adresse, l'imprimante est recherchée automatiquement sur le réseau.
# Pour en imposer une : ./demarrer.sh --imprimante 192.168.1.46

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installé."
  echo "  Rendez-vous sur https://nodejs.org, installez la version LTS,"
  echo "  puis relancez ce script."
  echo ""
  exit 1
fi

exec node serveur.js "$@"
