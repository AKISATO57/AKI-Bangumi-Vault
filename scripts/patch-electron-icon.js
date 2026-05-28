const fs = require('fs');
const path = require('path');

async function main() {
  if (process.platform !== 'win32') return;

  const appDir = path.resolve(__dirname, '..');
  const pkg = require(path.join(appDir, 'package.json'));
  const electronExe = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  const iconPath = path.join(appDir, 'build', 'icon.ico');
  const markerPath = path.join(appDir, 'node_modules', '.electron-icon-patched');

  if (!fs.existsSync(electronExe) || !fs.existsSync(iconPath)) return;

  const iconStat = fs.statSync(iconPath);
  const desiredMarker = `${pkg.version}|${Math.round(iconStat.mtimeMs)}|${iconStat.size}`;
  if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf8') === desiredMarker) {
    return;
  }

  let rcedit;
  try {
    rcedit = require('rcedit');
  } catch (err) {
    console.warn('[Bangumi Vault] rcedit is not installed; skipping development taskbar icon patch.');
    return;
  }

  const options = {
    icon: iconPath,
    'version-string': {
      CompanyName: 'AKISATO',
      FileDescription: 'Bangumi 保管库',
      ProductName: 'Bangumi 保管库',
      OriginalFilename: 'electron.exe',
      LegalCopyright: 'Copyright (c) 2026 AKISATO'
    }
  };

  await new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve();
    };
    try {
      const result = rcedit(electronExe, options, done);
      if (result && typeof result.then === 'function') {
        result.then(() => done(), done);
      } else if (rcedit.length < 3) {
        done();
      }
    } catch (err) {
      done(err);
    }
  });

  fs.writeFileSync(markerPath, desiredMarker, 'utf8');
  console.log('[Bangumi Vault] Development Electron icon patched.');
}

main().catch((err) => {
  console.warn('[Bangumi Vault] Development icon patch skipped:', err.message || String(err));
});
