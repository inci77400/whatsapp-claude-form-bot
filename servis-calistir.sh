#!/bin/bash
# launchd (macOS arka plan servisi) tarafından çalıştırılır. Elle çalıştırmanıza gerek yok.
cd "$(dirname "$0")"
[ -x .node/bin/node ] && export PATH="$PWD/.node/bin:$PATH"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] && export PUPPETEER_SKIP_DOWNLOAD=1 CHROME_YOLU="$CHROME"
# Bot çalıştığı sürece Mac uyumasın (şarjdayken). Bot kapanınca caffeinate de kapanır.
caffeinate -i -s -w $$ &
exec node src/index.js
