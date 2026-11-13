#!/bin/bash
# Botu Mac'in arka plan servisi yapar: Mac açılınca kendiliğinden başlar, çökerse yeniden açılır.
# macOS, arka plan servislerinin Belgeler/Masaüstü/İndirilenler klasörlerine erişmesine izin vermez.
# Bu yüzden bot ~/WhatsAppBot klasörüne kopyalanır ve oradan çalışır.
KAYNAK="$(cd "$(dirname "$0")" && pwd)"
HEDEF="$HOME/WhatsAppBot"
ETIKET="com.whatsappbot.formbot"
PLIST="$HOME/Library/LaunchAgents/$ETIKET.plist"
clear
echo "=== WhatsApp botu arka plan servisi kuruluyor ==="

# 1) Çalışan botları kapat (Terminal'deki ve eski servis)
launchctl bootout "gui/$(id -u)/$ETIKET" 2>/dev/null
pkill -f "baslat-mac.command" 2>/dev/null
pkill -f "node src/index.js" 2>/dev/null
sleep 4

# 2) Dosyaları kopyala
if [ "$KAYNAK" != "$HEDEF" ]; then
  mkdir -p "$HEDEF"
  if [ -f "$HEDEF/veri/durum.json" ]; then
    echo "→ Kod güncelleniyor (veriler korunuyor)..."
    rsync -a --exclude veri --exclude .env "$KAYNAK/" "$HEDEF/"
  else
    echo "→ Bot ve tüm verileri $HEDEF klasörüne kopyalanıyor (WhatsApp oturumu dahil)..."
    rsync -a "$KAYNAK/" "$HEDEF/"
  fi
fi
chmod +x "$HEDEF/servis-calistir.sh" "$HEDEF"/*.command 2>/dev/null

# 3) Servisi tanımla
mkdir -p "$HOME/Library/LaunchAgents" "$HEDEF/veri"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ETIKET</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HEDEF/servis-calistir.sh</string></array>
  <key>WorkingDirectory</key><string>$HEDEF</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$HEDEF/veri/bot.log</string>
  <key>StandardErrorPath</key><string>$HEDEF/veri/bot.log</string>
</dict></plist>
PL

# 5) Spotlight (Cmd+Space) ile açılabilen "WhatsApp Bot" uygulaması
APP="$HOME/Applications/WhatsApp Bot.app/Contents"
mkdir -p "$APP/MacOS" "$APP/Resources"
cp "$HEDEF/node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns" "$APP/Resources/AppIcon.icns" 2>/dev/null
cat > "$APP/Info.plist" <<IP
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>WhatsApp Bot</string>
  <key>CFBundleIdentifier</key><string>com.whatsappbot.panel</string>
  <key>CFBundleExecutable</key><string>WhatsAppBot</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
IP
cat > "$APP/MacOS/WhatsAppBot" <<'SH'
#!/bin/bash
# Botun kontrol panelini açar; servis kapalıysa önce başlatır.
cd "$HOME/WhatsAppBot" || exit 1
[ -x .node/bin/node ] && export PATH="$PWD/.node/bin:$PATH"
ETIKET="com.whatsappbot.formbot"
if ! curl -s -m 2 http://127.0.0.1:3001/api/durum >/dev/null; then
  launchctl kickstart "gui/$(id -u)/$ETIKET" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$ETIKET.plist"
  for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:3001/api/durum >/dev/null && break; sleep 1; done
fi
node -e "import('./src/panel.js').then(m=>m.pencereAc('http://localhost:3001'))"
sleep 2
SH
chmod +x "$APP/MacOS/WhatsAppBot"

# 4) Başlat
launchctl bootstrap "gui/$(id -u)" "$PLIST" && launchctl kickstart -k "gui/$(id -u)/$ETIKET"
sleep 8
if pgrep -f "node src/index.js" >/dev/null; then
  echo ""
  echo "✅ Servis kuruldu ve çalışıyor."
  echo "   • Botun yeni yeri: $HEDEF  (ayarlar, prompt ve veriler artık orada)"
  echo "   • Mac açılınca bot kendiliğinden başlar, çökerse yeniden açılır."
  echo "   • Panel: $HEDEF/Paneli Ac.command   • Kayıtlar: $HEDEF/veri/bot.log"
  echo "   • Paneli açmak için: Cmd+Space → \"WhatsApp Bot\""
  echo "   • Durdurmak için: 'Servis Durdur.command'"
  open "$HEDEF"
else
  echo "❌ Bot başlamadı. Son kayıtlar:"; tail -20 "$HEDEF/veri/bot.log"
fi
read -p "Kapatmak için Enter"
