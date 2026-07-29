@echo off
chcp 65001 >nul
title Verification de l'installation
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe, ou l'ordinateur n'a pas ete
  echo   redemarre depuis son installation.
  echo   Rendez-vous sur https://nodejs.org, version LTS.
  echo.
  pause
  exit /b 1
)

node verifier.js %*
echo.
pause
