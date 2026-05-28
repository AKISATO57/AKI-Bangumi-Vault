const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const exe = path.join(appDir, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const cli = path.join(appDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const launcher = fs.existsSync(exe) ? exe : cli;

if (!fs.existsSync(launcher)) {
  console.error('[Bangumi 保管库] Electron launcher not found:', launcher);
  process.exit(1);
}

const child = spawn(launcher, [appDir], {
  cwd: appDir,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (err) => {
  console.error('[Bangumi 保管库] Failed to start Electron:', err);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
