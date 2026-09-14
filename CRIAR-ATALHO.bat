@echo off
chcp 65001 >nul
title Criar atalho - ClickUp Timer
cd /d "%~dp0"

set "DIR=%cd%\dist\win-unpacked"
set "EXE=%DIR%\ClickUp Timer.exe"
set "ICO=%cd%\icon.ico"

if not exist "%EXE%" (
  echo.
  echo  [X] Nao encontrei o ClickUp Timer.exe em dist\win-unpacked.
  echo      Rode o GERAR-INSTALADOR.bat antes.
  echo.
  pause
  exit /b 1
)

echo.
echo  Criando atalho com o icone certo...

del /q "%USERPROFILE%\Desktop\ClickUp Timer.exe - Atalho.lnk" >nul 2>&1
del /q "%USERPROFILE%\OneDrive\Desktop\ClickUp Timer.exe - Atalho.lnk" >nul 2>&1

powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\ClickUp Timer.lnk'); $s.TargetPath='%EXE%'; $s.WorkingDirectory='%DIR%'; $s.IconLocation='%ICO%,0'; $s.Description='Timer do ClickUp'; $s.Save(); Write-Host '  Atalho criado na area de trabalho.'"
if errorlevel 1 goto erro

echo.
echo  Se o icone ainda aparecer errado no Explorer, o cache do Windows
echo  esta velho. Posso limpar agora (a barra de tarefas pisca 1 segundo).
echo.
choice /c SN /m "Limpar o cache de icones"
if errorlevel 2 goto fim

echo.
echo  Limpando...
ie4uinit.exe -show >nul 2>&1
taskkill /f /im explorer.exe >nul 2>&1
del /a /q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache*" >nul 2>&1
del /a /q "%LOCALAPPDATA%\IconCache.db" >nul 2>&1
start explorer.exe

:fim
echo.
echo  Pronto. Se quiser, arraste o atalho para a barra de tarefas.
echo.
pause
exit /b 0

:erro
echo.
echo  [X] Nao consegui criar o atalho.
echo.
pause
exit /b 1
