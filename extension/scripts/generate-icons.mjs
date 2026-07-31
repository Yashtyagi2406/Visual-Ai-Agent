#!/usr/bin/env node
/**
 * generate-icons.mjs
 *
 * Creates the three PNG icon sizes required by the Chrome extension manifest
 * (16×16, 48×48, 128×128) using macOS's built-in `sips` tool.
 *
 * Usage:
 *   1. Place a source PNG at extension/icons/icon.png (any size ≥ 128px)
 *   2. Run:  node scripts/generate-icons.mjs
 *
 * No npm dependencies required — sips ships with macOS.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dir, '..', 'icons');
const source = join(iconsDir, 'icon.png');

if (!existsSync(source)) {
  console.error(`❌  Source icon not found at ${source}`);
  console.error('    Create a 128×128 (or larger) PNG at extension/icons/icon.png first.');
  process.exit(1);
}

const sizes = [16, 48, 128];

for (const size of sizes) {
  const out = join(iconsDir, `icon${size}.png`);
  execSync(`sips -z ${size} ${size} "${source}" --out "${out}"`, { stdio: 'pipe' });
  console.log(`✅  icons/icon${size}.png`);
}

console.log('\nDone! Load the extension from extension/dist/ in Chrome.');
