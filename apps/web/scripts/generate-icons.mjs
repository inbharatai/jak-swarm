/**
 * Generate PWA icons from SVG template.
 * Run: node scripts/generate-icons.mjs
 *
 * Uses sharp if available, otherwise creates SVG placeholders that work as icons.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'public', 'icons');

function createSVG(size, maskable = false) {
  const padding = maskable ? size * 0.1 : 0;
  const innerSize = size - padding * 2;
  const center = size / 2;
  const fontSize = innerSize * 0.38;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#09090b" rx="${maskable ? 0 : size * 0.15}"/>
  ${maskable ? '' : `<circle cx="${center}" cy="${center}" r="${innerSize * 0.42}" fill="none" stroke="rgba(52,211,153,0.15)" stroke-width="1.5"/>`}
  <circle cx="${size * 0.2}" cy="${size * 0.2}" r="${size * 0.02}" fill="#34d399" opacity="0.4"/>
  <circle cx="${size * 0.82}" cy="${size * 0.22}" r="${size * 0.018}" fill="#fbbf24" opacity="0.3"/>
  <circle cx="${size * 0.15}" cy="${size * 0.82}" r="${size * 0.015}" fill="#34d399" opacity="0.3"/>
  <circle cx="${size * 0.85}" cy="${size * 0.8}" r="${size * 0.02}" fill="#f472b6" opacity="0.4"/>
  <line x1="${size * 0.2}" y1="${size * 0.2}" x2="${size * 0.32}" y2="${size * 0.38}" stroke="#34d399" stroke-width="0.8" opacity="0.2"/>
  <line x1="${size * 0.82}" y1="${size * 0.22}" x2="${size * 0.7}" y2="${size * 0.38}" stroke="#fbbf24" stroke-width="0.8" opacity="0.2"/>
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#fbbf24"/>
    </linearGradient>
  </defs>
  <text x="${center}" y="${center + fontSize * 0.32}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-weight="800" font-size="${fontSize}" letter-spacing="-${fontSize * 0.04}" fill="url(#g)">JAK</text>
</svg>`;
}

// Generate SVG icons (browsers support SVG icons, and these also serve as templates)
const sizes = [192, 512];
for (const size of sizes) {
  writeFileSync(join(ICONS_DIR, `icon-${size}.svg`), createSVG(size, false));
  writeFileSync(join(ICONS_DIR, `icon-maskable-${size}.svg`), createSVG(size, true));
  console.log(`Generated icon-${size}.svg and icon-maskable-${size}.svg`);
}

// Also generate a favicon.svg
writeFileSync(join(ICONS_DIR, '..', 'favicon.svg'), createSVG(32, false));
console.log('Generated favicon.svg');

// Generate a simple favicon.ico placeholder (16x16 SVG as ICO is complex without sharp)
writeFileSync(join(ICONS_DIR, '..', 'favicon.ico'), '');
console.log('Generated favicon.ico placeholder');

console.log('\nTo generate PNG icons, install sharp and run:');
console.log('  pnpm add -D sharp && node scripts/generate-png-icons.mjs');
console.log('\nSVG icons will work for most modern browsers and PWA installs.');
