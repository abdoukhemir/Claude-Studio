// Launches a dedicated browser profile for a Claude account.
// Used by Studio and by Claude Code's OAuth login flow ($BROWSER).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findBrowser() {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const candidates = [...chromePaths, ...edgePaths];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export function openBrowserProfile(rawProfileDir, url = 'https://claude.ai') {
  const exe = findBrowser();
  if (!exe) throw new Error('Neither Chrome nor Edge was found on this system.');

  const profileDir = path.win32.normalize(rawProfileDir);
  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch {}

  const lock = path.join(profileDir, 'lockfile');
  if (fs.existsSync(lock)) {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }

  const child = spawn(exe, [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    url,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { exe, profileDir };
}

// Only launch if executed directly from CLI, not when imported as a module
const isDirectCli = process.argv[1] && (
  process.argv[1].endsWith('launch-browser.mjs') ||
  process.argv[1].endsWith('launch-browser')
);

if (isDirectCli) {
  const targetUrl = process.argv[2] || 'https://claude.ai';
  const targetProfile = process.env.STUDIO_ACCOUNT_BROWSER_DIR || path.join(os.homedir(), '.claude-browsers', 'default');
  try {
    openBrowserProfile(targetProfile, targetUrl);
  } catch (err) {
    console.error('Failed to launch browser:', err);
    process.exit(1);
  }
}
