#!/bin/bash
# Botun cevaplarını WhatsApp'a hiçbir şey göndermeden dener.
cd "$(dirname "$0")"
[ -x .node/bin/node ] && export PATH="$PWD/.node/bin:$PATH"
clear
echo "=== BOT TEST (WhatsApp'a hiçbir şey gitmez) ==="
echo "Bot önce formu yeni dolduran bir müşteriye yazar gibi ilk mesajı atar."
echo "Siz müşteri gibi cevap yazıp Enter'a basın. Çıkmak için: q"
echo ""
node src/test-sohbet.js
