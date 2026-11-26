#!/usr/bin/env node
/**
 * Runs automatically on `npm install` / `npm ci` (the "prepare" script).
 * Points Git at the repo's .githooks folder so the data-safety pre-commit
 * check is always active. Does nothing outside a Git checkout.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
  fs.chmodSync('.githooks/pre-commit', 0o755);
} catch {
  // Not a git checkout (or git missing). Nothing to do.
}
