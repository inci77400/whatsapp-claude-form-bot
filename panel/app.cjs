// Kontrol panelini tarayıcı yerine kendi penceresinde (masaüstü uygulaması) açar.
const { app, BrowserWindow, shell } = require('electron');
const ADRES = process.env.PANEL_ADRES || 'http://localhost:3001';

if (!app.requestSingleInstanceLock()) app.quit();
app.setName('WhatsApp Botu');

let pencere;
function ac() {
  pencere = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1000, minHeight: 600,
    title: 'WhatsApp Botu', backgroundColor: '#F4F6FA',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  pencere.setMenuBarVisibility(false);
  pencere.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  const yukle = () => pencere.loadURL(ADRES).catch(() => setTimeout(yukle, 1500)); // bot daha hazır değilse tekrar dene
  yukle();
}

app.whenReady().then(ac);
app.on('second-instance', () => { if (pencere) { if (pencere.isMinimized()) pencere.restore(); pencere.focus(); } });
app.on('window-all-closed', () => app.quit()); // pencereyi kapatmak botu durdurmaz
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) ac(); });
