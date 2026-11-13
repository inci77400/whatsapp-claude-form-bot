// WhatsApp'a bağlanmadan, terminalde müşteri gibi yazarak botun cevaplarını test edin.
import 'dotenv/config';
import readline from 'node:readline/promises';
import fs from 'node:fs';
import { ClaudeCevaplayici } from './claude.js';

const claude = new ClaudeCevaplayici({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.CLAUDE_MODEL });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ad = (await rl.question('Test müşterisinin adı (boş bırakabilirsiniz): ')).trim() || 'Ahmet Yılmaz';
const musteri = { ad, telefon: '905550000000', form: {
  'form_tarihi': new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  'Hangi hizmetle ilgileniyorsunuz?': 'Henüz karar vermedim, bilgi almak istiyorum.',
  'Bütçeniz nedir?': '10.000 TL - 25.000 TL',
} };
const kayit = { durum: 'yeni', gecmis: [{ rol: 'musteri', metin: 'Merhaba! Formunuzu doldurdum ve işletmeniz hakkında daha fazla bilgi edinmek istiyorum.\n\nHangi hizmetle ilgileniyorsunuz?: Henüz karar vermedim, bilgi almak istiyorum.\nBütçeniz nedir?: 10.000 TL - 25.000 TL' }] };
console.log(`\n\x1b[36mMÜŞTERİ:\x1b[0m ${kayit.gecmis[0].metin}\n`);

// Gerçek akıştaki gibi ilk mesaj olarak fotoğraflı tanıtım metni gider
if (fs.existsSync('veri/ilk-mesaj.txt')) {
  const t = fs.readFileSync('veri/ilk-mesaj.txt', 'utf8').trim()
    .replace((process.env.GECIKME_CUMLESI || '\u0000').trim(), '').replace(/\s{2,}/g, ' ');
  console.log(`\x1b[32mBOT:\x1b[0m [📷 tanıtım fotoğrafı]\n${t}\n`);
  kayit.gecmis.push({ rol: 'bot', metin: `[Tanıtım görseli gönderildi] ${t}` });
  kayit.durum = 'bilgi_toplaniyor';
}

async function tur() {
  process.stdout.write('\x1b[90m(bot düşünüyor…)\x1b[0m\r');
  const s = await claude.cevapUret(musteri, kayit);
  for (const m of s.mesajlar) { console.log(`\x1b[32mBOT:\x1b[0m ${m}`); kayit.gecmis.push({ rol: 'bot', metin: m }); }
  if (!s.mesajlar.length) console.log('\x1b[33m(bot bu mesaja cevap vermedi)\x1b[0m');
  kayit.durum = s.durum;
  const notlar = [`durum: ${s.durum}`];
  if (s.devret) notlar.push(`SİZE DEVREDİLDİ: ${s.devirNedeni}`);
  if (s.sahibeNot) notlar.push(`size not: ${s.sahibeNot}`);
  console.log(`\x1b[90m   [${notlar.join(' | ')}]\x1b[0m\n`);
}

if (!fs.existsSync('veri/ilk-mesaj.txt')) await tur();
for (;;) {
  const g = await rl.question('\x1b[36mMÜŞTERİ:\x1b[0m ');
  if (g.trim().toLowerCase() === 'q') break;
  if (!g.trim()) continue;
  kayit.gecmis.push({ rol: 'musteri', metin: g });
  await tur();
}
rl.close();
