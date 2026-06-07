const { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, screen } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const APP_NAME = 'Bangumi 保管库';
const APP_ID = 'io.github.akisato.bangumi.vault';
const DATA_DIR_NAME = '资料库';
const IMAGES_DIR_NAME = '封面缓存';
const BACKUPS_DIR_NAME = '备份';
const LOGS_DIR_NAME = '日志';
const STATE_FILE_NAME = '收藏数据.json';
let mainWindow = null;
let localServer = null;
let localServerUrl = '';
let dataDir = '';
let imagesDir = '';
let backupsDir = '';
let logsDir = '';
let stateFile = '';

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const test = path.join(dir, '.write-test');
    fs.writeFileSync(test, 'ok');
    fs.unlinkSync(test);
    return true;
  } catch {
    return false;
  }
}

function chooseDataDir() {
  if (process.env.BANGUMI_VAULT_DATA_DIR) {
    return process.env.BANGUMI_VAULT_DATA_DIR;
  }
  if (process.env.BANGUMI_HOGUAN_DATA_DIR) {
    return process.env.BANGUMI_HOGUAN_DATA_DIR;
  }

  // Development mode: keep the portable data folder beside the project.
  if (!app.isPackaged) {
    return path.join(__dirname, DATA_DIR_NAME);
  }

  // Packaged Windows portable mode: prefer the data folder beside the executable.
  const exeDir = path.dirname(process.execPath);
  const portableDir = path.join(exeDir, DATA_DIR_NAME);
  if (isWritableDir(portableDir)) return portableDir;

  // Installed app fallback: use the OS user-data directory.
  return path.join(app.getPath('userData'), DATA_DIR_NAME);
}

async function copyDirIfExists(fromDir, toDir) {
  try {
    await fsp.access(fromDir, fs.constants.F_OK);
  } catch {
    return;
  }
  await fsp.mkdir(toDir, { recursive: true });
  const entries = await fsp.readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirIfExists(from, to);
    } else {
      try {
        await fsp.access(to, fs.constants.F_OK);
      } catch {
        await fsp.copyFile(from, to);
      }
    }
  }
}

async function migrateLegacyVaultData() {
  const legacyDir = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'VaultData')
    : path.join(__dirname, 'VaultData');
  if (legacyDir === dataDir) return;

  const legacyState = path.join(legacyDir, 'state.json');
  try {
    await fsp.access(stateFile, fs.constants.F_OK);
  } catch {
    try {
      await fsp.copyFile(legacyState, stateFile);
    } catch {}
  }

  await copyDirIfExists(path.join(legacyDir, 'Images'), imagesDir);
  await copyDirIfExists(path.join(legacyDir, 'Backups'), backupsDir);
  await copyDirIfExists(path.join(legacyDir, 'Logs'), logsDir);
}

async function ensureDataDirs() {
  dataDir = chooseDataDir();
  imagesDir = path.join(dataDir, IMAGES_DIR_NAME);
  backupsDir = path.join(dataDir, BACKUPS_DIR_NAME);
  logsDir = path.join(dataDir, LOGS_DIR_NAME);
  stateFile = path.join(dataDir, STATE_FILE_NAME);

  await fsp.mkdir(imagesDir, { recursive: true });
  await fsp.mkdir(backupsDir, { recursive: true });
  await fsp.mkdir(logsDir, { recursive: true });
  await migrateLegacyVaultData();
  try {
    await fsp.access(stateFile, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(stateFile, '', 'utf8');
  }
}

function appHtmlPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'BangumiVault.html');
  }
  return path.join(__dirname, 'app', 'BangumiVault.html');
}


function assetPath(fileName) {
  const safe = safeName(fileName, 'icon.svg');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'build', safe);
  }
  return path.join(__dirname, 'build', safe);
}

function windowIconPath() {
  if (process.platform === 'win32') return assetPath('icon.ico');
  return assetPath('icon.png');
}

function safeName(name, fallback = 'file') {
  const raw = String(name || '').trim() || fallback;
  // Windows-invalid characters plus path separators and control chars.
  return raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, fallback);
}

function mimeByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(bytes);
}

async function sendFile(res, filePath, contentType) {
  try {
    const bytes = await fsp.readFile(filePath);
    send(res, 200, bytes, contentType || mimeByExt(filePath));
  } catch {
    send(res, 404, 'Not found');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function guessImageExt(contentType, remoteUrl) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  try {
    const ext = path.extname(new URL(remoteUrl).pathname).toLowerCase();
    if (['.png', '.webp', '.gif', '.jpg', '.jpeg'].includes(ext)) return ext;
  } catch {}
  return '.jpg';
}

function downloadBuffer(remoteUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(remoteUrl); } catch (err) { reject(err); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': 'BangumiVault/0.29.6 (local image backup)',
        'Referer': 'https://bgm.tv/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      timeout: 30000
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        downloadBuffer(next, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}


function downloadText(remoteUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(remoteUrl); } catch (err) { reject(err); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': 'BangumiVault/0.29.3 (local subject tag backup)',
        'Referer': 'https://bgm.tv/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6'
      },
      timeout: 30000
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        downloadText(next, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

function decodeHtmlEntity(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html) {
  return decodeHtmlEntity(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractSubjectPageTags(html) {
  const source = String(html || '');
  let start = source.search(/大家将[\s\S]{0,600}?标注为/);
  if (start < 0) start = source.search(/subject_tag_section|subject_tags|tagsWrapper/i);
  if (start < 0) return [];
  let segment = source.slice(start, start + 16000);
  const next = segment.slice(200).search(/<h2\b|<h3\b|id=["']subjectPanelCollect|class=["'][^"']*subject_section/i);
  if (next > 0) segment = segment.slice(0, 200 + next);
  const tags = [];
  const seen = new Set();
  const re = /<a\b([^>]*?href=(['"])([^'"]*\/tag\/[^'"]*)\2[^>]*)>([\s\S]*?)<\/a>([\s\S]{0,120})/gi;
  let match;
  while ((match = re.exec(segment))) {
    const href = decodeHtmlEntity(match[3] || '');
    if (!/\/(anime|book|music|game|real|subject)\/tag\//.test(href) && !/\/tag\//.test(href)) continue;
    let text = stripTags(match[4]);
    if (!text || /更多|more/i.test(text)) continue;
    let count = 0;
    const insideCount = text.match(/^(.*?)[\s\(（]+(\d+)[\)）]?$/);
    if (insideCount) {
      text = insideCount[1].trim();
      count = Number(insideCount[2]) || 0;
    } else {
      const tail = match[5] || '';
      const tailCount = tail.match(/<(?:span|small)\b[^>]*?(?:class=(['"])[^'"]*(?:num|count)[^'"]*\1)?[^>]*>\s*(\d+)\s*<\/(?:span|small)>/i);
      if (tailCount) count = Number(tailCount[2]) || 0;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    tags.push({ name: text, count });
  }
  return tags;
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (req.method === 'GET' && (pathname === '/' || pathname === '/BangumiVault.html')) {
    await sendFile(res, appHtmlPath(), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/assets/')) {
    const file = safeName(path.basename(pathname.slice('/assets/'.length)), 'icon.svg');
    await sendFile(res, assetPath(file), mimeByExt(file));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/ping') {
    send(res, 200, JSON.stringify({ ok: true, desktop: true, dataDir }), 'application/json; charset=utf-8');
    return;
  }


  if (req.method === 'GET' && pathname === '/api/state') {
    try {
      const stat = await fsp.stat(stateFile);
      if (stat.size <= 0) {
        send(res, 204, '', 'application/json; charset=utf-8');
      } else {
        await sendFile(res, stateFile, 'application/json; charset=utf-8');
      }
    } catch {
      send(res, 204, '', 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/state') {
    const body = await readBody(req);
    const tmp = `${stateFile}.tmp`;
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, stateFile);
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cache-cover') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const sid = safeName(body.subject_id, 'subject');
    const remoteUrl = String(body.url || '').trim();
    if (!sid || !remoteUrl) {
      send(res, 400, JSON.stringify({ ok: false, error: 'missing subject_id or url' }), 'application/json; charset=utf-8');
      return;
    }
    const downloaded = await downloadBuffer(remoteUrl);
    const ext = guessImageExt(downloaded.contentType, remoteUrl);
    const file = `${sid}${ext}`;
    const target = path.join(imagesDir, file);
    await fsp.writeFile(target, downloaded.buffer);
    send(res, 200, JSON.stringify({ ok: true, url: `/images/${file}`, file: `${IMAGES_DIR_NAME}/${file}` }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/images/')) {
    const file = safeName(path.basename(pathname.slice('/images/'.length)));
    await sendFile(res, path.join(imagesDir, file), mimeByExt(file));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/save-file') {
    const name = safeName(requestUrl.searchParams.get('name'), 'backup.bin');
    const body = await readBody(req);
    await fsp.writeFile(path.join(backupsDir, name), body);
    send(res, 200, JSON.stringify({ ok: true, file: `${BACKUPS_DIR_NAME}/${name}` }), 'application/json; charset=utf-8');
    return;
  }

  send(res, 404, 'Not found');
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer((req, res) => {
      handleRequest(req, res).catch(err => {
        send(res, 500, JSON.stringify({ ok: false, error: err.message || String(err) }), 'application/json; charset=utf-8');
      });
    });
    localServer.on('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
      const address = localServer.address();
      localServerUrl = `http://127.0.0.1:${address.port}/`;
      resolve(localServerUrl);
    });
  });
}

function createMainWindow() {
  const isMac = process.platform === 'darwin';
  const iconImage = nativeImage.createFromPath(windowIconPath());
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const adaptiveWidth = Math.max(1120, Math.min(1560, Math.round(workArea.width * 0.84)));
  const adaptiveHeight = Math.max(720, Math.min(940, Math.round(workArea.height * 0.86)));
  mainWindow = new BrowserWindow({
    width: adaptiveWidth,
    height: adaptiveHeight,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: '#00000000',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' } : {}),
    icon: iconImage,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  if (process.platform === 'win32' && !iconImage.isEmpty()) {
    mainWindow.setIcon(iconImage);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.center();
    mainWindow.show();
  });
  mainWindow.loadURL(localServerUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerIpc() {
  ipcMain.handle('window:minimize', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });
  ipcMain.handle('window:toggle-maximize', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle('window:close', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });
  ipcMain.handle('app:open-data-dir', async () => {
    await shell.openPath(dataDir);
  });
  ipcMain.handle('app:get-info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    dataDir,
    serverUrl: localServerUrl
  }));
}

app.setName(APP_NAME);

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      app.setAboutPanelOptions({
        applicationName: APP_NAME,
        applicationVersion: app.getVersion(),
        copyright: 'Copyright (c) 2026 AKISATO',
        credits: 'Independent third-party tool. Not affiliated with Bangumi.'
      });
    }
    Menu.setApplicationMenu(null);
    await ensureDataDirs();
    registerIpc();
    await startLocalServer();
    createMainWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && localServerUrl) createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (localServer) localServer.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
