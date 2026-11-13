// Yerel kontrol paneli: http://localhost:3001  (sadece bu bilgisayardan erişilir)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { telefonNormalize } from './musteriler.js';

export function paneliBaslat(c) {
  return new Promise((hazir, hata) => {
  const HTML = path.resolve('panel/index.html');

  const ozet = (tel, k) => {
    const m = c.musteriler().get(tel) || {};
    const son = [...(k.gecmis || [])].reverse().find((g) => g.rol !== 'sistem');
    return {
      telefon: tel, ad: m.ad || '', form: { ...(m.form || {}), ...(k.ekForm || {}) },
      durum: k.durum || 'yeni', duraklatildi: !!k.duraklatildi, sizIlgileniyorsunuz: !!k.sizIlgileniyorsunuz,
      ilkMesajBekliyor: !!k.ilkMesajBekliyor, kuyrukta: c.ilkMesajKuyrugu.includes(tel),
      cevaplanmamis: !!k.cevaplanmamis,
      sonMesaj: son ? { rol: son.rol, metin: son.metin, zaman: son.zaman } : null,
      mesajSayisi: (k.gecmis || []).filter((g) => g.rol !== 'sistem').length,
      listede: c.musteriler().has(tel),
    };
  };

  const json = (res, kod, veri) => {
    res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(veri));
  };
  const govdeOku = (req) => new Promise((ok) => {
    let b = ''; req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  });

  const sunucu = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(HTML));
      }

      if (req.method === 'GET' && p === '/api/durum') {
        const liste = [];
        const tumu = new Set([...c.musteriler().keys(), ...Object.keys(c.depo.veri.musteriler)]);
        for (const tel of tumu) {
          if (!c.musteriler().has(tel)) continue;
          liste.push(ozet(tel, c.depo.veri.musteriler[tel] || {}));
        }
        liste.sort((a, b) => (b.sonMesaj?.zaman || '').localeCompare(a.sonMesaj?.zaman || ''));
        return json(res, 200, {
          hazir: c.hazir(), aktif: c.AYAR.aktif, sonMetaCekim: c.sonMetaCekim ? c.sonMetaCekim() : null, metaBagli: Boolean(process.env.META_ERISIM_TOKENI), benimNo: c.benimNo(), model: c.AYAR.model,
          saatler: c.AYAR.saatler, ilkMesajAralikDk: Math.round(c.AYAR.ilkMesajAralikSn / 60),
          kuyruk: c.ilkMesajKuyrugu.length, musteriler: liste, bildirimler: c.bildirimler.slice(0, 60),
        });
      }

      const mm = p.match(/^\/api\/musteri\/(\d+)(?:\/(\w+))?$/);
      if (mm) {
        const tel = mm[1]; const eylem = mm[2];
        if (!c.depo.var(tel) && !c.musteriler().has(tel)) return json(res, 404, { hata: 'Müşteri yok' });
        const k = c.depo.kayit(tel);
        if (req.method === 'GET' && !eylem) {
          return json(res, 200, { ...ozet(tel, k), gecmis: k.gecmis.filter((g) => g.rol !== 'sistem') });
        }
        const g = await govdeOku(req);
        if (eylem === 'duraklat') {
          k.duraklatildi = !!g.deger;
          if (!k.duraklatildi) k.elleAcildi = true; // elle açıldı
          if (!k.duraklatildi && k.cevaplanmamis) c.planla(tel, 3000);
          c.depo.kaydet(); return json(res, 200, { ok: true });
        }
        if (eylem === 'ilkmesaj') {
          if (k.gecmis.some((x) => x.rol !== 'sistem')) return json(res, 400, { hata: 'Bu kişiyle zaten yazışma var' });
          k.ilkMesajBekliyor = true; k.duraklatildi = false;
          if (!c.ilkMesajKuyrugu.includes(tel)) c.ilkMesajKuyrugu.push(tel);
          c.depo.kaydet(); return json(res, 200, { ok: true });
        }
        if (eylem === 'iptal') {
          const i = c.ilkMesajKuyrugu.indexOf(tel); if (i >= 0) c.ilkMesajKuyrugu.splice(i, 1);
          return json(res, 200, { ok: true });
        }
        if (eylem === 'mesaj') {
          const metin = String(g.metin || '').trim();
          if (!metin) return json(res, 400, { hata: 'Mesaj boş' });
          if (!c.hazir()) return json(res, 400, { hata: 'WhatsApp bağlı değil' });
          let chatId = k.chatId;
          if (!chatId) {
            const wid = await c.istemci.getNumberId(tel);
            if (!wid) return json(res, 400, { hata: 'Bu numara WhatsApp kullanmıyor' });
            chatId = k.chatId = wid._serialized;
          }
          c.isaretle(chatId, metin);
          await c.istemci.sendMessage(chatId, metin);
          c.depo.mesajEkle(tel, 'sahip', metin);
          if (g.botuDurdur !== false) { k.duraklatildi = true; k.cevaplanmamis = false; }
          k.ilkMesajBekliyor = false;
          { const i = c.ilkMesajKuyrugu.indexOf(tel); if (i >= 0) c.ilkMesajKuyrugu.splice(i, 1); }
          c.depo.kaydet();
          c.log(`→ (panelden) ${tel}: ${metin.slice(0, 80)}`);
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { hata: 'Bilinmeyen işlem' });
      }

      if (req.method === 'POST' && p === '/api/bot') {
        const g = await govdeOku(req);
        c.AYAR.aktif = !!g.aktif;
        c.log(c.AYAR.aktif ? '▶️ Bot panelden açıldı' : '⏸️ Bot panelden durduruldu');
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/meta-cek') {
        const r = await c.metaFormlariniGuncelle();
        if (r.hata) return json(res, 400, r);
        return json(res, 200, r);
      }

      if (req.method === 'POST' && p === '/api/tara') {
        if (!c.hazir()) return json(res, 400, { hata: 'WhatsApp bağlı değil' });
        const r = await c.sohbetleriTara();
        if (!r) return json(res, 400, { hata: 'Tarama zaten sürüyor' });
        return json(res, 200, { ok: true, ...r });
      }

      if (req.method === 'POST' && p === '/api/ilkmesaj-hepsi') {
        let n = 0;
        for (const [tel, k] of Object.entries(c.depo.veri.musteriler)) {
          if (k.ilkMesajBekliyor && c.musteriler().has(tel) && !c.ilkMesajKuyrugu.includes(tel)) { c.ilkMesajKuyrugu.push(tel); n++; }
        }
        c.bildir(`✉️ ${n} kişiye ilk mesaj sıraya alındı (her ${Math.round(c.AYAR.ilkMesajAralikSn / 60)} dakikada bir).`);
        return json(res, 200, { ok: true, sayi: n });
      }

      if (req.method === 'POST' && p === '/api/kuyruk-temizle') {
        c.ilkMesajKuyrugu.length = 0;
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/musteri-ekle') {
        const g = await govdeOku(req);
        const tel = telefonNormalize(g.telefon);
        if (tel.length < 11) return json(res, 400, { hata: 'Telefon numarası geçersiz' });
        const csv = c.AYAR.csv;
        const temiz = (x) => `"${String(x || '').replace(/"/g, '""')}"`;
        let metin = fs.existsSync(csv) ? fs.readFileSync(csv, 'utf8') : 'ad,telefon\n';
        if (!metin.endsWith('\n')) metin += '\n';
        const baslik = metin.split('\n')[0].split(',').map((h) => h.trim());
        const satir = baslik.map((h) => (h === 'ad' ? temiz(g.ad) : h === 'telefon' ? temiz('+' + tel) : h === 'kaynak' ? temiz('Panelden eklendi') : h === 'form_tarihi' ? temiz(new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })) : '""'));
        fs.writeFileSync(csv, metin + satir.join(',') + '\n');
        await c.musteriListesiniYenile();
        return json(res, 200, { ok: true, telefon: tel });
      }

      json(res, 404, { hata: 'Bulunamadı' });
    } catch (e) {
      c.log('Panel hatası:', e.message);
      json(res, 500, { hata: e.message });
    }
  });

  sunucu.once('error', (e) => hata(e));
  sunucu.listen(c.AYAR.panelPort, '127.0.0.1', () => {
    const adres = `http://localhost:${c.AYAR.panelPort}`;
    c.log(`🖥️  Kontrol paneli: ${adres}`);
    if (!process.env.PANEL_ACMA) pencereAc(adres, c.log);
    hazir();
  });
  });
}

// Paneli masaüstü penceresinde aç (Electron). Electron yoksa tarayıcıya düşer.
export function pencereAc(adres, log = console.log) {
  try {
    const electron = createRequire(import.meta.url)('electron'); // ikili dosyanın yolu
    const env = { ...process.env, PANEL_ADRES: adres };
    delete env.ELECTRON_RUN_AS_NODE;
    const p = spawn(electron, [path.resolve('panel/app.cjs')], { detached: true, stdio: 'ignore', env });
    p.unref();
  } catch (e) {
    log('Panel penceresi açılamadı, tarayıcıda açılıyor:', e.message);
    if (process.platform === 'darwin') execFile('open', [adres], () => {});
  }
}
