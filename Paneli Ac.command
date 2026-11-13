#!/bin/bash
# Kapattığınız kontrol paneli penceresini tekrar açar (bot çalışıyor olmalı)
cd "$(dirname "$0")"
[ -x .node/bin/node ] && export PATH="$PWD/.node/bin:$PATH"
node -e "import('./src/panel.js').then(m=>m.pencereAc('http://localhost:3001'))"
sleep 2
