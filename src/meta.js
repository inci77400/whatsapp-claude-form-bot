// Facebook/Instagram anında form (lead ads) başvurularını Meta Graph API ile çeker.
// .env: META_ERISIM_TOKENI=<sayfa erişim anahtarı>   (isteğe bağlı) META_SAYFA_ID=<sayfa id>
import { telefonNormalize } from './musteriler.js';

const API = 'https://graph.facebook.com/v21.0';

async function getir(yol, token, parametreler = {}) {
  const url = new URL(yol.startsWith('http') ? yol : API + yol);
  if (!yol.startsWith('http')) {
    url.searchParams.set('access_token', token);
    for (const [k, v] of Object.entries(parametreler)) url.searchParams.set(k, v);
  }
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return j;
}

async function hepsiniGetir(yol, token, parametreler) {
  const sonuc = [];
  let sayfa = await getir(yol, token, parametreler);
  for (let i = 0; i < 20; i++) {
    sonuc.push(...(sayfa.data || []));
    if (!sayfa.paging?.next) break;
    sayfa = await getir(sayfa.paging.next, token);
  }
  return sonuc;
}

const kucuk = (s) => String(s || '').toLocaleLowerCase('tr-TR');

/** Son `gun` gündeki tüm form başvurularını döndürür: [{ ad, telefon, tarih, formAdi, cevaplar:{soru:cevap}, platform }] */
export async function metaFormlariniCek({ token, sayfaId, gun = 30 }) {
  if (!token) throw new Error('META_ERISIM_TOKENI ayarlı değil');
  const sayfa = sayfaId || (await getir('/me', token, { fields: 'id,name' })).id;
  const formlar = await hepsiniGetir(`/${sayfa}/leadgen_forms`, token, { fields: 'id,name,status', limit: '100' });
  const sinir = Math.floor(Date.now() / 1000) - gun * 86400;
  const basvurular = [];
  for (const f of formlar) {
    const leads = await hepsiniGetir(`/${f.id}/leads`, token, {
      fields: 'created_time,field_data,platform',
      limit: '100',
      filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinir }]),
    });
    for (const l of leads) {
      const cevaplar = {};
      let ad = '', tel = '';
      for (const fd of l.field_data || []) {
        const ad_ = kucuk(fd.name), deger = (fd.values || []).join(', ').replace(/_/g, ' ').trim();
        if (!tel && /(phone|telefon|numara|gsm|whatsapp)/.test(ad_)) tel = deger;
        else if (!ad && /(full_name|ad_soyad|adı_soyadı|adiniz|name|isim)/.test(ad_)) ad = deger;
        else if (!/(email|e-posta|eposta)/.test(ad_)) cevaplar[fd.name.replace(/_/g, ' ')] = deger;
      }
      const telefon = telefonNormalize(tel);
      if (!telefon || telefon.length < 10) continue;
      basvurular.push({ ad, telefon, tarih: l.created_time, formAdi: f.name, cevaplar, platform: l.platform || '' });
    }
  }
  return basvurular;
}
