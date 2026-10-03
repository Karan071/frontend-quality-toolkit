// Bundles the extension into dist/ with esbuild.
//   node scripts/build.mjs           one-off production build
//   node scripts/build.mjs --watch   rebuild on change
import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const out = 'dist';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  outdir: out,
  target: 'chrome116',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  // Chrome rejects content scripts containing Unicode noncharacters (e.g. U+FFFF) as "not UTF-8".
  charset: 'ascii',
  // Fonts are referenced by absolute extension URL (/fonts/…) and copied verbatim.
  external: ['/fonts/*'],
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

const configs = [
  // Extension contexts are classic scripts: IIFE, no module loading.
  { ...common, entryPoints: { 'service-worker': 'extension/service-worker.ts' }, format: 'iife' },
  { ...common, entryPoints: { content: 'extension/content/content.ts' }, format: 'iife' },
  { ...common, entryPoints: { sidepanel: 'extension/sidepanel/main.tsx' }, format: 'iife', jsx: 'automatic' },
  { ...common, entryPoints: { viewer: 'extension/viewer.ts' }, format: 'iife' },
];

function copyStatic() {
  for (const f of ['manifest.json', 'sidepanel.html', 'viewer.html']) cpSync(`extension/${f}`, `${out}/${f}`);
  if (!existsSync('extension/icons/icon-128.png')) throw new Error('Run `node scripts/make-icons.mjs` first.');
  cpSync('extension/icons', `${out}/icons`, { recursive: true });
  cpSync('extension/fonts', `${out}/fonts`, { recursive: true });
}

copyStatic();
if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log('watching… reload the extension in chrome://extensions after changes');
} else {
  await Promise.all(configs.map((c) => build(c)));
  // Guard: Chrome silently refuses to load scripts it considers non-UTF-8 (e.g. noncharacters).
  for (const f of ['content.js', 'service-worker.js', 'sidepanel.js', 'viewer.js']) {
    const text = readFileSync(`${out}/${f}`, 'utf8');
    const bad = /[^\x00-\x7f]/.exec(text);
    if (bad) throw new Error(`${f} contains non-ASCII character U+${bad[0].codePointAt(0).toString(16)} near: ${text.slice(Math.max(0, bad.index - 40), bad.index + 10)}`);
  }
  console.log('built → dist/');
}
