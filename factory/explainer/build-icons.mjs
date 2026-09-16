/*
 * Bakes the icon set the scene renderer draws from.
 *
 * Two sources, both redistributable: lucide-static (ISC) for concepts, drawn as
 * stroked outlines that match the scene's line weight, and simple-icons (CC0)
 * for real product marks, which are solid single-path glyphs with an official
 * brand hex. Brand marks are what make a diagram read as concrete rather than
 * as a generic shapes-and-arrows slide.
 *
 * Output is assets/icons/icons.json, committed, so nothing is fetched at render
 * time and CI needs no extra install.
 */
import fs from 'node:fs';
import path from 'node:path';

const LUCIDE = 'node_modules/lucide-static/icons';
const SIMPLE = 'node_modules/simple-icons/icons';
const ROOT = path.resolve(process.env.MEDIAMONKEY_ROOT || '/Users/anzalhussainabidi/personal/mediamonkey');
const OUT = path.join(ROOT, 'assets', 'icons', 'icons.json');
// the scene page is loaded over file://, where fetching JSON is blocked, so the
// same bundle is also emitted as a plain script the page can <script src> in
const OUT_JS = path.join(ROOT, 'factory', 'bg', 'icons.js');

// key -> lucide file. The key is what the model is allowed to emit.
const CONCEPTS = {
  server: 'server', database: 'database', cache: 'zap', browser: 'app-window',
  user: 'user-round', cloud: 'cloud', queue: 'list-ordered', file: 'file-text',
  lock: 'lock', clock: 'clock', chip: 'cpu', network: 'network', disk: 'hard-drive',
  api: 'code-xml', container: 'box', box: 'square',
  thread: 'git-branch', memory: 'memory-stick', request: 'arrow-right-left',
  timer: 'timer', alert: 'triangle-alert', money: 'banknote', shield: 'shield',
  scale: 'scaling', search: 'search', log: 'scroll-text', mobile: 'smartphone',
  gauge: 'gauge', key: 'key-round', trash: 'trash-2', refresh: 'refresh-cw',
  split: 'split', merge: 'git-merge', globe: 'globe', terminal: 'terminal',
  package: 'package', layers: 'layers', link: 'link', flame: 'flame',
};

// key -> simple-icons file (slug). Brand marks, drawn filled in brand colour.
const BRANDS = {
  postgres: 'postgresql', mysql: 'mysql', mongodb: 'mongodb', redis: 'redis',
  sqlite: 'sqlite', elasticsearch: 'elasticsearch', clickhouse: 'clickhouse',
  kafka: 'apachekafka', rabbitmq: 'rabbitmq', nginx: 'nginx',
  docker: 'docker', kubernetes: 'kubernetes', terraform: 'terraform',
  // AWS, Azure, OpenAI and gRPC marks were pulled from simple-icons on the
  // owners' request, so those stay on the generic `cloud`/`api` icons.
  cloudflare: 'cloudflare', gcp: 'googlecloud', vercel: 'vercel',
  linux: 'linux', git: 'git', github: 'github', gitlab: 'gitlab',
  rust: 'rust', go: 'go', python: 'python', nodejs: 'nodedotjs',
  typescript: 'typescript', javascript: 'javascript', java: 'openjdk',
  react: 'react', nextjs: 'nextdotjs', graphql: 'graphql', grpc: 'grpc',
  prometheus: 'prometheus', grafana: 'grafana', datadog: 'datadog',
  firefox: 'firefox', chrome: 'googlechrome',
};

/** lucide files are full <svg> documents; the renderer only wants the guts. */
function lucideInner(slug) {
  const p = path.join(LUCIDE, slug + '.svg');
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8');
  const m = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(s);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** simple-icons files are a single filled path plus a <title>. */
function simpleIcon(slug) {
  const p = path.join(SIMPLE, slug + '.svg');
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8');
  const d = /\sd="([^"]+)"/.exec(s);
  if (!d) return null;
  let hex = null;
  try {
    const meta = JSON.parse(fs.readFileSync('node_modules/simple-icons/data/simple-icons.json', 'utf8'));
    const list = Array.isArray(meta) ? meta : meta.icons || [];
    const hit = list.find((x) => (x.slug || String(x.title).toLowerCase().replace(/[^a-z0-9]/g, '')) === slug);
    if (hit && hit.hex) hex = '#' + hit.hex;
  } catch { /* colour is optional; the renderer falls back to the accent */ }
  return { d: d[1], hex };
}

const icons = {};
const missing = [];
for (const [key, slug] of Object.entries(CONCEPTS)) {
  const inner = lucideInner(slug);
  if (!inner) { missing.push(`concept ${key} (${slug})`); continue; }
  icons[key] = { kind: 'line', svg: inner };
}
for (const [key, slug] of Object.entries(BRANDS)) {
  const ic = simpleIcon(slug);
  if (!ic) { missing.push(`brand ${key} (${slug})`); continue; }
  icons[key] = { kind: 'brand', d: ic.d, hex: ic.hex };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(icons));
fs.writeFileSync(OUT_JS, 'window.ICONS = ' + JSON.stringify(icons) + ';');
console.log(`${Object.keys(icons).length} icons -> ${OUT}`);
console.log(`  concepts: ${Object.values(icons).filter((i) => i.kind === 'line').length}, brands: ${Object.values(icons).filter((i) => i.kind === 'brand').length}`);
if (missing.length) console.log('  MISSING: ' + missing.join(', '));
