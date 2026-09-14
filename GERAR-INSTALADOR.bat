@echo off
chcp 65001 >nul
title Gerar instalador - ClickUp Timer
cd /d "%~dp0"

echo.
echo  ==================================================
echo    ClickUp Timer - gerador do instalador do Windows
echo  ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js nao encontrado neste computador.
  echo      Instale em https://nodejs.org e clique neste arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\\" (
  echo  [1/2] Instalando dependencias ^(so na primeira vez, alguns minutos^)...
  echo.
  call npm install
  if errorlevel 1 goto erro
) else (
  echo  [1/2] Dependencias ja instaladas.
)

echo.
echo  [2/2] Gerando o instalador... pode levar uns 2 minutos.
echo.
call npx electron-builder --win nsis
if errorlevel 1 goto erro

echo.
echo  ==================================================
echo    Pronto!
echo.
echo    Abra a pasta dist e execute:
echo    ClickUp-Timer-Setup-1.0.0.exe
echo.
echo    Ele instala, cria o atalho e ja abre o app.
echo  ==================================================
echo.
start "" "%cd%\\dist"
pause
exit /b 0

:erro
echo.
echo  [X] Algo deu errado. Copie a mensagem acima e mande para o Claude.
echo.
pause
exit /b 1
