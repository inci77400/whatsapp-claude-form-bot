// WhatsApp form müşteri botu — Claude ile yerelde çalışır
// Sadece formu doldurmuş (müşteri listesindeki) kişilere Claude ile cevap verir.
import 'dotenv/config';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';
import { musterileriYukle, telefonNormalize } from './musteriler.js';
import { Depo } from './depo.js';
import { ClaudeCevaplayici } from './claude.js';
import { metaFormlariniCek } from './meta.js';

const { Client, LocalAuth, MessageMedia } = wweb;

// ---------- İlk mesaj şablonu (sizin metniniz + fotoğrafınız) ----------
// veri/ilk-mesaj.txt : metin (düzenlenebilir)   veri/ilk-mesaj.jpg|png : fotoğraf
const SABLON_METIN = 'veri/ilk-mesaj.txt';
function sablonGorselYolu() {
  for (const u of ['jpg', 'jpeg', 'png', 'webp']) if (fs.existsSync(`veri/ilk-mesaj.${u}`)) return `veri/ilk-mesaj.${u}`;
  return null;
}
function sablonMetni(gecikmeli) {
  if (!fs.existsSync(SABLON_METIN)) return null;
  let t = fs.readFileSync(SABLON_METIN, 'utf8').trim();
  if (!t) return null;
  // İsteğe bağlı: .env'deki GECIKME_CUMLESI (ör. "dönüşüm gecikti, kusura bakmayın") sadece geç cevaplarda kalsın
  const gc = (process.env.GECIKME_CUMLESI || '').trim();
  if (!gecikmeli && gc) t = t.replace(gc, '').replace(/\s{2,}/g, ' ').trim();
  return t;
}

// ---------- Ayarlar ----------
const AYAR = {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  csv: process.env.MUSTERI_CSV || 'veri/musteriler.csv',
  sheet: process.env.GOOGLE_SHEET_CSV_URL || '',
  ilkMesaj: (process.env.ILK_MESAJ_GONDER || 'evet').toLowerCase().startsWith('e'),
  beklemeSn: Number(process.env.BEKLEME_SN || 25),
  yazmaMin: Number(process.env.YAZMA_MIN_SN || 4),
  yazmaMax: Number(process.env.YAZMA_MAX_SN || 12),
  saatler: process.env.CALISMA_SAATLERI ?? '09:00-23:00',
  gunlukLimit: Number(process.env.GUNLUK_LIMIT || 30),
  ilkMesajAralikSn: Number(process.env.ILK_MESAJ_ARALIK_SN || 240),
  panelPort: Number(process.env.PANEL_PORT || 3001),
  aktif: true,
};
const bildirimler = [];

if (!AYAR.apiKey || AYAR.apiKey.includes('...')) {
  console.error('HATA: .env dosyasına ANTHROPIC_API_KEY yazın (README\'ye bakın).');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toLocaleTimeString('tr-TR'), ...a);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const rastgele = (a, b) => a + Math.random() * (b - a);

const depo = new Depo();
// Eski taramadan kalan WhatsApp sistem bildirimlerini geçmişten temizle
for (const k of Object.values(depo.veri.musteriler)) {
  const once = k.gecmis.length;
  k.gecmis = k.gecmis.filter((g) => !/^\[Müşteri (e2e_notification|notification_template|notification|gp2|protocol|call_log|ciphertext|revoked|unknown) gönderdi/.test(g.metin));
  if (once !== k.gecmis.length && !k.gecmis.some((g) => g.rol !== 'sistem')) { k.ilkMesajBekliyor = true; k.cevaplanmamis = false; }
}
// Sizin ilgilendiğiniz kişilerde bot kapalı kalsın (panelden elle açılmadıkça)
for (const k of Object.values(depo.veri.musteriler)) if (k.sizIlgileniyorsunuz && !k.elleAcildi) { k.duraklatildi = true; k.cevaplanmamis = false; }
const claude = new ClaudeCevaplayici({ apiKey: AYAR.apiKey, model: AYAR.model });
let musteriler = new Map();
let benimId = null;          // kendi WhatsApp kimliğim (bildirim için)
const zamanlayicilar = new Map();
const isleniyor = new Set();
const botunGonderdigi = new Map(); // chatId -> Set(metin) — sizin elle yazdığınızı ayırt etmek için

// ---------- Çalışma saatleri ----------
function istanbulDakika() {
  const s = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour12: false });
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
function mesaiDisiBeklemeMs() {
  if (!AYAR.saatler.trim()) return 0;
  const [bas, bit] = AYAR.saatler.split('-').map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); });
  const simdi = istanbulDakika();
  const icinde = bas <= bit ? simdi >= bas && simdi < bit : simdi >= bas || simdi < bit;
  if (icinde) return 0;
  const fark = (bas - simdi + 1440) % 1440;
  return (fark * 60 + rastgele(60, 600)) * 1000; // açılıştan 1-10 dk sonra
}

// ---------- WhatsApp istemcisi ----------
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: 'veri/oturum' }),
  puppeteer: { headless: true, executablePath: process.env.CHROME_YOLU || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', (qr) => {
  log('Telefonunuzda WhatsApp > Bağlı cihazlar > Cihaz bağla ile bu QR kodu okutun:');
  qrcode.generate(qr, { small: true });
});
let hazirZamanlayici = null, tetikleyici = null, sayfaHatasiDinleniyor = false;
client.on('authenticated', () => {
  log('Giriş yapıldı, mesajlar senkronize ediliyor…');
  if (!sayfaHatasiDinleniyor && client.pupPage) {
    sayfaHatasiDinleniyor = true;
    let n = 0;
    client.pupPage.on('pageerror', (e) => { if (n++ < 3) log('WhatsApp sayfa hatası:', String(e.message || e).slice(0, 200)); });
  }
  // Bilinen kütüphane hatası: kayıtlı oturumla açılışta "hazır" olayı bazen gelmiyor.
  // Belli aralıklarla hazırlık adımını yeniden tetikliyoruz (yeniden tetikleme bu olayı tekrar ateşler, zamanlayıcıları bir kez kur).
  if (tetikleyici || benimId) return;
  let deneme = 0;
  tetikleyici = setInterval(async () => {
    if (benimId) return clearInterval(tetikleyici);
    deneme++;
    log(`Hazır olayı gelmedi, hazırlık yeniden tetikleniyor (${deneme})…`);
    try {
      await client.pupPage.evaluate(() => window.onAppStateHasSyncedEvent && window.onAppStateHasSyncedEvent());
    } catch (e) { log('Tetikleme hatası:', String(e.message || e).slice(0, 200)); }
  }, 40000);
  hazirZamanlayici = setTimeout(() => {
    if (!benimId) { log('WhatsApp 3 dakikada hazır olmadı, yeniden başlatılıyor…'); process.exit(1); }
  }, 180000);
});
client.on('loading_screen', (yuzde) => log(`Yükleniyor… %${yuzde}`));
client.on('change_state', (d) => log('Durum:', d));
client.on('auth_failure', (m) => log('Giriş hatası:', m));
client.on('disconnected', (r) => {
  bildir(`WhatsApp bağlantısı koptu (${r}). Bot yeniden başlıyor${r === 'LOGOUT' ? ', yeni QR kod okutmanız gerekecek' : ''}.`);
  depo.hemenKaydet();
  setTimeout(() => process.exit(1), 1500); // başlatma dosyası 10 sn sonra yeniden açar
});

client.on('ready', async () => {
  benimId = client.info.wid._serialized;
  log(`Bot hazır ✅  (${client.info.wid.user})  model: ${AYAR.model}`);
  await musteriListesiniYenile();
  if (!global.__donguKuruldu) {
    global.__donguKuruldu = true;
    setInterval(musteriListesiniYenile, 2 * 60 * 1000);
    if (fs.existsSync(AYAR.csv)) fs.watchFile(AYAR.csv, { interval: 5000 }, () => musteriListesiniYenile());
  }
  for (const tel of depo.veri.kuyruk || []) { // önceki çalışmadan kalan sıra
    const k = depo.veri.musteriler[tel];
    if (k?.ilkMesajBekliyor && !ilkMesajKuyrugu.includes(tel)) ilkMesajKuyrugu.push(tel);
  }
  if (AYAR.ilkMesaj) for (const k of Object.values(depo.veri.musteriler)) if (k.ilkMesajBekliyor && !ilkMesajKuyrugu.includes(k.telefon)) ilkMesajKuyrugu.push(k.telefon);
  // Kapalıyken gelmiş, cevaplanmamış mesajlar
  for (const k of Object.values(depo.veri.musteriler)) {
    if (k.cevaplanmamis && !k.duraklatildi) planla(k.telefon, 5000);
  }
  bildir(`🤖 Bot çalışıyor. Takipteki müşteri: ${musteriler.size}`);
  setTimeout(async () => {
    await sablonuBul().catch((e) => log('Şablon bulunamadı:', e.message));
    await sohbetleriTara().catch((e) => log('Tarama hatası:', e.message));
    if (process.env.META_ERISIM_TOKENI) await metaFormlariniGuncelle();
    if (!global.__metaDongu) { global.__metaDongu = true; setInterval(() => metaFormlariniGuncelle(), 2 * 60 * 60 * 1000); } // 2 saatte bir
  }, 5000);
});

// ---------- Yardımcılar ----------
// WhatsApp bazı sohbetleri telefon numarası yerine gizlilik kimliğiyle (LID) tutuyor; gerçek numarayı çözmeye çalışır.
const lidOnbellek = new Map();
async function chatTelefonu(chat) {
  const id = chat.id;
  if (id.server === 'c.us') return telefonNormalize(id.user);
  if (lidOnbellek.has(id._serialized)) return lidOnbellek.get(id._serialized);
  let tel = '';
  try {
    const [r] = await client.getContactLidAndPhone([id._serialized]);
    if (r?.pn) tel = telefonNormalize(String(r.pn).split('@')[0]);
  } catch { /* yoksay */ }
  if (!tel) {
    try { const c = await chat.getContact(); if (c?.number) tel = telefonNormalize(c.number); } catch { /* yoksay */ }
  }
  if (!tel) tel = 'lid' + id.user; // çözülemezse karışmasın diye işaretli tut
  lidOnbellek.set(id._serialized, tel);
  return tel;
}

// ---------- Formdan gelen otomatik WhatsApp mesajını tanıma ----------
// Form doldurulunca müşteri bu cümleyle başlayan hazır bir mesaj gönderiyor; altında form soruları ve cevapları oluyor.
const FORM_ANAHTAR = (process.env.FORM_MESAJI || 'Merhaba! Formunuzu doldurdum ve işletmeniz hakkında daha fazla bilgi edinmek istiyorum.');
const sadelestir = (t) => String(t || '').toLocaleLowerCase('tr-TR').replace(/[^a-zçğıöşü0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
function formMesajiMi(metin) {
  const m = sadelestir(metin), a = sadelestir(FORM_ANAHTAR);
  return m.startsWith(a) || m.slice(0, 120).includes('formunuzu doldurdum');
}
function formCevaplariniAyikla(metin) {
  let govde = String(metin || '');
  const i = govde.toLowerCase().indexOf('istiyorum');
  if (i >= 0 && i < 160) govde = govde.slice(i + 'istiyorum'.length);
  govde = govde.replace(/^[\s.!]+/, '').trim();
  return govde;
}
async function formdanMusteriEkle(tel, ad, metin, sessiz = false) {
  const cevaplar = formCevaplariniAyikla(metin);
  const tarih = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  try {
    let csv = fs.existsSync(AYAR.csv) ? fs.readFileSync(AYAR.csv, 'utf8') : 'ad,telefon\n';
    if (!csv.endsWith('\n')) csv += '\n';
    const baslik = csv.split('\n')[0].split(',').map((h) => h.trim());
    const q = (x) => `"${String(x || '').replace(/"/g, '""').replace(/\n/g, ' | ')}"`;
    const satir = baslik.map((h) => (h === 'ad' ? q(ad) : h === 'telefon' ? q(tel.startsWith('lid') ? tel : '+' + tel) : h === 'form_tarihi' ? q(tarih) : h === 'kaynak' ? q('WhatsApp form mesajı') : '""'));
    fs.writeFileSync(AYAR.csv, csv + satir.join(',') + '\n');
  } catch (e) { log('CSV\'ye eklenemedi:', e.message); }
  musteriler.set(tel, { telefon: tel, ad, form: { form_tarihi: tarih, kaynak: 'WhatsApp form mesajı' }, kaynak: 'whatsapp' });
  const k = depo.kayit(tel);
  k.ilkMesajBekliyor = false; k.ilkMesajGonderildi = true;
  k.ekForm = { form_tarihi: tarih, kaynak: 'WhatsApp form mesajı', ...(cevaplar ? { form_cevaplari: cevaplar } : {}) };
  depo.kaydet();
  if (!sessiz) bildir(`🆕 Yeni form müşterisi WhatsApp'tan yazdı: ${ad || ''} ${tel}. Bot ilgileniyor.`, tel);
}

// ---------- Mevcut sohbetleri tarama ----------
// Bot açılınca son 14 günün sohbetlerine bakar:
//  - Form mesajı atıp listede olmayanları listeye ekler
//  - Sizin zaten cevap verdiğiniz kişilerde botu durdurur ("Siz ilgileniyorsunuz")
//  - Form mesajı atıp hiç cevap almamış kişilere bot aralıklı olarak cevap verir
let taramaSuruyor = false;
async function sohbetiIsle(chat, tel, ozet, gecikmeRef) {
  const listede = musteriler.has(tel);
  const k0 = depo.veri.musteriler[tel];
  if (k0 && k0.gecmis.some((g) => g.rol !== 'sistem')) return; // bot zaten takip ediyor
  let msgs;
  try { msgs = await chat.fetchMessages({ limit: 40 }); } catch { return; }
  if (!msgs.length) return;
  const formMsg = msgs.find((m) => !m.fromMe && m.type === 'chat' && formMesajiMi(m.body));
  if (!listede && !formMsg) return;
  if (!listede) {
    let ad = '';
    try { const c = await chat.getContact(); ad = c.pushname || c.name || ''; } catch { /* yoksay */ }
    await formdanMusteriEkle(tel, ad, formMsg.body, true);
    ozet.yeniForm++;
  }
  const k = depo.kayit(tel);
  k.chatId = chat.id._serialized;
  const bas = formMsg ? msgs.indexOf(formMsg) : 0;
  const GERCEK = ['chat', 'image', 'video', 'audio', 'ptt', 'document', 'sticker', 'location', 'vcard'];
  const ilgili = msgs.slice(bas).filter((m) => GERCEK.includes(m.type)); // sistem bildirimlerini (e2e_notification vb.) sayma
  if (!ilgili.length) return; // gerçek bir yazışma yok (sadece sistem bildirimi): ilk mesaj bekliyor olarak kalsın
  k.gecmis = ilgili.map((m) => ({
    rol: m.fromMe ? 'sahip' : 'musteri',
    metin: m.type === 'chat' ? m.body : `[${m.fromMe ? '' : 'Müşteri '}${m.type} gönderdi${m.body ? ', açıklama: ' + m.body : ''}]`,
    zaman: new Date((m.timestamp || 0) * 1000).toISOString(),
  }));
  k.ilkMesajBekliyor = false;
  k.ilkMesajGonderildi = true;
  const i = ilkMesajKuyrugu.indexOf(tel); if (i >= 0) ilkMesajKuyrugu.splice(i, 1);
  if (ilgili.some((m) => m.fromMe)) {
    k.duraklatildi = true; k.cevaplanmamis = false; k.sizIlgileniyorsunuz = true;
    ozet.siz++;
  } else if (ilgili.length && !ilgili[ilgili.length - 1].fromMe) {
    k.cevaplanmamis = true;
    planla(tel, gecikmeRef.ms); gecikmeRef.ms += 60000; // birden fazla bekleyen varsa dakikada bir cevapla
    ozet.bot++;
  }
}

// Sizin müşterilere attığınız fotoğraflı tanıtım mesajını WhatsApp geçmişinden bulup şablon olarak kaydeder
async function sablonuBul() {
  if (sablonGorselYolu() && fs.existsSync(SABLON_METIN)) return;
  for (const k of Object.values(depo.veri.musteriler)) {
    if (!k.chatId || !k.gecmis.some((g) => g.rol === 'sahip' && g.metin.startsWith('[image'))) continue;
    try {
      const chat = await client.getChatById(k.chatId);
      const msgs = await chat.fetchMessages({ limit: 30 });
      const m = [...msgs].reverse().find((x) => x.fromMe && x.hasMedia && x.type === 'image' && (x.body || '').length > 200);
      if (!m) continue;
      const media = await m.downloadMedia();
      if (!media?.data) continue;
      const uzanti = (media.mimetype || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg');
      fs.writeFileSync(`veri/ilk-mesaj.${uzanti}`, Buffer.from(media.data, 'base64'));
      if (!fs.existsSync(SABLON_METIN)) fs.writeFileSync(SABLON_METIN, m.body.trim() + '\n');
      log(`🖼️  İlk mesaj şablonu WhatsApp geçmişinden alındı (veri/ilk-mesaj.${uzanti} + ilk-mesaj.txt)`);
      bildir('🖼️ Fotoğraflı ilk mesaj şablonunuz bulundu ve kaydedildi. Bot ilk mesajda bunu gönderecek.');
      return;
    } catch (e) { log('Şablon okuma hatası:', e.message); }
  }
  log('⚠️ Fotoğraflı ilk mesaj şablonu bulunamadı; ilk mesajı bot kendisi yazacak.');
}

// ---------- Facebook / Instagram form başvurularını çekme ----------
function csvyeSatirEkle(alanlar) {
  let csv = fs.existsSync(AYAR.csv) ? fs.readFileSync(AYAR.csv, 'utf8') : 'ad,telefon,form_tarihi,form_cevaplari,kaynak\n';
  if (!csv.endsWith('\n')) csv += '\n';
  const baslik = csv.split('\n')[0].split(',').map((h) => h.trim());
  const q = (x) => `"${String(x || '').replace(/"/g, '""').replace(/\n/g, ' | ')}"`;
  fs.writeFileSync(AYAR.csv, csv + baslik.map((h) => q(alanlar[h])).join(',') + '\n');
}

let metaCekiliyor = false, sonMetaCekim = null;
async function metaFormlariniGuncelle() {
  const token = process.env.META_ERISIM_TOKENI;
  if (!token) return { hata: 'Facebook bağlantısı kurulmamış (.env içinde META_ERISIM_TOKENI yok)' };
  if (metaCekiliyor) return { hata: 'Çekim zaten sürüyor' };
  metaCekiliyor = true;
  try {
    log('📋 Facebook form başvuruları çekiliyor…');
    const basvurular = await metaFormlariniCek({ token, sayfaId: process.env.META_SAYFA_ID, gun: 30 });
    let yeni = 0;
    for (const b of basvurular.sort((x, y) => x.tarih.localeCompare(y.tarih))) {
      if (musteriler.has(b.telefon) || depo.var(b.telefon)) continue;
      const tarih = new Date(b.tarih).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      csvyeSatirEkle({
        ad: b.ad, telefon: '+' + b.telefon, form_tarihi: tarih,
        form_cevaplari: Object.entries(b.cevaplar).map(([k, v]) => `${k}: ${v}`).join(' | '),
        ...b.cevaplar, // CSV'de aynı adlı sütun varsa oraya da yazılır
        kaynak: `Meta form (${b.platform || 'fb'})`,
      });
      const k = depo.kayit(b.telefon);
      k.ilkMesajBekliyor = true;
      k.ekForm = { form_tarihi: tarih, form_adi: b.formAdi, ...b.cevaplar, kaynak: `Meta form (${b.platform || 'fb'})` };
      musteriler.set(b.telefon, { telefon: b.telefon, ad: b.ad, form: k.ekForm });
      if (AYAR.ilkMesaj && !ilkMesajKuyrugu.includes(b.telefon)) ilkMesajKuyrugu.push(b.telefon);
      yeni++;
      log(`📋 Yeni Facebook başvurusu: ${b.ad} ${b.telefon}`);
    }
    depo.kaydet();
    sonMetaCekim = new Date().toISOString();
    if (yeni) bildir(`📋 Facebook'tan ${yeni} yeni form başvurusu alındı. ${AYAR.ilkMesaj ? 'İlk mesajlar sıraya alındı.' : 'Panelde "İlk mesaj bekliyor" olarak duruyorlar.'}`);
    else log('📋 Facebook\'ta yeni başvuru yok.');
    return { ok: true, yeni, toplam: basvurular.length };
  } catch (e) {
    log('Facebook formları çekilemedi:', e.message);
    bildir(`⚠️ Facebook formları çekilemedi: ${e.message}`);
    return { hata: e.message };
  } finally { metaCekiliyor = false; }
}

async function sohbetleriTara() {
  if (!benimId || taramaSuruyor) return null;
  taramaSuruyor = true;
  const ozet = { yeniForm: 0, siz: 0, bot: 0 };
  const gecikmeRef = { ms: 8000 };
  try {
    log('🔎 Son 14 günün sohbetleri taranıyor…');
    const sinir = Date.now() / 1000 - 14 * 86400;
    const goruldu = new Set();
    let chats = [];
    try { chats = await client.getChats(); } catch (e) { log('Sohbetler okunamadı:', e.message); }
    for (const chat of chats.filter((c) => !c.isGroup && (c.timestamp || 0) >= sinir).slice(0, 400)) {
      const tel = await chatTelefonu(chat).catch(() => '');
      if (!tel || goruldu.has(tel)) continue;
      goruldu.add(tel);
      await sohbetiIsle(chat, tel, ozet, gecikmeRef);
    }
    // Listede olup son 14 günde sohbeti görünmeyenler: doğrudan sohbetlerine bak
    for (const tel of musteriler.keys()) {
      if (goruldu.has(tel)) continue;
      const k = depo.veri.musteriler[tel];
      if (k && k.gecmis.some((g) => g.rol !== 'sistem')) continue;
      try {
        const wid = k?.chatId ? { _serialized: k.chatId } : await client.getNumberId(tel);
        if (!wid) continue;
        const chat = await client.getChatById(wid._serialized);
        await sohbetiIsle(chat, tel, ozet, gecikmeRef);
      } catch { /* sohbet yok */ }
    }
    depo.kaydet();
    const bekleyen = Object.values(depo.veri.musteriler).filter((k) => k.ilkMesajBekliyor && musteriler.has(k.telefon)).length;
    bildir(`🔎 Sohbet taraması bitti: ${ozet.siz} kişiyle siz zaten yazışmışsınız (bot onlarda durdu), ${ozet.bot} kişiye bot cevap verecek, ${ozet.yeniForm} yeni form müşterisi bulundu, ${bekleyen} kişiyle hiç yazışma yok.`);
    return { ...ozet, bekleyen };
  } finally { taramaSuruyor = false; }
}

// Bildirimler: Mac bildirim merkezi + veri/bildirimler.txt (WhatsApp'ta kendinize mesaj atmak oturumu riske atıyor)
function bildir(metin, tel = null) {
  bildirimler.unshift({ zaman: new Date().toISOString(), metin, tel });
  if (bildirimler.length > 200) bildirimler.length = 200;
  const satir = `[${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}] ${metin}`;
  log('🔔 ' + metin.replace(/\n/g, ' | '));
  try { fs.appendFileSync('veri/bildirimler.txt', satir + '\n\n'); } catch { /* yoksay */ }
  if (process.platform === 'darwin') {
    const guvenli = metin.replace(/["\\]/g, "'").replace(/\n/g, ' ').slice(0, 220);
    execFile('osascript', ['-e', `display notification "${guvenli}" with title "WhatsApp Botu" sound name "Glass"`], () => {});
  }
}

function isaretle(chatId, metin) {
  if (!botunGonderdigi.has(chatId)) botunGonderdigi.set(chatId, new Set());
  botunGonderdigi.get(chatId).add(metin.trim());
}
function botMuGonderdi(chatId, metin) {
  const s = botunGonderdigi.get(chatId);
  if (s && s.has(metin.trim())) { s.delete(metin.trim()); return true; }
  return false;
}

function planla(tel, ms = AYAR.beklemeSn * 1000) {
  clearTimeout(zamanlayicilar.get(tel));
  zamanlayicilar.set(tel, setTimeout(() => isle(tel), ms));
}

// ---------- Müşteri listesi ----------
async function musteriListesiniYenile() {
  const yeni = await musterileriYukle({ csvYolu: AYAR.csv, sheetUrl: AYAR.sheet });
  if (!yeni.size && musteriler.size) return; // geçici okuma hatasında listeyi silme
  musteriler = yeni;
  for (const [tel, m] of musteriler) {
    if (depo.var(tel)) continue;
    const k = depo.kayit(tel);
    if (depo.ilkCalisma) { k.ilkMesajGonderildi = true; continue; } // ilk kurulumda mevcut listeye mesaj atma
    k.ilkMesajBekliyor = true;
    log(`Yeni form başvurusu: ${m.ad || ''} ${tel}`);
    if (AYAR.ilkMesaj) ilkMesajKuyrugu.push(tel);
  }
  depo.ilkCalisma = false;
  depo.hemenKaydet();
}

// ---------- İlk mesaj kuyruğu (yeni başvurulara aralıklı yazar) ----------
const ilkMesajKuyrugu = [];
let sonIlkMesaj = 0;
// Sıra kalıcı: bot yeniden başlasa da kaybolmasın
let sonKaydedilenKuyruk = JSON.stringify(depo.veri.kuyruk || []);
setInterval(() => {
  const simdi = JSON.stringify(ilkMesajKuyrugu);
  if (simdi !== sonKaydedilenKuyruk) { depo.veri.kuyruk = [...ilkMesajKuyrugu]; depo.kaydet(); sonKaydedilenKuyruk = simdi; }
}, 3000);
setInterval(() => {
  if (!benimId || !AYAR.aktif || !ilkMesajKuyrugu.length) return;
  if (Date.now() - sonIlkMesaj < AYAR.ilkMesajAralikSn * 1000) return;
  if (mesaiDisiBeklemeMs() > 0) return;
  const tel = ilkMesajKuyrugu.shift();
  const k = depo.kayit(tel);
  if (!k.ilkMesajBekliyor || k.duraklatildi || k.gecmis.some((g) => g.rol === 'musteri' || g.rol === 'sahip' || g.rol === 'bot')) {
    k.ilkMesajBekliyor = false; depo.kaydet(); return;
  }
  k.ilkMesajBekliyor = false;
  k.cevaplanmamis = true;
  depo.mesajEkle(tel, 'sistem', '[SİSTEM: Bu kişi formu doldurdu. Henüz yazışma yok. İlk mesajı sen at. Form tarihi bağlamda var; birkaç gün önceyse "kusura bakmayın geç dönüş yapıyorum" de.]');
  sonIlkMesaj = Date.now();
  log(`✉️  İlk mesaj sırası: ${tel} (kuyrukta kalan ${ilkMesajKuyrugu.length})`);
  isle(tel);
}, 15000);

// ---------- Gelen mesaj ----------
client.on('message', async (msg) => {
  try {
    if (msg.fromMe || msg.isStatus || msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const tel = await chatTelefonu(chat);
    if (!musteriler.has(tel)) {
      if (msg.type !== 'chat' || !formMesajiMi(msg.body)) return; // formu doldurmamış kişi: dokunma
      let ad = msg._data?.notifyName || '';
      try { const c = await msg.getContact(); ad = ad || c.pushname || c.name || ''; } catch { /* yoksay */ }
      await formdanMusteriEkle(tel, ad, msg.body);
    }

    const k = depo.kayit(tel);
    k.chatId = chat.id._serialized;
    let metin = msg.body || '';
    if (msg.type !== 'chat') metin = `[Müşteri ${msg.type} gönderdi${metin ? ', açıklama: ' + metin : ''}]`;
    depo.mesajEkle(tel, 'musteri', metin);
    log(`← ${musteriler.get(tel).ad || tel}: ${metin.slice(0, 80)}`);

    if (k.duraklatildi) return;
    k.cevaplanmamis = true;
    planla(tel);
  } catch (e) { log('Mesaj işleme hatası:', e.message); }
});

// ---------- Benim gönderdiğim mesajlar (elle yazma + komutlar) ----------
client.on('message_create', async (msg) => {
  try {
    if (!msg.fromMe) return;
    const chat = await msg.getChat();
    const chatId = chat.id._serialized;
    const govde = (msg.body || '').trim();
    if (botMuGonderdi(chatId, govde)) return;

    const kendiSohbetim = chatId === benimId || (await chat.getContact().catch(() => null))?.isMe;
    if (kendiSohbetim) {
      if (govde.toLowerCase().startsWith('#bot')) await komut(govde);
      return;
    }
    if (chat.isGroup) return;
    const tel = await chatTelefonu(chat);
    if (!musteriler.has(tel)) return;

    // Siz müşteriye elle yazdınız → bot o müşteride durur
    const k = depo.kayit(tel);
    depo.mesajEkle(tel, 'sahip', govde || `[${msg.type}]`);
    if (!k.duraklatildi) {
      k.duraklatildi = true;
      k.cevaplanmamis = false;
      clearTimeout(zamanlayicilar.get(tel));
      depo.kaydet();
      log(`✋ Siz ${tel} ile elle yazıştı — bot bu müşteride durdu`);
      await bildir(`✋ ${musteriler.get(tel).ad || tel} sohbetine elle yazdınız, bot orada durdu.\nTekrar açmak için: #bot devam ${tel}`, tel);
    }
  } catch (e) { log('message_create hatası:', e.message); }
});

async function komut(govde) {
  const [, eylem = 'yardım', arg] = govde.split(/\s+/);
  const tel = arg ? telefonNormalize(arg) : '';
  switch (eylem.toLocaleLowerCase('tr-TR')) {
    case 'devam': {
      if (!depo.var(tel)) return bildir('Bu numara kayıtlı değil: ' + arg);
      const k = depo.kayit(tel);
      k.duraklatildi = false; depo.kaydet();
      return bildir(`▶️ Bot ${tel} için tekrar aktif.`);
    }
    case 'dur': {
      const k = depo.kayit(tel);
      k.duraklatildi = true; clearTimeout(zamanlayicilar.get(tel)); depo.kaydet();
      return bildir(`⏸️ Bot ${tel} için durduruldu.`);
    }
    case 'durum': {
      const satir = [...musteriler.values()].map((m) => {
        const k = depo.veri.musteriler[m.telefon] || {};
        return `• ${m.ad || '-'} ${m.telefon} — ${k.durum || 'yeni'}${k.duraklatildi ? ' ⏸️' : ''}`;
      });
      return bildir(`📋 Müşteriler (${satir.length}):\n` + (satir.join('\n') || 'yok'));
    }
    case 'ilkmesaj': {
      const bekleyen = Object.values(depo.veri.musteriler).filter((k) => k.ilkMesajBekliyor && musteriler.has(k.telefon));
      for (const k of bekleyen) if (!ilkMesajKuyrugu.includes(k.telefon)) ilkMesajKuyrugu.push(k.telefon);
      return bildir(`✉️ ${bekleyen.length} kişiye ilk mesaj sıraya alındı (her ${Math.round(AYAR.ilkMesajAralikSn / 60)} dakikada bir).`);
    }
    case 'yenile':
      await musteriListesiniYenile();
      return bildir(`🔄 Liste yenilendi: ${musteriler.size} müşteri`);
    default:
      return bildir(
        'Komutlar (bu sohbete yazın):\n#bot durum — tüm müşteriler\n#bot dur 905xx… — bir müşteride botu durdur\n' +
        '#bot devam 905xx… — tekrar başlat\n#bot yenile — müşteri listesini hemen yenile\n\n' +
        'Not: Bir müşteriye elle yazdığınız anda bot o sohbette kendiliğinden durur.');
  }
}

// ---------- Cevap üretme ve gönderme ----------
async function isle(tel) {
  if (isleniyor.has(tel)) return planla(tel, 5000);
  const k = depo.kayit(tel);
  if (k.sizIlgileniyorsunuz && !k.elleAcildi) { k.duraklatildi = true; k.cevaplanmamis = false; return; } // siz ilgileniyorsunuz: asla yazma
  if (k.duraklatildi || !k.cevaplanmamis) return;
  if (!AYAR.aktif) return planla(tel, 60000);

  const mesai = mesaiDisiBeklemeMs();
  if (mesai > 0) { log(`🌙 Mesai dışı, ${tel} için ${Math.round(mesai / 60000)} dk sonra cevap`); return planla(tel, mesai); }
  if (depo.bugunkuSayac(tel) >= AYAR.gunlukLimit) {
    k.duraklatildi = true; depo.kaydet();
    return bildir(`⚠️ ${tel} günlük bot limitine ulaştı, bot durdu. Siz devam edin.`, tel);
  }

  isleniyor.add(tel);
  k.cevaplanmamis = false;
  let hata = false;
  try {
    const tm = musteriler.get(tel) || { telefon: tel, form: {} };
    const m = { ...tm, form: { ...(tm.form || {}), ...(k.ekForm || {}) } };
    if (!k.chatId) {
      const wid = await client.getNumberId(tel);
      if (!wid) { k.duraklatildi = true; depo.kaydet(); return bildir(`❗ ${m.ad || ''} ${tel} WhatsApp kullanmıyor, aramanız gerekiyor.`, tel); }
      k.chatId = wid._serialized;
    }
    const chat = await client.getChatById(k.chatId);
    await chat.sendSeen().catch(() => {});

    // İlk temas: sizin fotoğraflı tanıtım mesajınızı aynen gönder, sohbeti sonra Claude sürdürsün
    const dahaOnceYazildi = k.gecmis.some((g) => g.rol === 'bot' || g.rol === 'sahip');
    const gorsel = sablonGorselYolu();
    if (!dahaOnceYazildi && gorsel) {
      const ilkMusteri = k.gecmis.find((g) => g.rol === 'musteri' || g.rol === 'sistem');
      const formTarihi = ilkMusteri ? new Date(ilkMusteri.zaman).getTime() : Date.now();
      const gecikmeli = Date.now() - formTarihi > 2 * 3600 * 1000;
      const metin = sablonMetni(gecikmeli);
      if (metin) {
        await chat.sendStateTyping().catch(() => {});
        await bekle(rastgele(AYAR.yazmaMin, AYAR.yazmaMax) * 1000);
        isaretle(k.chatId, metin);
        await client.sendMessage(k.chatId, MessageMedia.fromFilePath(gorsel), { caption: metin });
        depo.mesajEkle(tel, 'bot', `[Tanıtım görseli gönderildi] ${metin}`);
        depo.sayacArtir(tel);
        k.ilkMesajGonderildi = true;
        k.durum = 'bilgi_toplaniyor';
        depo.kaydet();
        log(`→ ${m.ad || tel}: [görsel + tanıtım metni]`);
        return;
      }
    }

    const s = await claude.cevapUret(m, k);
    k.durum = s.devret ? 'devredildi' : s.durum;

    for (const metin of s.mesajlar) {
      if (k.cevaplanmamis && s.mesajlar.indexOf(metin) > 0) break; // arada müşteri yeni yazdıysa yeniden düşün
      await chat.sendStateTyping().catch(() => {});
      await bekle(Math.min(AYAR.yazmaMax, Math.max(AYAR.yazmaMin, metin.length / 12)) * 1000 * rastgele(0.8, 1.2));
      isaretle(k.chatId, metin);
      await client.sendMessage(k.chatId, metin);
      depo.mesajEkle(tel, 'bot', metin);
      depo.sayacArtir(tel);
      log(`→ ${m.ad || tel}: ${metin.slice(0, 80)}`);
    }
    await chat.clearState().catch(() => {});
    k.ilkMesajGonderildi = true;

    if (s.devret) {
      k.duraklatildi = true;
      await bildir(`🙋 ${m.ad || ''} ${tel} size devredildi.\nNeden: ${s.devirNedeni || '-'}\nSon mesaj: ${k.gecmis.filter((g) => g.rol === 'musteri').slice(-1)[0]?.metin || '-'}`, tel);
    }
    if (s.sahibeNot) await bildir(`📝 ${m.ad || ''} ${tel}: ${s.sahibeNot}`, tel);
    depo.kaydet();
  } catch (e) {
    log('Cevap hatası:', e.message);
    hata = true;
    k.cevaplanmamis = true;
    planla(tel, 60000); // 1 dk sonra tekrar dene
  } finally {
    isleniyor.delete(tel);
    if (!hata && k.cevaplanmamis && !k.duraklatildi) planla(tel);
  }
}

// Terminal kapatılınca (SIGHUP) veya durdurulunca botu gerçekten kapat. (Puppeteer bu sinyalleri yakalayıp sadece tarayıcıyı kapatıyor; bot arkada sahipsiz kalıyordu.)
let kapaniyor = false;
async function kapat(sinyal) {
  if (kapaniyor) return; kapaniyor = true;
  log(`Kapatılıyor (${sinyal})…`);
  try { depo.hemenKaydet(); } catch { /* yoksay */ }
  setTimeout(() => process.exit(0), 4000).unref();
  await client.destroy().catch(() => {});
  process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => kapat(s));
process.on('unhandledRejection', (e) => log('Beklenmeyen hata:', e?.message || e));

// ---------- Kontrol paneli (http://localhost:PANEL_PORT) ----------
// Önce paneli aç: port doluysa bot zaten çalışıyordur, ikinci kopyayı başlatma (çift mesaj riskini önler)
const { paneliBaslat } = await import('./panel.js');
try {
  await paneliBaslat({
  AYAR, depo, bildirimler, log, bildir, isaretle, isle, planla,
  musteriler: () => musteriler, ilkMesajKuyrugu, hazir: () => Boolean(benimId),
  benimNo: () => client.info?.wid?.user || '',
  istemci: client, musteriListesiniYenile, sohbetleriTara, metaFormlariniGuncelle, sonMetaCekim: () => sonMetaCekim,
});
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    log('⛔ Bot zaten çalışıyor (panel portu dolu). Bu kopya kapatılıyor.');
    process.exit(0);
  }
  log('Panel başlatılamadı:', e.message);
}

musterileriYukle({ csvYolu: AYAR.csv, sheetUrl: AYAR.sheet }).then((m) => { if (!musteriler.size) musteriler = m; });
log('WhatsApp başlatılıyor…');
client.initialize();
