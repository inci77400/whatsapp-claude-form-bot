#!/bin/bash
# Facebook form erişim anahtarını bota ekler (anahtar sadece bu bilgisayarda .env dosyasında durur)
cd "$(dirname "$0")"
[ -x .node/bin/node ] && export PATH="$PWD/.node/bin:$PATH"
clear
echo "=== Facebook formlarını bota bağla ==="
echo "Graph API Explorer'dan kopyaladığınız erişim anahtarını yapıştırıp Enter'a basın:"
read -r TOKEN
TOKEN=$(echo "$TOKEN" | tr -d '[:space:]')
[ -z "$TOKEN" ] && { echo "Anahtar girilmedi."; read -p "Kapatmak için Enter"; exit 1; }

echo "Anahtar kontrol ediliyor ve kalıcı sayfa anahtarına çevriliyor..."
SONUC=$(node -e '
const t = process.argv[1];
const g = (u) => fetch("https://graph.facebook.com/v21.0" + u + (u.includes("?") ? "&" : "?") + "access_token=" + t).then((r) => r.json());
(async () => {
  const sayfalar = await g("/me/accounts?fields=id,name,access_token&limit=100");
  if (sayfalar.error) {
    const ben = await g("/me?fields=id,name");          // zaten bir sayfa anahtarı olabilir
    if (ben.error) { console.log("HATA " + ben.error.message); return; }
    console.log("OK " + ben.id + " " + t + " " + ben.name); return;
  }
  const s = (sayfalar.data || [])[0];
  if (!s) { console.log("HATA Bu hesapta yönetilen sayfa bulunamadı"); return; }
  console.log("OK " + s.id + " " + s.access_token + " " + s.name);
})().catch((e) => console.log("HATA " + e.message));
' "$TOKEN")
case "$SONUC" in
  OK*)
    SAYFA_ID=$(echo "$SONUC" | cut -d' ' -f2); SAYFA_TOKEN=$(echo "$SONUC" | cut -d' ' -f3); SAYFA_AD=$(echo "$SONUC" | cut -d' ' -f4-)
    grep -v '^META_ERISIM_TOKENI=\|^META_SAYFA_ID=' .env > .env.tmp; mv .env.tmp .env
    printf 'META_ERISIM_TOKENI=%s\nMETA_SAYFA_ID=%s\n' "$SAYFA_TOKEN" "$SAYFA_ID" >> .env
    echo ""
    echo "✅ Bağlandı: $SAYFA_AD"
    echo "Botu yeniden başlatınca formlar çekilmeye başlar (2 saatte bir + paneldeki düğme)."
    ;;
  *) echo ""; echo "❌ ${SONUC#HATA }"; echo "Anahtarı ve izinleri kontrol edip tekrar deneyin." ;;
esac
read -p "Kapatmak için Enter"
