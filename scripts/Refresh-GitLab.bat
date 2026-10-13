@echo off
title Refresh GitLab copy of TIM
rem ---------------------------------------------------------------------
rem  Double-click this to push the latest GitHub commits across to the
rem  GitLab copy of TIM (gitlab.hctc.coop/jherring/tim).
rem
rem  Run it AFTER you have pushed to GitHub. GitHub stays the source of
rem  truth and the deploy path; this just stops the GitLab copy going stale.
rem
rem  Any arguments are passed through, so you can also run:
rem      "Refresh GitLab.bat" -WhatIf      (dry run, pushes nothing)
rem ---------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gitlab-refresh.ps1" %*
echo.
if errorlevel 1 (
  echo *** The refresh did NOT finish cleanly - read the messages above. ***
) else (
  echo Done.
)
echo.
pause
