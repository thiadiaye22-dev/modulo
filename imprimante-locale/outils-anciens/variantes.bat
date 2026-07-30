@echo off
chcp 65001 >nul
title ANCIEN OUTIL - ne sert plus
cd /d "%~dp0.."

echo.
echo   ==============================================================
echo     CET OUTIL NE SERT PLUS A RIEN
echo   ==============================================================
echo.
echo   Il essaie cinq formats d'impression de l'ANCIENNE methode
echo   (envoi direct sur le port 9100). Les cinq ont deja ete
echo   essayes sur votre imprimante : aucun n'imprime.
echo.
echo   ==============================================================
echo     LE FICHIER A LANCER, C'EST :
echo.
echo       1-VERIFIER-IMPRIMANTE.bat
echo.
echo     Il se trouve dans le dossier juste AU-DESSUS de celui-ci.
echo   ==============================================================
echo.
echo   (Pour executer les variantes malgre tout :
echo    node outils-anciens\variantes.js)
echo.
pause
exit /b 0
