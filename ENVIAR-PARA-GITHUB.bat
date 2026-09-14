@echo off
chcp 65001 >nul
title Enviar para o GitHub - ClickUp Timer
cd /d "%~dp0"

echo.
echo  ==================================================
echo    Enviando para github.com/oFerrari/timer-clickup
echo  ==================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  [X] Git nao encontrado. Instale em https://git-scm.com
  echo.
  pause
  exit /b 1
)

git status --short
echo.

for /f %%i in ('git status --porcelain') do goto pendentes
goto push

:pendentes
echo  Existem alteracoes ainda nao commitadas acima.
choice /c SN /m "Incluir tudo em um commit agora"
if errorlevel 2 goto push
git add -A
set /p MSG="  Mensagem do commit: "
git commit -m "%MSG%"
echo.

:push
echo  Enviando...
echo.
git push origin main
if errorlevel 1 goto erro

echo.
echo  Pronto. Veja em https://github.com/oFerrari/timer-clickup
echo.
pause
exit /b 0

:erro
echo.
echo  [X] O push falhou. Se pediu login e voce fechou a janela,
echo      rode de novo e faca o login do GitHub que aparecer.
echo.
pause
exit /b 1
