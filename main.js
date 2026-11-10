const { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, nativeTheme, screen, net, dialog, session } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { initializeDesktop } = require('./lib/startup-sequence');
const { normalizeWindowState } = require('./lib/window-state');

const APP_NAME = 'Bangumi 保管库';
const APP_ID = 'io.github.akisato.bangumi.vault';
const DATA_DIR_NAME = '资料库';
const IMAGES_DIR_NAME = '封面缓存';
const BACKUPS_DIR_NAME = '备份';
const LOGS_DIR_NAME = '日志';
const STATE_FILE_NAME = '收藏数据.json';
const COLLECTIONS_FILE_NAME = '收藏条目.json';
const DETAILS_FILE_NAME = '条目资料.json';
const TAGS_FILE_NAME = '标签数据.json';
const HISTORY_FILE_NAME = '变更历史.json';
const TIMELINE_FILE_NAME = '时间胶囊数据.json';
const WINDOW_STATE_FILE_NAME = '窗口状态.json';
const BLOGS_FILE_NAME = '用户日志.json';
const INDICES_FILE_NAME = '目录数据.json';
const INDEX_ITEMS_FILE_NAME = '目录条目.json';
const APP_USER_AGENT = 'AKISATO57/AKI-Bangumi-Vault/1.1.0 (https://github.com/AKISATO57/AKI-Bangumi-Vault)';
const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const MAX_CACHED_COVER_EDGE = 4096;
const CACHED_COVER_JPEG_QUALITY = 95;
const COVER_LAZY_OPTIMIZE_MIN_BYTES = 2 * 1024 * 1024;
const TIMELINE_REQUEST_INTERVAL_MS = 1250;
const IMAGE_REQUEST_INTERVAL_MS = 1250;
const RUNTIME_LOG_RETENTION_DAYS = 30;
const RUNTIME_LOG_BATCH_LIMIT = 120;
const STARTUP_LOG_FILE_NAME = 'startup.log';
let mainWindow = null;
let localServer = null;
let localServerUrl = '';
let dataDir = '';
let imagesDir = '';
let backupsDir = '';
let logsDir = '';
let stateFile = '';
let collectionsFile = '';
let detailsFile = '';
let tagsFile = '';
let historyFile = '';
let timelineFile = '';
let windowStateFile = '';
let blogsFile = '';
let indicesFile = '';
let indexItemsFile = '';
let startupLogFile = '';
let timelineNextRequestAt = 0;
let timelineRequestTail = Promise.resolve();
const imageRequestQueues = new Map();
let runtimeLogWriteTail = Promise.resolve();
let saveWindowStateTimer = null;
const coverOptimizationJobs = new Map();

function startupLog(stage, details = '') {
  if (!startupLogFile) return;
  try {
    const value = details instanceof Error
      ? (details.stack || details.message || String(details))
      : (typeof details === 'string' ? details : JSON.stringify(details));
    const suffix = value ? ` ${String(value).replace(/[\r\n]+/g, ' ').slice(0, 4000)}` : '';
    fs.mkdirSync(path.dirname(startupLogFile), { recursive: true });
    fs.appendFileSync(startupLogFile, `${new Date().toISOString()} pid=${process.pid} ${stage}${suffix}\n`, 'utf8');
  } catch {}
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

  // Portable builds extract the real Electron executable into a temporary
  // directory. electron-builder exposes the original folder through
  // PORTABLE_EXECUTABLE_DIR; prefer it so the offline library stays beside the
  // user's portable exe instead of being read from that temporary directory.
  const portableDir = String(process.env.PORTABLE_EXECUTABLE_DIR || '').trim();
  const executableDir = portableDir && path.isAbsolute(portableDir)
    ? portableDir
    : path.dirname(process.execPath);
  return path.join(executableDir, DATA_DIR_NAME);
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

async function restoreInterruptedInstallerVault() {
  if (!app.isPackaged) return;

  const protectedDir = `${dataDir}.__vault-upgrade-backup__`;
  try {
    await fsp.access(stateFile, fs.constants.F_OK);
    return;
  } catch {}

  try {
    await fsp.access(protectedDir, fs.constants.F_OK);
  } catch {
    return;
  }

  // The normal path is an atomic same-drive rename. A protected folder is
  // intentionally retained if that fails, so no interrupted update can erase
  // the only copy of a user's offline library.
  try {
    await fsp.rename(protectedDir, dataDir);
    return;
  } catch {}

  await copyDirIfExists(protectedDir, dataDir);
}

function configureDataPaths() {
  dataDir = chooseDataDir();
  imagesDir = path.join(dataDir, IMAGES_DIR_NAME);
  backupsDir = path.join(dataDir, BACKUPS_DIR_NAME);
  logsDir = path.join(dataDir, LOGS_DIR_NAME);
  stateFile = path.join(dataDir, STATE_FILE_NAME);
  collectionsFile = path.join(dataDir, COLLECTIONS_FILE_NAME);
  detailsFile = path.join(dataDir, DETAILS_FILE_NAME);
  tagsFile = path.join(dataDir, TAGS_FILE_NAME);
  historyFile = path.join(dataDir, HISTORY_FILE_NAME);
  timelineFile = path.join(dataDir, TIMELINE_FILE_NAME);
  windowStateFile = path.join(dataDir, WINDOW_STATE_FILE_NAME);
  blogsFile = path.join(dataDir, BLOGS_FILE_NAME);
  indicesFile = path.join(dataDir, INDICES_FILE_NAME);
  indexItemsFile = path.join(dataDir, INDEX_ITEMS_FILE_NAME);
  startupLogFile = path.join(logsDir, STARTUP_LOG_FILE_NAME);
}

async function ensureDataDirs() {
  if (!dataDir) configureDataPaths();
  startupLog('data-init:start');
  startupLog('installer-restore:start');
  await restoreInterruptedInstallerVault();
  startupLog('installer-restore:done');
  await fsp.mkdir(imagesDir, { recursive: true });
  await fsp.mkdir(backupsDir, { recursive: true });
  await fsp.mkdir(logsDir, { recursive: true });
  await pruneRuntimeLogs();
  startupLog('legacy-migration:start');
  await migrateLegacyVaultData();
  startupLog('legacy-migration:done');
  try {
    await fsp.access(stateFile, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(stateFile, '', 'utf8');
  }
  startupLog('data-init:done');
}

async function writeAtomic(filePath, body) {
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, body);
  await fsp.rename(tmp, filePath);
}

function runtimeLogFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}.jsonl`;
}

async function pruneRuntimeLogs() {
  try {
    const names = (await fsp.readdir(logsDir))
      .filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/i.test(name))
      .sort();
    const stale = names.slice(0, Math.max(0, names.length - RUNTIME_LOG_RETENTION_DAYS));
    await Promise.all(stale.map(name => fsp.unlink(path.join(logsDir, name)).catch(() => {})));
  } catch {}
}

function runtimeLogEntries(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries.slice(-RUNTIME_LOG_BATCH_LIMIT).map(entry => ({
    time: String(entry?.time || new Date().toISOString()).slice(0, 64),
    channel: String(entry?.channel || 'app').slice(0, 32),
    level: String(entry?.level || 'info').slice(0, 16),
    message: String(entry?.message || '').replace(/[\r\n]+/g, ' ').slice(0, 2000)
  })).filter(entry => entry.message);
}

function appendRuntimeLogs(entries) {
  if (!entries.length || !logsDir) return Promise.resolve();
  const write = runtimeLogWriteTail.then(async () => {
    const lines = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    await fsp.appendFile(path.join(logsDir, runtimeLogFileName()), lines, 'utf8');
  });
  runtimeLogWriteTail = write.catch(() => {});
  return write;
}

function writeWindowState(win) {
  if (!win || win.isDestroyed() || !windowStateFile) return;
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  const payload = {
    version: 1,
    bounds,
    maximized: win.isMaximized(),
    updated_at: new Date().toISOString()
  };
  try {
    const tmp = `${windowStateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, windowStateFile);
  } catch {}
}

function scheduleWindowStateSave(win) {
  clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => writeWindowState(win), 260);
}

function savedWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
    const primary = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays();
    const workAreas = [
      primary.workArea,
      ...displays.filter(display => display.id !== primary.id).map(display => display.workArea)
    ];
    return normalizeWindowState(saved, workAreas);
  } catch {
    return null;
  }
}

function queueTimelineRequest(task) {
  const job = timelineRequestTail.then(async () => {
    const wait = Math.max(0, timelineNextRequestAt - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    timelineNextRequestAt = Date.now() + TIMELINE_REQUEST_INTERVAL_MS;
    return task();
  });
  timelineRequestTail = job.catch(() => {});
  return job;
}

function queueImageRequest(remoteUrl, task) {
  let host;
  try { host = new URL(remoteUrl).host.toLowerCase(); } catch { host = 'invalid'; }
  const state = imageRequestQueues.get(host) || { nextAt: 0, tail: Promise.resolve() };
  const job = state.tail.then(async () => {
    const wait = Math.max(0, state.nextAt - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    state.nextAt = Date.now() + IMAGE_REQUEST_INTERVAL_MS;
    return task();
  });
  state.tail = job.catch(() => {});
  imageRequestQueues.set(host, state);
  return job;
}

function timeCapsulePageUrl(siteBase, username, page) {
  const base = new URL(String(siteBase || 'https://bgm.tv'));
  if (!/^https?:$/.test(base.protocol)) throw new Error('时间胶囊地址必须使用 HTTP 或 HTTPS');
  const name = String(username || '').trim();
  if (!name || name.length > 120) throw new Error('Bangumi 用户名无效');
  const target = new URL(`/user/${encodeURIComponent(name)}/timeline`, base.origin);
  target.searchParams.set('type', 'all');
  target.searchParams.set('page', String(Math.max(1, Number(page) || 1)));
  return target.toString();
}

function userContentPageUrl(kind, username, siteBaseValue, page, indexId, blogId) {
  const base = new URL(String(siteBaseValue || 'https://bgm.tv'));
  if (!/^https?:$/.test(base.protocol)) throw new Error('站点地址必须使用 HTTP 或 HTTPS');
  const name = String(username || '').trim();
  const pageNum = Math.max(1, Number(page) || 1);
  const requireName = () => {
    if (!name || name.length > 120) throw new Error('Bangumi 用户名无效');
    return encodeURIComponent(name);
  };
  const numeric = (value, label) => {
    const s = String(value || '').trim();
    if (!/^\d{1,12}$/.test(s)) throw new Error(`${label}无效`);
    return s;
  };
  const slug = (value, label) => {
    const s = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(s)) throw new Error(`${label}无效`);
    return encodeURIComponent(s);
  };
  let target;
  switch (String(kind || '')) {
    case 'blog': target = new URL(`/user/${requireName()}/blog`, base.origin); break;
    case 'blog-detail': target = new URL(`/blog/${numeric(blogId, '日志 ID')}`, base.origin); break;
    case 'group-detail': target = new URL(`/group/${slug(blogId, '小组 ID')}`, base.origin); break;
    case 'group-topic-detail': target = new URL(`/group/topic/${numeric(blogId, '小组话题 ID')}`, base.origin); break;
    case 'subject-topic-detail': target = new URL(`/subject/topic/${numeric(blogId, '条目话题 ID')}`, base.origin); break;
    case 'character-detail': target = new URL(`/character/${numeric(blogId, '角色 ID')}`, base.origin); break;
    case 'person-detail': target = new URL(`/person/${numeric(blogId, '人物 ID')}`, base.origin); break;
    case 'episode-detail': target = new URL(`/ep/${numeric(blogId, '章节 ID')}`, base.origin); break;
    case 'index-created': target = new URL(`/user/${requireName()}/index`, base.origin); break;
    case 'index-collected': target = new URL(`/user/${requireName()}/index/collect`, base.origin); break;
    case 'index-detail': target = new URL(`/index/${numeric(indexId, '目录 ID')}`, base.origin); break;
    case 'index-comments': target = new URL(`/index/${numeric(indexId, '目录 ID')}/comments`, base.origin); break;
    default: throw new Error(`未知的页面类型：${String(kind || '')}`);
  }
  if (pageNum > 1) target.searchParams.set('page', String(pageNum));
  return target.toString();
}

function resolvePageUrl(raw, base) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try { return new URL(value, base || 'https://bgm.tv').toString(); } catch { return ''; }
}

function parseUserProfilePage(html, siteBaseValue) {
  const source = String(html || '');
  const out = {};
  const name = source.match(/<h1[^>]*class="[^"]*nameSingle[^"]*"[^>]*>[\s\S]{0,400}?<a[^>]*>([\s\S]*?)<\/a>/i);
  if (name) out.nickname = stripTags(name[1]).slice(0, 120);
  const uname = source.match(/<small[^>]*class="[^"]*grey[^"]*"[^>]*>\s*@([^<\s]{1,120})\s*<\/small>/i);
  if (uname) out.username = decodeHtmlEntity(uname[1]).trim();
  let avatar = '';
  const bgAvatar = source.match(/background-image:\s*url\(['"]?([^'")]*\/pic\/user\/[^'")]+)['"]?\)/i);
  if (bgAvatar) avatar = bgAvatar[1];
  if (!avatar) {
    const imgAvatar = source.match(/<img[^>]*src=["']([^"']*\/pic\/user\/[^"']+)["'][^>]*>/i);
    if (imgAvatar) avatar = imgAvatar[1];
  }
  if (avatar) out.avatar = resolvePageUrl(decodeHtmlEntity(avatar), siteBaseValue);
  const bio = source.match(/<div[^>]*class="[^"]*\bbio\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || source.match(/<div[^>]*id=["']user_intro["'][^>]*>([\s\S]*?)<\/div>/i);
  if (bio) {
    out.intro = decodeHtmlEntity(
      bio[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
    ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  }
  const joined = source.match(/(\d{4}-\d{1,2}-\d{1,2})\s*加入/);
  if (joined) out.joined_at = joined[1];
  return out;
}

function parseUserMonoPage(html, siteBaseValue, kind) {
  const source = String(html || '');
  const entity = kind === 'person' ? 'person' : 'character';
  const pattern = new RegExp(`href=["'](?:https?:[^"']*)?/${entity}/(\\d+)["']`, 'gi');
  const items = [];
  const seen = new Set();
  let match;
  while ((match = pattern.exec(source)) && items.length < 96) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const windowStart = Math.max(0, match.index - 900);
    const context = source.slice(windowStart, match.index + 900);
    const anchorPos = match.index - windowStart;
    let image = '';
    // 取距离链接最近的一张 /pic/crt/ 图，避免相邻条目的头像串位。
    let bestDistance = Infinity;
    const imagePattern = /background-image:\s*url\(['"]?([^'")]*\/pic\/crt\/[^'")]+)['"]?\)|<img[^>]*src=["']([^"']*\/pic\/crt\/[^"']+)["']/gi;
    let imageMatch;
    while ((imageMatch = imagePattern.exec(context))) {
      const distance = Math.abs(imageMatch.index - anchorPos);
      if (distance < bestDistance) {
        bestDistance = distance;
        image = resolvePageUrl(decodeHtmlEntity(imageMatch[1] || imageMatch[2] || ''), siteBaseValue);
      }
    }
    let name = '';
    const link = context.match(new RegExp(`<a[^>]*href=["'][^"']*/${entity}/${id}["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi'));
    if (link) {
      for (const one of link) {
        const text = stripTags(one.replace(/^<a[^>]*>/i, '').replace(/<\/a>$/i, ''));
        if (text && text.length <= 120) { name = text; if (!/^\d+$/.test(text)) break; }
      }
    }
    items.push({ id: Number(id), name, image, url: resolvePageUrl(`/${entity}/${id}`, siteBaseValue) });
  }
  return items.filter(item => item.name || item.image);
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

function preferredAppearance(savedState = null) {
  let state = savedState;
  if (!state) {
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  }
  let mode = String(state?.settings?.themeMode || state?.settings?.theme || 'system').toLowerCase();
  if (!['light', 'dark', 'system'].includes(mode)) mode = 'system';
  const dark = mode === 'dark' || (mode === 'system' && !!nativeTheme.shouldUseDarkColors);
  const theme = dark ? 'dark' : 'light';
  return {
    mode,
    theme,
    backgroundColor: dark ? '#10111a' : '#f6f4fb',
    symbolColor: titleBarOverlayOptions(theme).symbolColor
  };
}

function titleBarOverlayOptions(theme) {
  return {
    color: '#00000000',
    symbolColor: theme === 'light' ? '#5b5368' : '#f7f3ff',
    height: 36
  };
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
    case '.avif': return 'image/avif';
    case '.bmp': return 'image/bmp';
    case '.ico': return 'image/x-icon';
    case '.svg': return 'image/svg+xml';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8', cacheControl = 'no-store') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(bytes);
}

async function sendFile(res, filePath, contentType, cacheControl = 'no-store') {
  try {
    const bytes = await fsp.readFile(filePath);
    send(res, 200, bytes, contentType || mimeByExt(filePath), cacheControl);
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
  if (type.includes('avif')) return '.avif';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('svg')) return '.svg';
  if (type.includes('bmp')) return '.bmp';
  if (type.includes('icon')) return '.ico';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  try {
    const ext = path.extname(new URL(remoteUrl).pathname).toLowerCase();
    if (['.png', '.webp', '.gif', '.jpg', '.jpeg', '.avif', '.svg', '.bmp', '.ico'].includes(ext)) return ext;
  } catch {}
  return '.jpg';
}

function sniffImageExt(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return '.gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/i.test(buffer.subarray(8, 32).toString('ascii'))) return '.avif';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return '.bmp';
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return '.ico';
  if (/^(?:\uFEFF|\s)*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(buffer.subarray(0, 4096).toString('utf8'))) return '.svg';
  return '';
}

function validateDownloadedImage(downloaded) {
  const buffer = downloaded?.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Image response was empty');
  if (buffer.length > 32 * 1024 * 1024) throw new Error('Image exceeds the 32 MB cache limit');
  const ext = sniffImageExt(buffer);
  if (!ext) throw new Error(`Response is not a supported image (${downloaded?.contentType || 'unknown content type'})`);
  return ext;
}

async function findExistingCachedImage(sid) {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.ico', '.svg']) {
    const file = `${sid}${ext}`;
    const target = path.join(imagesDir, file);
    try {
      const stat = await fsp.stat(target);
      if (stat.isFile() && stat.size > 0) return { file, target };
    } catch {}
  }
  return null;
}

function normalizeContentType(headers) {
  if (!headers) return '';
  const direct = headers['content-type'] || headers['Content-Type'];
  if (Array.isArray(direct)) return direct[0] || '';
  return direct || '';
}

function cachedCoverExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.jpg', '.jpeg', '.png'].includes(ext) ? ext : '';
}

function cachedCoverDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  // PNG: the IHDR width/height fields are fixed at offsets 16 and 20.
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG: scan marker segments until a Start Of Frame marker is found.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    const sofMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3,
      0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb,
      0xcd, 0xce, 0xcf
    ]);
    while (offset + 4 <= buffer.length) {
      while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) break;
      const marker = buffer[offset++];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      if (sofMarkers.has(marker) && segmentLength >= 7) {
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += segmentLength;
    }
  }

  return null;
}

async function readCachedCoverDimensions(filePath, fileSize) {
  const probeSize = Math.min(Math.max(Number(fileSize) || 0, 24), 256 * 1024);
  const handle = await fsp.open(filePath, 'r');
  try {
    const probe = Buffer.allocUnsafe(probeSize);
    const { bytesRead } = await handle.read(probe, 0, probeSize, 0);
    return cachedCoverDimensions(probe.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function optimizeCachedCoverBuffer(buffer, ext, knownDimensions = null) {
  const supportedExt = cachedCoverExtension(`cover${ext}`);
  if (!supportedExt || !Buffer.isBuffer(buffer) || !buffer.length) {
    return { optimized: false, buffer, reason: 'unsupported' };
  }

  let dimensions = knownDimensions || cachedCoverDimensions(buffer);
  if (dimensions && Math.max(dimensions.width, dimensions.height) <= MAX_CACHED_COVER_EDGE) {
    return { optimized: false, buffer, dimensions, reason: 'within-limit' };
  }

  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) return { optimized: false, buffer, dimensions, reason: 'decode-failed' };
  dimensions = image.getSize();
  const longestEdge = Math.max(dimensions.width, dimensions.height);
  if (!Number.isFinite(longestEdge) || longestEdge <= MAX_CACHED_COVER_EDGE) {
    return { optimized: false, buffer, dimensions, reason: 'within-limit' };
  }

  const resizeOptions = dimensions.width >= dimensions.height
    ? { width: MAX_CACHED_COVER_EDGE, quality: 'best' }
    : { height: MAX_CACHED_COVER_EDGE, quality: 'best' };
  const resized = image.resize(resizeOptions);
  if (resized.isEmpty()) return { optimized: false, buffer, dimensions, reason: 'resize-failed' };
  const target = resized.getSize();

  const output = supportedExt === '.png'
    ? resized.toPNG()
    : resized.toJPEG(CACHED_COVER_JPEG_QUALITY);
  if (!output?.length) return { optimized: false, buffer, dimensions, reason: 'encode-failed' };

  return {
    optimized: true,
    buffer: output,
    dimensions,
    target
  };
}

async function replaceFileSafely(filePath, buffer) {
  const tempPath = `${filePath}.opt-${process.pid}-${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, buffer);
  try {
    await fsp.rename(tempPath, filePath);
  } catch (renameError) {
    try {
      await fsp.copyFile(tempPath, filePath);
      await fsp.unlink(tempPath).catch(() => {});
    } catch (copyError) {
      await fsp.unlink(tempPath).catch(() => {});
      throw copyError || renameError;
    }
  }
}

async function performCachedCoverOptimization(filePath) {
  const ext = cachedCoverExtension(filePath);
  if (!ext) return { optimized: false, reason: 'unsupported' };

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return { optimized: false, reason: 'missing' };
  }
  if (!stat.isFile()) return { optimized: false, reason: 'not-file' };

  let dimensions = null;
  try {
    dimensions = await readCachedCoverDimensions(filePath, stat.size);
  } catch {}
  if (dimensions && Math.max(dimensions.width, dimensions.height) <= MAX_CACHED_COVER_EDGE) {
    return { optimized: false, reason: 'within-limit', dimensions };
  }

  const original = await fsp.readFile(filePath);
  const result = optimizeCachedCoverBuffer(original, ext, dimensions);
  if (!result.optimized) return result;
  await replaceFileSafely(filePath, result.buffer);
  return {
    ...result,
    originalBytes: original.length,
    optimizedBytes: result.buffer.length
  };
}

function optimizeCachedCoverFile(filePath) {
  const key = path.resolve(filePath);
  const existing = coverOptimizationJobs.get(key);
  if (existing) return existing;
  const job = performCachedCoverOptimization(key)
    .catch(error => ({ optimized: false, reason: 'error', error }))
    .finally(() => coverOptimizationJobs.delete(key));
  coverOptimizationJobs.set(key, job);
  return job;
}

async function optimizeExistingOversizedCovers() {
  let entries = [];
  try {
    entries = await fsp.readdir(imagesDir, { withFileTypes: true });
  } catch {
    return;
  }

  let optimizedCount = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d+\.(?:jpe?g|png)$/i.test(entry.name)) continue;
    const result = await optimizeCachedCoverFile(path.join(imagesDir, entry.name));
    if (result.optimized) {
      optimizedCount += 1;
      console.log(
        `[cover-cache] optimized ${entry.name}: ` +
        `${result.dimensions.width}x${result.dimensions.height} -> ${result.target.width}x${result.target.height}`
      );
    }
    // Keep the background maintenance pass from monopolizing the event loop.
    await new Promise(resolve => setTimeout(resolve, 8));
  }
  if (optimizedCount > 0) console.log(`[cover-cache] optimized ${optimizedCount} oversized cover(s)`);
}

function downloadBufferViaNode(remoteUrl, redirectsLeft = 5, referer = '') {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(remoteUrl); } catch (err) { reject(err); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': APP_USER_AGENT,
      'Accept': IMAGE_ACCEPT,
      'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6',
      'Cache-Control': 'no-cache'
    };
    if (referer) headers.Referer = referer;
    const req = client.request(parsed, {
      method: 'GET',
      headers,
      timeout: 30000
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        downloadBufferViaNode(next, redirectsLeft - 1, referer).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: normalizeContentType(res.headers) }));
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

function downloadBufferViaElectronNet(remoteUrl, redirectsLeft = 5, referer = 'https://bgm.tv/') {
  return new Promise((resolve, reject) => {
    if (!net || typeof net.request !== 'function') {
      reject(new Error('Electron net is unavailable'));
      return;
    }
    const req = net.request({ method: 'GET', url: remoteUrl, useSessionCookies: false });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req.abort(); } catch {}
      reject(new Error('Request timeout'));
    }, 30000);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    try {
      req.setHeader('User-Agent', APP_USER_AGENT);
      if (referer) req.setHeader('Referer', referer);
      req.setHeader('Accept', IMAGE_ACCEPT);
      req.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6');
      req.setHeader('Cache-Control', 'no-cache');
    } catch {}
    req.on('redirect', (statusCode, method, redirectUrl) => {
      if (redirectsLeft > 0) {
        try { req.followRedirect(); } catch {}
      } else {
        finish(reject, new Error(`Too many redirects: ${statusCode} ${redirectUrl || ''}`.trim()));
        try { req.abort(); } catch {}
      }
    });
    req.on('response', res => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        res.resume();
        finish(reject, new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => finish(resolve, { buffer: Buffer.concat(chunks), contentType: normalizeContentType(res.headers) }));
      res.on('error', err => finish(reject, err));
    });
    req.on('error', err => finish(reject, err));
    req.end();
  });
}

async function downloadBuffer(remoteUrl, referer = 'https://bgm.tv/') {
  try {
    // Prefer Chromium's network stack. It matches the in-app preview path better than Node's https module
    // and respects the user's system proxy / TLS / DNS behavior.
    return await downloadBufferViaElectronNet(remoteUrl, 5, referer);
  } catch (electronErr) {
    try {
      // Some third-party hosts reject hotlink referers. The fallback deliberately
      // retries without one while keeping the same image-oriented request headers.
      await new Promise(resolve => setTimeout(resolve, IMAGE_REQUEST_INTERVAL_MS));
      return await downloadBufferViaNode(remoteUrl, 5, '');
    } catch (nodeErr) {
      const msg = `${electronErr?.message || electronErr}; fallback: ${nodeErr?.message || nodeErr}`;
      throw new Error(msg);
    }
  }
}


function downloadTextViaNode(remoteUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(remoteUrl); } catch (err) { reject(err); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': APP_USER_AGENT,
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
        downloadTextViaNode(next, redirectsLeft - 1).then(resolve, reject);
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

function downloadTextViaElectronNet(remoteUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!net || typeof net.request !== 'function') {
      reject(new Error('Electron net is unavailable'));
      return;
    }
    const req = net.request({ method: 'GET', url: remoteUrl, useSessionCookies: false });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { req.abort(); } catch {}
      reject(new Error('Request timeout'));
    }, 30000);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    try {
      req.setHeader('User-Agent', APP_USER_AGENT);
      req.setHeader('Referer', 'https://bgm.tv/');
      req.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      req.setHeader('Accept-Language', 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.6');
    } catch {}
    req.on('redirect', (statusCode, method, redirectUrl) => {
      if (redirectsLeft > 0) {
        try { req.followRedirect(); } catch {}
      } else {
        finish(reject, new Error(`Too many redirects: ${statusCode} ${redirectUrl || ''}`.trim()));
        try { req.abort(); } catch {}
      }
    });
    req.on('response', res => {
      const status = res.statusCode || 0;
      if (status < 200 || status >= 300) {
        res.resume();
        finish(reject, new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
      res.on('error', err => finish(reject, err));
    });
    req.on('error', err => finish(reject, err));
    req.end();
  });
}

async function downloadText(remoteUrl) {
  try {
    return await downloadTextViaElectronNet(remoteUrl);
  } catch (electronErr) {
    try {
      return await downloadTextViaNode(remoteUrl);
    } catch (nodeErr) {
      throw new Error(`${electronErr?.message || electronErr}; fallback: ${nodeErr?.message || nodeErr}`);
    }
  }
}

function decodeHtmlEntity(text) {
  const codePoint = (n) => {
    // 修复：超出 BMP 的字符（如部分 Emoji）需要 fromCodePoint；无效码点回退为空。
    try { return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; } catch { return ''; }
  };
  return String(text || '')
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
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
    // 把界面版本注入页面，首帧即按用户选择渲染（避免先闪旧版再重载）。
    try {
      let page = await fsp.readFile(appHtmlPath(), 'utf8');
      // 1.0 起默认新界面（玻璃拟态）；只有 schema ≥ 18 的存档里明确选了经典界面才回落。
      // schema < 18 是 1.0 之前的旧存档，其中的 classic 只是当时的默认值，一次性翻到新界面。
      let ui = 'lg26';
      let savedState = null;
      try {
        savedState = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
        if (savedState && savedState.settings && Number(savedState.schema || 0) >= 18 && savedState.settings.uiVersion === 'classic') ui = 'classic';
      } catch {}
      const appearance = preferredAppearance(savedState);
      page = page.replace(/<html\b([^>]*)>/i, (_tag, attributes) => {
        const clean = String(attributes || '')
          .replace(/\sdata-theme=(?:"[^"]*"|'[^']*')/gi, '')
          .replace(/\sdata-theme-mode=(?:"[^"]*"|'[^']*')/gi, '')
          .replace(/\sdata-theme-ready=(?:"[^"]*"|'[^']*')/gi, '');
        return `<html${clean} data-theme="${appearance.theme}" data-theme-mode="${appearance.mode}" data-theme-ready="1">`;
      });
      page = page.replace('<body>', `<body>\n<script>window.BANGUMI_VAULT_PREFERRED_UI=${JSON.stringify(ui)};</script>`);
      send(res, 200, page, 'text/html; charset=utf-8');
    } catch {
      await sendFile(res, appHtmlPath(), 'text/html; charset=utf-8');
    }
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
    await writeAtomic(stateFile, body);
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/collections') {
    try {
      const stat = await fsp.stat(collectionsFile);
      if (stat.size <= 0) send(res, 204, '', 'application/json; charset=utf-8');
      else await sendFile(res, collectionsFile, 'application/json; charset=utf-8');
    } catch {
      send(res, 204, '', 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/collections') {
    await writeAtomic(collectionsFile, await readBody(req));
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/details') {
    try {
      const stat = await fsp.stat(detailsFile);
      if (stat.size <= 0) send(res, 204, '', 'application/json; charset=utf-8');
      else await sendFile(res, detailsFile, 'application/json; charset=utf-8');
    } catch {
      send(res, 204, '', 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/details') {
    await writeAtomic(detailsFile, await readBody(req));
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tags') {
    try {
      const stat = await fsp.stat(tagsFile);
      if (stat.size <= 0) send(res, 204, '', 'application/json; charset=utf-8');
      else await sendFile(res, tagsFile, 'application/json; charset=utf-8');
    } catch {
      send(res, 204, '', 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tags') {
    await writeAtomic(tagsFile, await readBody(req));
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/history') {
    try {
      const stat = await fsp.stat(historyFile);
      if (stat.size <= 0) send(res, 204, '', 'application/json; charset=utf-8');
      else await sendFile(res, historyFile, 'application/json; charset=utf-8');
    } catch {
      send(res, 204, '', 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/history') {
    await writeAtomic(historyFile, await readBody(req));
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/timeline-cache') {
    try {
      const stat = await fsp.stat(timelineFile);
      if (stat.size <= 0) send(res, 204, '', 'application/json; charset=utf-8');
      else await sendFile(res, timelineFile, 'application/json; charset=utf-8');
    } catch {
      send(res, 204, '', 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/timeline-cache') {
    await writeAtomic(timelineFile, await readBody(req));
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && pathname === '/api/runtime-log') {
    let payload = {};
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      send(res, 400, JSON.stringify({ ok: false, error: 'invalid log payload' }), 'application/json; charset=utf-8');
      return;
    }
    const entries = runtimeLogEntries(payload);
    await appendRuntimeLogs(entries);
    send(res, 200, JSON.stringify({ ok: true, written: entries.length }), 'application/json; charset=utf-8');
    return;
  }

  // ---- 时光机数据缓存：用户日志 / 目录列表 / 目录条目（v0.31.2 渲染层依赖）----
  const jsonCacheRoutes = {
    '/api/blog-cache': () => blogsFile,
    '/api/index-cache': () => indicesFile,
    '/api/index-items-cache': () => indexItemsFile
  };
  if (jsonCacheRoutes[pathname]) {
    const file = jsonCacheRoutes[pathname]();
    if (req.method === 'GET') {
      try {
        const stat = await fsp.stat(file);
        if (stat.size <= 0) send(res, 204, '', 'application/json; charset=utf-8');
        else await sendFile(res, file, 'application/json; charset=utf-8');
      } catch {
        send(res, 204, '', 'application/json; charset=utf-8');
      }
      return;
    }
    if (req.method === 'POST') {
      await writeAtomic(file, await readBody(req));
      send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/user-content-page') {
    const q = requestUrl.searchParams;
    try {
      const sourceUrl = userContentPageUrl(q.get('kind'), q.get('username'), q.get('siteBase'), q.get('page'), q.get('indexId'), q.get('blogId'));
      const html = await queueTimelineRequest(() => downloadText(sourceUrl));
      if (!String(html || '').trim()) {
        send(res, 200, JSON.stringify({ ok: false, error: 'Bangumi 页面返回为空' }), 'application/json; charset=utf-8');
        return;
      }
      send(res, 200, JSON.stringify({ ok: true, page: Number(q.get('page')) || 1, html }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 200, JSON.stringify({ ok: false, error: err?.message || String(err) }), 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/user-profile') {
    const q = requestUrl.searchParams;
    try {
      const username = String(q.get('username') || '').trim();
      if (!username || username.length > 120) throw new Error('Bangumi 用户名无效');
      const base = new URL(String(q.get('siteBase') || 'https://bgm.tv'));
      if (!/^https?:$/.test(base.protocol)) throw new Error('站点地址必须使用 HTTP 或 HTTPS');
      const pageUrl = new URL(`/user/${encodeURIComponent(username)}`, base.origin).toString();
      const html = await queueTimelineRequest(() => downloadText(pageUrl));
      const profile = parseUserProfilePage(html, base.origin);
      send(res, 200, JSON.stringify({ ok: true, username, ...profile }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 200, JSON.stringify({ ok: false, error: err?.message || String(err) }), 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'GET' && ['/api/user-characters', '/api/user-persons', '/api/user-people'].includes(pathname)) {
    const q = requestUrl.searchParams;
    try {
      const username = String(q.get('username') || '').trim();
      if (!username || username.length > 120) throw new Error('Bangumi 用户名无效');
      const base = new URL(String(q.get('siteBase') || 'https://bgm.tv'));
      if (!/^https?:$/.test(base.protocol)) throw new Error('站点地址必须使用 HTTP 或 HTTPS');
      const kind = pathname === '/api/user-characters' && String(q.get('kind') || '') !== 'person' ? 'character' : 'person';
      const pageUrl = new URL(`/user/${encodeURIComponent(username)}/mono/${kind}`, base.origin).toString();
      const html = await queueTimelineRequest(() => downloadText(pageUrl));
      const list = parseUserMonoPage(html, base.origin, kind);
      send(res, 200, JSON.stringify({ ok: true, kind, characters: list, persons: list }), 'application/json; charset=utf-8');
    } catch (err) {
      send(res, 200, JSON.stringify({ ok: false, error: err?.message || String(err) }), 'application/json; charset=utf-8');
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/timeline-page') {
    const username = requestUrl.searchParams.get('username');
    const siteBase = requestUrl.searchParams.get('siteBase');
    const page = requestUrl.searchParams.get('page');
    const sourceUrl = timeCapsulePageUrl(siteBase, username, page);
    const html = await queueTimelineRequest(() => downloadText(sourceUrl));
    send(res, 200, JSON.stringify({ ok: true, page: Number(page) || 1, html }), 'application/json; charset=utf-8');
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
    let parsedRemote;
    try { parsedRemote = new URL(remoteUrl); } catch {
      send(res, 400, JSON.stringify({ ok: false, error: 'invalid image url' }), 'application/json; charset=utf-8');
      return;
    }
    if (!['http:', 'https:'].includes(parsedRemote.protocol)) {
      send(res, 400, JSON.stringify({ ok: false, error: 'image url must use http or https' }), 'application/json; charset=utf-8');
      return;
    }
    if (!body.force) {
      const existing = await findExistingCachedImage(sid);
      if (existing) {
        send(res, 200, JSON.stringify({
          ok: true,
          url: `/images/${existing.file}`,
          file: `${IMAGES_DIR_NAME}/${existing.file}`,
          reused: true
        }), 'application/json; charset=utf-8');
        return;
      }
    }
    const downloaded = await queueImageRequest(
      parsedRemote.href,
      () => downloadBuffer(parsedRemote.href, String(body.referer || 'https://bgm.tv/'))
    );
    let ext = validateDownloadedImage(downloaded) || guessImageExt(downloaded.contentType, parsedRemote.href);
    let imageBytes = downloaded.buffer;
    if (ext === '.svg') {
      const decoded = nativeImage.createFromBuffer(imageBytes);
      if (decoded.isEmpty()) throw new Error('SVG image could not be decoded');
      imageBytes = decoded.toPNG();
      ext = '.png';
    }
    const file = `${sid}${ext}`;
    const target = path.join(imagesDir, file);
    const optimized = optimizeCachedCoverBuffer(imageBytes, ext);
    await replaceFileSafely(target, optimized.optimized ? optimized.buffer : imageBytes);
    send(res, 200, JSON.stringify({
      ok: true,
      url: `/images/${file}`,
      file: `${IMAGES_DIR_NAME}/${file}`,
      optimized: !!optimized.optimized
    }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/images/')) {
    const file = safeName(path.basename(pathname.slice('/images/'.length)));
    const target = path.join(imagesDir, file);
    if (/^\d+\.(?:jpe?g|png)$/i.test(file)) {
      try {
        const stat = await fsp.stat(target);
        if (stat.size >= COVER_LAZY_OPTIMIZE_MIN_BYTES) await optimizeCachedCoverFile(target);
      } catch {}
    }
    await sendFile(res, target, mimeByExt(file), 'private, max-age=31536000, immutable');
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

function preferredServerPort() {
  // 由资料库路径推导出稳定端口：origin 固定后 localStorage / IndexedDB
  // （界面版本记忆、封面缓存等）才能跨启动保留。
  const s = String(dataDir || 'bangumi-vault');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 21000 + (Math.abs(h) % 20000);
}

async function clearRetiredBangumiLoginSession() {
  const retiredSession = session.fromPartition('persist:bangumi-vault-site', { cache: true });
  await retiredSession.clearStorageData();
  await retiredSession.clearCache();
}

function startLocalServer() {
  startupLog('server:start', { preferredPort: preferredServerPort() });
  return new Promise((resolve, reject) => {
    localServer = http.createServer((req, res) => {
      handleRequest(req, res).catch(err => {
        send(res, 500, JSON.stringify({ ok: false, error: err.message || String(err) }), 'application/json; charset=utf-8');
      });
    });
    // 首选端口失败时一律回退到随机端口再试一次：某些机器上 Windows 会保留
    // 大段 TCP 端口（Hyper-V / WSL），或被安全软件拦掉，错误码不只 EADDRINUSE。
    let fellBack = false;
    localServer.on('error', (err) => {
      if (!fellBack) {
        fellBack = true;
        console.warn('[server] preferred port failed, falling back:', err?.code || err?.message || err);
        startupLog('server:fallback', { code: err?.code, message: err?.message });
        try { localServer.listen(0, '127.0.0.1'); return; } catch (e) { reject(e); return; }
      }
      startupLog('server:failed', err);
      reject(err);
    });
    localServer.on('listening', () => {
      const address = localServer.address();
      localServerUrl = `http://127.0.0.1:${address.port}/`;
      startupLog('server:listening', { url: localServerUrl, usedFallback: fellBack });
      resolve(localServerUrl);
    });
    localServer.listen(preferredServerPort(), '127.0.0.1');
  });
}

function createMainWindow() {
  const isMac = process.platform === 'darwin';
  const iconImage = nativeImage.createFromPath(windowIconPath());
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const adaptiveWidth = Math.max(1120, Math.min(1560, Math.round(workArea.width * 0.84)));
  const adaptiveHeight = Math.max(720, Math.min(940, Math.round(workArea.height * 0.86)));
  const saved = savedWindowState();
  const savedBounds = saved?.bounds;
  const appearance = preferredAppearance();
  mainWindow = new BrowserWindow({
    width: savedBounds?.width || adaptiveWidth,
    height: savedBounds?.height || adaptiveHeight,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    frame: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: appearance.backgroundColor,
    ...(process.platform === 'win32' ? {
      titleBarOverlay: titleBarOverlayOptions(appearance.theme)
    } : {}),
    icon: iconImage,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      // 与上面的命令行开关配套：窗口被判定为不可见时不要节流定时器与动画帧。
      backgroundThrottling: false
    }
  });
  const win = mainWindow;

  if (process.platform === 'win32' && !iconImage.isEmpty()) {
    win.setIcon(iconImage);
  }

  win.webContents.session.setUserAgent(APP_USER_AGENT);

  // 应用菜单被移除（Menu.setApplicationMenu(null)），默认的重新载入 / 开发者工具
  // 快捷键也随之失效。这里补回最常用的两组，方便排查界面问题而不必整个重启。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    const wc = win.webContents;
    if (!wc) return;
    if ((mod && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      event.preventDefault();
      wc.reloadIgnoringCache();
      return;
    }
    if ((mod && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      event.preventDefault();
      wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' });
    }
  });

  const notifyWindowState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('window:state', { maximized: win.isMaximized() });
  };
  win.on('resize', () => scheduleWindowStateSave(win));
  win.on('move', () => scheduleWindowStateSave(win));
  win.on('maximize', () => { scheduleWindowStateSave(win); notifyWindowState(); });
  win.on('unmaximize', () => { scheduleWindowStateSave(win); notifyWindowState(); });
  win.on('close', () => writeWindowState(win));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on('did-finish-load', () => startupLog('page:loaded', { url: win.webContents.getURL() }));
  win.webContents.on('render-process-gone', (_event, details) => {
    startupLog('renderer:gone', details);
    showMainWindow(win);
  });
  win.on('unresponsive', () => startupLog('window:unresponsive'));
  win.on('responsive', () => startupLog('window:responsive'));
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.error('[window] load failed:', code, desc, url);
    startupLog('page:load-failed', { code, description: desc, url });
    showMainWindow(win);
    dialog.showErrorBox(APP_NAME, `页面加载失败（${code} ${desc}）\n${url}\n\n可以按 Ctrl+R 重试，或反馈这条错误信息。`);
  });

  // Create and reveal the native window before any migration, disk scan, or
  // server startup can stall. The background color acts as the startup view.
  if (!saved) win.center();
  if (saved?.maximized) win.maximize();
  win.show();
  notifyWindowState();
  startupLog('window:shown', { bounds: win.getBounds(), maximized: win.isMaximized() });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

async function loadMainPage(win = mainWindow) {
  if (!win || win.isDestroyed() || !localServerUrl) return;
  startupLog('page:load-start', { url: localServerUrl });
  try {
    await win.loadURL(localServerUrl);
  } catch (error) {
    // did-fail-load presents the actionable error. Keep the visible window and
    // server alive so Ctrl+R can retry instead of turning a load error into a
    // silent single-instance process on the next launch.
    console.error('[window] load promise rejected:', error);
    startupLog('page:load-rejected', error);
    showMainWindow(win);
  }
}

function showMainWindow(win = mainWindow) {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return true;
}

function recreateMainWindow() {
  const win = createMainWindow();
  loadMainPage(win).catch(error => {
    console.error('[window] reload failed:', error);
    startupLog('page:reload-failed', error);
  });
  return win;
}

function registerIpc() {
  ipcMain.handle('window:minimize', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });
  ipcMain.handle('window:toggle-maximize', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const maximize = !win.isMaximized();
    if (maximize) win.maximize(); else win.unmaximize();
    return maximize;
  });
  ipcMain.handle('window:get-state', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return { maximized: !!win?.isMaximized() };
  });
  ipcMain.handle('window:set-theme', (event, requestedTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const theme = requestedTheme === 'light' || requestedTheme === 'dark' ? requestedTheme : '';
    if (!win || win.isDestroyed() || !theme || process.platform !== 'win32' || typeof win.setTitleBarOverlay !== 'function') return false;
    try {
      win.setTitleBarOverlay(titleBarOverlayOptions(theme));
      return true;
    } catch (error) {
      startupLog('window:titlebar-theme-failed', { theme, error: String(error?.message || error) });
      return false;
    }
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

// Windows 上 Chromium 的窗口遮挡检测经常误判：窗口明明在前台可见，却被当成
// 被遮挡而进入后台节流 —— requestAnimationFrame 不再回调、CSS 动画停摆，但
// 输入驱动的重绘（悬停、过渡）照常，于是表现为「只有背景光晕不动」。
// 这个应用早先就踩过一次：设置窗口的生长动画当时被迫改成不依赖 rAF 实现。
// 这里从根上关掉遮挡背景化与渲染进程背景化。
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaughtException:', error);
  startupLog('fatal:uncaught-exception', error);
  try { dialog.showErrorBox(APP_NAME, `发生未处理的错误：${error?.message || error}`); } catch (e) {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
  startupLog('fatal:unhandled-rejection', reason);
});

app.on('child-process-gone', (_event, details) => startupLog('child-process:gone', details));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  configureDataPaths();
  startupLog('process:start', { version: app.getVersion(), platform: process.platform, arch: process.arch });

  app.on('second-instance', () => {
    startupLog('app:second-instance');
    if (showMainWindow()) return;
    // 主窗口已经不在了却还占着单实例锁：直接重建，避免双击没反应。
    if (localServerUrl) recreateMainWindow();
  });

  app.whenReady().then(async () => {
    startupLog('app:ready');
    if (process.platform === 'darwin') {
      app.setAboutPanelOptions({
        applicationName: APP_NAME,
        applicationVersion: app.getVersion(),
        copyright: 'Copyright (c) 2026 AKISATO',
        credits: 'Independent third-party tool. Not affiliated with Bangumi.'
      });
    }
    Menu.setApplicationMenu(null);
    try { await clearRetiredBangumiLoginSession(); }
    catch (error) { console.warn('[bangumi-login-cleanup] failed:', error?.message || error); }
    try {
      await initializeDesktop({
        configureDataPaths,
        registerIpc,
        createMainWindow,
        ensureDataDirs,
        startLocalServer,
        loadMainPage
      });
      startupLog('startup:complete');
    } catch (error) {
      // Keep startup failures visible and release the single-instance lock.
      console.error('[startup] failed:', error);
      startupLog('startup:failed', error);
      try {
        dialog.showErrorBox(APP_NAME, `启动失败：${error?.message || error}\n\n资料库目录：${dataDir}`);
      } catch (e) {}
      app.quit();
      return;
    }
    setTimeout(() => {
      optimizeExistingOversizedCovers().catch(error => {
        console.warn('[cover-cache] background optimization failed:', error?.message || error);
      });
    }, 1200);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && localServerUrl) recreateMainWindow();
  });

  app.on('window-all-closed', () => {
    // 修复：macOS 上关闭窗口后应用仍驻留，若此时关掉本地服务，
    // 从 Dock 重新激活会得到无法加载数据的空窗口。服务只在真正退出时关闭。
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (localServer) localServer.close();
  });
}
