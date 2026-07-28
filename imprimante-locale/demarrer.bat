@echo off
chcp 65001 >nul
title Serveur d'impression des etiquettes DLC
cd /d "%~dp0"

echo.
echo   Demarrage du serveur d'impression...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   ============================================================
  echo     NODE.JS N'EST PAS INSTALLE, ou l'ordinateur n'a pas
  echo     ete redemarre depuis son installation.
  echo   ============================================================
  echo.
  echo   1. Rendez-vous sur https://nodejs.org
  echo   2. Telechargez la version "LTS" et installez-la
  echo   3. REDEMARREZ l'ordinateur
  echo   4. Double-cliquez a nouveau sur ce fichier
  echo.
  pause
  exit /b 1
)

if not exist "serveur.js" (
  echo   Fichier serveur.js introuvable.
  echo   Ce raccourci doit rester dans le dossier "imprimante-locale".
  echo.
  pause
  exit /b 1
)

REM Sans adresse, le serveur cherche l'imprimante tout seul sur le reseau.
REM Pour imposer une adresse, remplacez la ligne ci-dessous par :
REM     node serveur.js --imprimante 192.168.1.46
node serveur.js

echo.
echo   Le serveur s'est arrete.
pause
