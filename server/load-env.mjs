import { existsSync, readFileSync } from 'node:fs';

export function loadDotEnv(pathname, targetEnv = process.env, override = false) {
  if (!pathname || !existsSync(pathname)) {
    return;
  }

  const raw = readFileSync(pathname, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (override || !(key in targetEnv)) {
      targetEnv[key] = value;
    }
  }
}
