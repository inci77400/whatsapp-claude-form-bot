@echo off
cd /d "%~dp0"
chcp 65001 >nul
if not exist node_modules (
  echo Ilk kurulum yapiliyor, birkac dakika surebilir...
  call npm install
)
if not exist prompt\sistem.md copy prompt\sistem.ornek.md prompt\sistem.md >nul
if not exist .env (
  copy .env.example .env >nul
  echo .env dosyasi olusturuldu. Icine ANTHROPIC_API_KEY yazip tekrar calistirin.
  notepad .env
  pause
  exit /b
)
:dongu
node src/index.js
echo Bot kapandi, 10 saniye sonra yeniden baslatiliyor... (Kapatmak icin pencereyi kapatin)
timeout /t 10 >nul
goto dongu
