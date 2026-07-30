@echo off
chcp 65001 >nul
title ANCIEN OUTIL - ne sert plus
cd /d "%~dp0.."

echo.
echo   ==============================================================
echo     CET OUTIL NE SERT PLUS A RIEN
echo   ==============================================================
echo.
echo   Il interroge l'imprimante sur le port 9100 pour lire le
echo   rouleau charge. Votre QL-820NWBc ne repond jamais a cette
echo   demande : le diagnostic affichera "lecture impossible",
echo   comme les fois precedentes.
echo.
echo   ==============================================================
echo     LE FICHIER A LANCER, C'EST :
echo.
echo       1-VERIFIER-IMPRIMANTE.bat
echo.
echo     Il se trouve dans le dossier juste AU-DESSUS de celui-ci.
echo   ==============================================================
echo.
echo   (Pour executer le diagnostic malgre tout :
echo    node outils-anciens\diagnostic.js)
echo.
pause
exit /b 0
