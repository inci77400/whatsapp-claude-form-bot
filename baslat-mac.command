#!/bin/bash
# WhatsApp Form Botu — Mac kurulum + başlatma (yönetici şifresi gerektirmez)
cd "$(dirname "$0")"
clear
echo "=== WhatsApp Müşteri Botu ==="

# 1) Node.js (yoksa proje klasörüne indir)
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then
  echo "Node.js bulundu: $(node -v)"
else
  if [ ! -x .node/bin/node ]; then
    echo "Node.js indiriliyor (tek seferlik)..."
    ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=x64
    BASE=https://nodejs.org/dist/latest-v22.x
    FILE=$(curl -fsSL $BASE/SHASUMS256.txt | grep -o "node-v[0-9.]*-darwin-$ARCH.tar.gz" | head -1)
    mkdir -p .node && curl -fL# "$BASE/$FILE" | tar -xz -C .node --strip-components=1 || { echo "Node indirilemedi, internet bağlantısını kontrol edin."; read -p "Kapatmak için Enter"; exit 1; }
  fi
  export PATH="$PWD/.node/bin:$PATH"
  echo "Node.js hazır: $(node -v)"
fi

# 2) Chrome varsa onu kullan (ayrı Chrome indirmeye gerek yok)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then export PUPPETEER_SKIP_DOWNLOAD=1; export CHROME_YOLU="$CHROME"; fi

# 3) Paketler
if [ ! -d node_modules/whatsapp-web.js ]; then
  echo "Paketler kuruluyor (1-3 dk)..."
  npm install --no-audit --no-fund || { read -p "Kurulum hatası. Kapatmak için Enter"; exit 1; }
fi

# 3b) Panel penceresi (masaüstü uygulaması)
if [ ! -d node_modules/electron/dist ]; then
  echo "Panel uygulaması kuruluyor (tek seferlik, 1-2 dk)..."
  npm install --no-audit --no-fund electron@38 || echo "Panel uygulaması kurulamadı, panel tarayıcıda açılacak."
fi

# 4) .env, prompt ve API anahtarı
[ -f .env ] || cp .env.example .env
[ -f prompt/sistem.md ] || cp prompt/sistem.ornek.md prompt/sistem.md
if grep -q '^ANTHROPIC_API_KEY=sk-ant-\.\.\.' .env || ! grep -q '^ANTHROPIC_API_KEY=sk-ant-' .env; then
  echo ""
  echo "Claude API anahtarınızı yapıştırıp Enter'a basın (sk-ant- ile başlar):"
  read -r KEY
  KEY=$(echo "$KEY" | tr -d '[:space:]')
  /usr/bin/sed -i '' "s#^ANTHROPIC_API_KEY=.*#ANTHROPIC_API_KEY=$KEY#" .env
fi

# 5) Çalıştır (Mac uyumasın diye caffeinate; çökerse yeniden başlar)
echo ""
echo "Bot başlatılıyor. Bu pencere açık kaldığı sürece bot çalışır."
echo "Kontrol paneli: http://localhost:3001"
caffeinate -i -w $$ &   # bu pencere açık kaldıkça Mac uyumasın
trap 'kill $BOT_PID 2>/dev/null; exit 0' HUP INT TERM
while true; do
  node src/index.js &
  BOT_PID=$!
  wait $BOT_PID
  export PANEL_ACMA=1  # yeniden başlarken paneli tekrar açma
  echo "Bot kapandı, 10 sn sonra yeniden başlıyor (tamamen kapatmak için bu pencereyi kapatın)"
  sleep 10
done
