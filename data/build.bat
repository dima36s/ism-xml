@echo off
rem Validate ISM XML against XSD and build HTML views (see build.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
pause
