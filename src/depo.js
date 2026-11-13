// Konuşma geçmişi ve müşteri durumlarını veri/durum.json içinde saklar.
import fs from 'node:fs';
import path from 'node:path';

const DOSYA = path.resolve('veri/durum.json');

export class Depo {
  constructor() {
    this.ilkCalisma = !fs.existsSync(DOSYA);
    this.veri = this.ilkCalisma ? { musteriler: {} } : JSON.parse(fs.readFileSync(DOSYA, 'utf8'));
    this._zamanlayici = null;
    // Eski sürümlerden kalan rol adını dönüştür
    for (const k of Object.values(this.veri.musteriler || {})) for (const g of k.gecmis || []) if (g.rol === 'erdem') g.rol = 'sahip';
  }

  kayit(telefon) {
    if (!this.veri.musteriler[telefon]) {
      this.veri.musteriler[telefon] = {
        telefon, durum: 'yeni', duraklatildi: false, ilkMesajGonderildi: false,
        gecmis: [], notlar: [], gunluk: {},
      };
    }
    return this.veri.musteriler[telefon];
  }

  var(telefon) { return Boolean(this.veri.musteriler[telefon]); }

  mesajEkle(telefon, rol, metin) {
    const k = this.kayit(telefon);
    k.gecmis.push({ rol, metin, zaman: new Date().toISOString() });
    if (k.gecmis.length > 200) k.gecmis = k.gecmis.slice(-200);
    this.kaydet();
  }

  bugunkuSayac(telefon) {
    const g = new Date().toISOString().slice(0, 10);
    const k = this.kayit(telefon);
    return k.gunluk[g] || 0;
  }

  sayacArtir(telefon) {
    const g = new Date().toISOString().slice(0, 10);
    const k = this.kayit(telefon);
    k.gunluk = { [g]: (k.gunluk[g] || 0) + 1 };
    this.kaydet();
  }

  kaydet() {
    clearTimeout(this._zamanlayici);
    this._zamanlayici = setTimeout(() => this.hemenKaydet(), 300);
  }

  hemenKaydet() {
    fs.mkdirSync(path.dirname(DOSYA), { recursive: true });
    const gecici = DOSYA + '.tmp';
    fs.writeFileSync(gecici, JSON.stringify(this.veri, null, 2));
    fs.renameSync(gecici, DOSYA);
  }
}
