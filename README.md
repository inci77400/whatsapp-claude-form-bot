# WhatsApp Form Botu (Claude ile)

Form dolduran potansiyel müşterilerinizle **WhatsApp'ta sizin üslubunuzla yazışan**, kendi bilgisayarınızda çalışan bir bot. Cevapları [Claude](https://www.anthropic.com/claude) yazar. Temel amacı müşterinin sorularını cevaplamak ve **telefon görüşmesi için uygun gün ve saatini almak**. Randevu alındığında size bildirim gelir.

> 🇬🇧 *English summary at the bottom.*

## Özellikler

- 🤖 **Claude ile doğal yazışma.** Kurallar, üslup ve iş bilgileri tek bir metin dosyasında durur (`prompt/sistem.md`). Dosyayı kaydettiğiniz anda geçerli olur.
- 🎯 **Yalnızca form müşterileriyle konuşur.** Arkadaş, aile ve mevcut müşteri sohbetlerine dokunmaz.
- 📋 **Form müşterisi bulmanın 4 yolu:**
  - CSV listesi
  - Google Form tablosu
  - **Facebook/Instagram Lead Ads**: 2 saatte bir otomatik çekim, istenirse elle
  - "Formunuzu doldurdum…" cümlesiyle başlayan WhatsApp mesajları
- ✋ **Kontrol sizde.** Bir müşteriye elle yazdığınız anda bot o sohbette durur. Pazarlık, ödeme, şikayet ya da "bot musun" gibi durumlarda bot susar ve konuşmayı size devreder.
- 🖼️ **Fotoğraflı ilk mesaj.** Kendi tanıtım metniniz ve görseliniz ilk mesaj olarak gider. Toplu gönderimde mesajlar aralıklı sıraya alınır.
- 🖥️ **Masaüstü kontrol paneli** (Electron) sunar:
  - WhatsApp tarzı sohbet görünümü
  - Müşteri bazında botu durdurma/açma
  - Elle mesaj gönderme
  - Sohbet tarama ve Facebook formlarını çekme düğmeleri
  - Bildirimler
- 🔁 **Arka plan servisi (macOS).** Mac açılınca bot kendiliğinden başlar, çökerse yeniden açılır.
- 🕘 Çalışma saatleri, günlük mesaj limiti ve "yazıyor…" gecikmesi gibi insan benzeri davranış ayarları vardır.
- 🧪 **Test modu.** WhatsApp'a bağlanmadan terminalde müşteri gibi yazışıp cevapları deneyebilirsiniz.

## ⚠️ Kullanmadan önce okuyun

- Bot, **resmi olmayan** [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) kütüphanesiyle WhatsApp Web üzerinden çalışır. Resmi WhatsApp Business API değildir. WhatsApp otomasyon kullanan hesapları kısıtlayabilir veya kapatabilir. **Risk size aittir.** Toplu mesaj ya da reklam için kullanmayın.
- Yalnızca sizinle iletişime geçmeyi kabul etmiş (formu doldurmuş) kişilere yazın. KVKK/GDPR gibi veri koruma yükümlülükleriniz size aittir. Müşteri verileri yalnızca bilgisayarınızda (`veri/`) tutulur. Mesaj içerikleri cevap üretmek için Anthropic API'sine gönderilir.
- Örnek prompt, "bot musun / yapay zekâ mısın" sorusunda botun **yalan söylememesini** ve konuşmayı size devretmesini ister. Bu kuralı korumanızı öneririz.
- Claude API kullanımı ücretlidir: https://console.anthropic.com

## Kurulum

### Gereksinimler
- macOS veya Windows
- Google Chrome (önerilir; yoksa otomatik indirilir)
- [Anthropic API anahtarı](https://console.anthropic.com) (hesaba kredi yüklenmiş olmalı)
- Node.js 18+. Mac'te betik gerekirse kendisi indirir; Windows'ta [nodejs.org](https://nodejs.org) adresinden kurun.

### Adımlar

```bash
git clone https://github.com/inci77400/whatsapp-claude-form-bot.git
cd whatsapp-claude-form-bot
```

- **Mac:** `baslat-mac.command` dosyasına sağ tıklayıp **Aç**'ı seçin. Bağımlılıklar kurulur, API anahtarınız sorulur ve bot başlar.
- **Windows:** `baslat-windows.bat` dosyasına çift tıklayın. Açılan `.env` dosyasına `ANTHROPIC_API_KEY` değerini yazın ve tekrar çalıştırın.

Ekranda çıkan **QR kodu** telefonunuzdan okutun: WhatsApp → Ayarlar → **Bağlı cihazlar** → Cihaz bağla. Sonraki açılışlarda QR gerekmez.

### Sürekli çalışması için (Mac)

Önce botu bir kez `baslat-mac.command` ile başlatıp QR'ı okutun, sonra **`Servis Kur.command`** dosyasını çalıştırın:
- Bot `~/WhatsAppBot` klasörüne kopyalanır. macOS, arka plan servislerinin Belgeler, Masaüstü ve İndirilenler klasörlerine erişmesine izin vermediği için bu gerekir.
- Bot bir LaunchAgent olarak kurulur. Terminal penceresi gerekmez, Mac açılınca bot kendiliğinden başlar, çökerse yeniden açılır.
- WhatsApp oturumu ve veriler taşınır, QR yeniden istenmez.
- **Cmd+Space → "WhatsApp Bot"** yazınca kontrol paneli açılır (servis kapalıysa önce başlatır). Uygulama `~/Applications` içine kurulur.
- Kayıtlar `~/WhatsAppBot/veri/bot.log` dosyasına yazılır. Servisi durdurmak için `Servis Durdur.command` dosyasını çalıştırın.

## Yapılandırma

### 1. Botun kişiliği: `prompt/sistem.md`
İlk çalıştırmada `prompt/sistem.ornek.md` dosyasından kopyalanır. Köşeli parantezli `[ALANLARI]` kendi işletmenizin bilgileriyle doldurun: hizmet, fiyat, sık sorulan sorular, üslup ve hangi durumlarda size devredeceği. Bot uydurmaz, sadece bu dosyadaki bilgileri kullanır.

### 2. İlk mesaj şablonu (isteğe bağlı)
- `veri/ilk-mesaj.txt`: ilk mesaj metni (örnek: `ornek/ilk-mesaj.ornek.txt`)
- `veri/ilk-mesaj.jpg` (veya png/webp): metinle birlikte giden görsel

Bu dosyalar yoksa ilk mesajı Claude yazar.

### 3. Müşteri listesi
| Kaynak | Nasıl |
|---|---|
| CSV | `veri/musteriler.csv` dosyasını kullanın (örnek: `ornek/musteriler.ornek.csv`). Bir **telefon** sütunu yeterlidir; diğer sütunlar form cevabı olarak bota iletilir. |
| Google Form | Cevap tablosunu **Dosya → Paylaş → Web'de yayınla → CSV** ile yayınlayın ve linki `.env` içinde `GOOGLE_SHEET_CSV_URL` alanına yazın. |
| Facebook / Instagram Lead Ads | Aşağıdaki "Facebook bağlantısı" bölümüne bakın. |
| WhatsApp mesajı | `FORM_MESAJI` ile başlayan mesajlar otomatik olarak form müşterisi sayılır. |

Telefon numaraları her biçimde kabul edilir (`0532…`, `+90 532…`). Türkiye numaraları otomatik düzeltilir.

### 4. Facebook bağlantısı (Lead Ads)
1. [developers.facebook.com](https://developers.facebook.com) adresinde bir uygulama oluşturun (tür: İşletme).
2. [Graph API Explorer](https://developers.facebook.com/tools/explorer) aracında uygulamanızı seçin ve şu izinlerle bir kullanıcı erişim anahtarı alın: `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `leads_retrieval`, `business_management`.
3. [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken) ile anahtarı **genişletin** (uzun ömürlü yapın).
4. `Facebook Bagla.command` dosyasını çalıştırıp anahtarı yapıştırın. Betik anahtarı süresiz bir **sayfa anahtarına** çevirir ve `.env` dosyasına yazar.

Bot bundan sonra 2 saatte bir son 30 günün başvurularını çeker. Panelde **📋 Facebook formlarını çek** düğmesi de vardır.

### 5. `.env` ayarları
Tüm seçenekler açıklamalarıyla birlikte `.env.example` dosyasında. Önemli olanlar:

| Ayar | Açıklama |
|---|---|
| `ILK_MESAJ_GONDER` | `hayir` (önerilen) seçilirse ilk mesajlar ancak panelden **İlk mesajları başlat** dendiğinde gider. `evet` seçilirse yeni başvurulara bot kendiliğinden yazar. |
| `ILK_MESAJ_ARALIK_SN` | Toplu ilk mesajlar arasındaki süre (varsayılan 240 sn). Spam algılanmasını önler. |
| `CALISMA_SAATLERI` | Örneğin `09:00-23:00` veya gece yarısını aşan `09:00-05:00`. Bu saatler dışında gelen mesajlar sıraya alınır. |
| `GUNLUK_LIMIT` | Bir müşteriye günde en fazla kaç bot mesajı gidebileceği. |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` (hızlı, uygun maliyetli) veya `claude-opus-5-5`. |

## Kullanım

- **Panel:** Bot açılınca panel penceresi de açılır. Sonradan açmak için `Paneli Ac.command` dosyasını çalıştırın. Panel adresi `http://localhost:3001`.
- **Sohbetleri tara:** Son 14 günün sohbetlerini tarar. Sizin zaten yazıştığınız kişilerde botu durdurur, cevapsız kalmış form müşterilerine cevap verir.
- **Bildirimler:** Devirler, alınan arama saatleri ve cevaplanamayan sorular masaüstü bildirimi olarak gelir ve `veri/bildirimler.txt` dosyasına yazılır.
- **WhatsApp komutları** kendi numaranızla olan sohbete ("Kendime not") yazılır:

| Komut | Ne yapar |
|---|---|
| `#bot durum` | Müşteri özetini gösterir |
| `#bot dur 905xx…` | O müşteride botu durdurur |
| `#bot devam 905xx…` | O müşteride botu yeniden başlatır |
| `#bot yenile` | Müşteri listesini yeniler |
| `#bot ilkmesaj` | Bekleyen ilk mesajları başlatır |

### Test (WhatsApp olmadan)
```bash
npm run test-sohbet      # Mac'te: "Bot Test.command"
```
Terminalde müşteri gibi yazarsınız. Botun cevabı, durumu ve size düşeceği notlar ekranda görünür. WhatsApp'a hiçbir şey gitmez.

## Klasör yapısı
```
src/            bot (index.js), Claude çağrısı, panel sunucusu, Meta Lead Ads, depolama
panel/          masaüstü panel arayüzü (Electron + HTML)
prompt/         sistem.ornek.md → sistem.md (botun kuralları)
ornek/          örnek CSV ve ilk mesaj metni
veri/           (git'e girmez) müşteriler, konuşmalar, WhatsApp oturumu, loglar
```
`veri/`, `.env` ve `prompt/sistem.md` `.gitignore` içindedir. **Bunları asla paylaşmayın.**

## Lisans
MIT

---

## 🇬🇧 English summary

A local WhatsApp bot (Node.js + [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)) that chats with leads who filled in your form, using Claude to write replies in your own tone. Its goal is to answer questions and book a phone call.

**How it works**
- **Lead sources:** CSV, a published Google Sheet, Facebook/Instagram Lead Ads (Graph API, polled every 2 h), or WhatsApp messages that start with the standard "I filled in your form" text.
- **Handover:** the bot stops in a chat as soon as you reply manually there. It also hands over on negotiation, payment, complaints or "are you a bot?".
- **Interface:** an Electron desktop panel to monitor chats, pause or resume the bot per contact, and send messages.
- **macOS service:** an optional LaunchAgent keeps the bot running in the background.

**Setup**
1. Run `baslat-mac.command` (macOS) or `baslat-windows.bat` (Windows).
2. Enter your Anthropic API key.
3. Scan the QR code.
4. Customize `prompt/sistem.md` (UI and prompts are in Turkish; translate the prompt to change the bot's language).

**Disclaimer:** unofficial WhatsApp automation can get your number restricted. Use it only with people who opted in. Never use it for bulk messaging. Use at your own risk.
