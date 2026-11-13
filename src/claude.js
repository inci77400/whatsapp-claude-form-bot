// Claude API ile işletme sahibinin ağzından cevap üretir.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// Kurallar her cevapta dosyadan okunur: prompt/sistem.md'yi düzenleyip kaydettiğiniz an geçerli olur (yeniden başlatma gerekmez)
// prompt/sistem.md yoksa repodaki örnek şablon (prompt/sistem.ornek.md) kullanılır
const SISTEM_YOLU = path.resolve('prompt/sistem.md');
const ORNEK_YOLU = path.resolve('prompt/sistem.ornek.md');
const sistemOku = () => fs.readFileSync(fs.existsSync(SISTEM_YOLU) ? SISTEM_YOLU : ORNEK_YOLU, 'utf8');

const ARAC = {
  name: 'yanit',
  description: 'Müşteriye gönderilecek WhatsApp mesajları ve işletme sahibi için iç notlar.',
  input_schema: {
    type: 'object',
    properties: {
      mesajlar: {
        type: 'array', items: { type: 'string' }, maxItems: 3,
        description: 'Sırayla ayrı WhatsApp balonları olarak gönderilecek mesajlar. Devret ise veya cevap gerekmiyorsa boş dizi.',
      },
      devret: { type: 'boolean', description: 'true ise bot bu müşteriye artık yazmaz, işletme sahibi devralır.' },
      devir_nedeni: { type: 'string', description: 'Devretme nedeni (devret=true ise).' },
      durum: {
        type: 'string',
        enum: ['bilgi_toplaniyor', 'arama_bekleniyor', 'dusunuyor', 'uygun_degil', 'devredildi'],
      },
      sahibe_not: { type: 'string', description: 'İşletme sahibine bildirilecek kısa not (arama saati, cevaplanamayan soru vb.). Yoksa boş.' },
    },
    required: ['mesajlar', 'devret', 'durum'],
  },
};

export class ClaudeCevaplayici {
  constructor({ apiKey, model }) {
    this.istemci = new Anthropic({ apiKey });
    this.model = model || 'claude-sonnet-5-5';
  }

  _mesajlariHazirla(musteri, kayit, yeniGirdi) {
    const formMetni = musteri && Object.keys(musteri.form || {}).length
      ? Object.entries(musteri.form).map(([k, v]) => `- ${k}: ${v}`).join('\n')
      : '(form bilgisi yok)';
    const baglam =
      `[BAĞLAM — müşteriye gösterilmez]\nMüşteri adı: ${musteri?.ad || 'bilinmiyor'}\n` +
      `Form cevapları:\n${formMetni}\nŞu anki durum: ${kayit.durum}\n` +
      `Tarih/saat (Türkiye): ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`;

    const ham = [{ rol: 'user', metin: baglam }];
    for (const g of kayit.gecmis) {
      if (g.rol === 'musteri' || g.rol === 'sistem') ham.push({ rol: 'user', metin: g.metin });
      else if (g.rol === 'bot') ham.push({ rol: 'assistant', metin: g.metin });
      else if (g.rol === 'sahip') ham.push({ rol: 'assistant', metin: `[İşletme sahibi elle yazdı] ${g.metin}` });
    }
    if (yeniGirdi) ham.push({ rol: 'user', metin: yeniGirdi });

    // Ardışık aynı rolleri birleştir (API sırayla user/assistant ister)
    const sonuc = [];
    for (const m of ham) {
      const son = sonuc[sonuc.length - 1];
      if (son && son.role === m.rol) son.content += '\n' + m.metin;
      else sonuc.push({ role: m.rol, content: m.metin });
    }
    if (sonuc[sonuc.length - 1].role !== 'user') {
      sonuc.push({ role: 'user', content: '[SİSTEM: Müşteriden yeni mesaj yok. Gerekmiyorsa mesajlar boş dizi dön.]' });
    }
    return sonuc;
  }

  async cevapUret(musteri, kayit, yeniGirdi = null) {
    const mesajlar = this._mesajlariHazirla(musteri, kayit, yeniGirdi);
    let blok = null, metin = '';
    for (let deneme = 0; deneme < 2 && !blok; deneme++) {
      const yanit = await this.istemci.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: sistemOku() + '\n\nÖNEMLİ: Cevabını HER ZAMAN ve SADECE `yanit` aracını çağırarak ver.',
        tools: [ARAC],
        tool_choice: { type: 'auto' },
        messages: deneme === 0 ? mesajlar : [...mesajlar.slice(0, -1), {
          role: 'user', content: mesajlar[mesajlar.length - 1].content + '\n[SİSTEM: yanit aracını çağır.]',
        }],
      });
      blok = yanit.content.find((b) => b.type === 'tool_use');
      metin = yanit.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
    if (!blok) {
      // Araç çağrılmadıysa güvenli taraf: müşteriye yazma, işletme sahibine devret
      return { mesajlar: [], devret: true, devirNedeni: 'Bot cevap biçimini üretemedi' + (metin ? ': ' + metin.slice(0, 200) : ''), durum: 'devredildi', sahibeNot: '' };
    }
    const s = blok.input;
    return {
      mesajlar: (s.mesajlar || []).map((x) => String(x).trim()).filter(Boolean),
      devret: Boolean(s.devret),
      devirNedeni: s.devir_nedeni || '',
      durum: s.durum || kayit.durum,
      sahibeNot: s.sahibe_not || '',
    };
  }
}
