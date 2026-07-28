@echo off
chcp 65001 >nul
title Diagnostic de l'imprimante
cd /d "%~dp0"
node diagnostic.js
echo.
pause
