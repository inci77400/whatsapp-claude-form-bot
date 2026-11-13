// Formu dolduran müşteri listesini (yerel CSV + isteğe bağlı Google Sheet CSV) okur.
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';

export function telefonNormalize(ham) {
  if (/^lid\d+$/.test(String(ham || ''))) return String(ham);
  let d = String(ham || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = '90' + d.slice(1); // 05xx...
  if (d.length === 10 && d.startsWith('5')) d = '90' + d;          // 5xx...
  return d;
}

const kucuk = (s) => s.toLocaleLowerCase('tr-TR');
const TEL_ANAHTAR = ['telefon', 'whatsapp', 'numara', 'phone', 'gsm', 'cep', 'tel'];
const AD_ANAHTAR = ['ad soyad', 'adınız', 'adiniz', 'isim', 'ad', 'name', 'full name'];

function sutunBul(basliklar, anahtarlar) {
  for (const a of anahtarlar) {
    const b = basliklar.find((h) => {
      const k = kucuk(h).trim();
      return a.length <= 3 ? k === a || k.startsWith(a + ' ') : k.includes(a);
    });
    if (b) return b;
  }
  return null;
}

function csvdenMusteriler(metin, kaynak) {
  const satirlar = parse(metin.replace(/^﻿/, '').replace(/\r\n?/g, '\n'), {
    columns: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true,
    delimiter: metin.split('\n')[0].includes(';') && !metin.split('\n')[0].includes(',') ? ';' : ',',
  });
  if (!satirlar.length) return [];
  const basliklar = Object.keys(satirlar[0]);
  const telS = sutunBul(basliklar, TEL_ANAHTAR);
  const adS = sutunBul(basliklar, AD_ANAHTAR);
  if (!telS) {
    console.warn(`[musteri] ${kaynak}: telefon sütunu bulunamadı. Başlıklar: ${basliklar.join(', ')}`);
    return [];
  }
  return satirlar
    .map((s) => {
      const telefon = telefonNormalize(s[telS]);
      const form = {};
      for (const [k, v] of Object.entries(s)) if (v && k !== telS) form[k] = v;
      return { telefon, ad: adS ? s[adS] : '', form, kaynak };
    })
    .filter((m) => m.telefon.length >= 10);
}

export async function musterileriYukle({ csvYolu, sheetUrl }) {
  const liste = [];
  if (csvYolu && fs.existsSync(csvYolu)) {
    try { liste.push(...csvdenMusteriler(fs.readFileSync(csvYolu, 'utf8'), 'csv')); }
    catch (e) { console.error('[musteri] CSV okunamadı:', e.message); }
  }
  if (sheetUrl) {
    try {
      const r = await fetch(sheetUrl);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      liste.push(...csvdenMusteriler(await r.text(), 'google-sheet'));
    } catch (e) { console.error('[musteri] Google Sheet okunamadı:', e.message); }
  }
  const harita = new Map();
  for (const m of liste) harita.set(m.telefon, { ...(harita.get(m.telefon) || {}), ...m });
  return harita;
}
