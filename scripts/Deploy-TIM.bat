@echo off
title Deploy TIM to the iPads
rem ---------------------------------------------------------------------
rem  Double-click AFTER your Merge Request has merged into GitLab main.
rem
rem  This fast-forwards the GitHub copy, which is what GitHub Pages serves
rem  to the warehouse iPads. It IS the deploy.
rem
rem  NOT YET IN SERVICE (2026-10-13): until a Developer token and project
rem  membership land, GitHub main is still canonical - deploy the ordinary
rem  way with:  git push origin main
rem
rem  Dry run (shows what would ship, pushes nothing):
rem      "Deploy-TIM.bat" -WhatIf
rem ---------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-to-pages.ps1" %*
echo.
if errorlevel 1 (
  echo *** Deploy did NOT finish - read the messages above. Nothing shipped. ***
) else (
  echo Done.
)
echo.
pause
