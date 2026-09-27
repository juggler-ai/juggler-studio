// Static-site architecture checks that complement Stylelint.
// Keep this dependency-free so ./scripts/check.sh remains lightweight.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const referenced = new Set();

// Absolute URLs on our own origin address files in this repo just as surely as a
// relative path does, and social-card metadata is always written in that form.
const origins = (() => {
  const cname = path.join(root, 'CNAME');
  if (!fs.existsSync(cname)) return [];
  const host = fs.readFileSync(cname, 'utf8').trim().toLowerCase();
  return host ? [`https://${host}`, `http://${host}`] : [];
})();

function fail(file, message) {
  errors.push(`${file}: ${message}`);
}

function existsLocalAsset(file, value, attr) {
  if (!value || /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('#') || value.startsWith('mailto:')) return;
  if (value.startsWith('/')) return;

  const cleanValue = value.split(/[?#]/, 1)[0];
  if (!cleanValue || cleanValue === '.') return;

  const target = path.resolve(root, path.dirname(file), cleanValue);
  if (!target.startsWith(root + path.sep) && target !== root) {
    fail(file, `${attr} escapes project root: ${value}`);
    return;
  }
  if (!fs.existsSync(target)) fail(file, `missing local asset in ${attr}: ${value}`);

  referenced.add(path.relative(root, target).split(path.sep)[0]);
}

// Resolve a URL a scraper would fetch back to a repo-relative path, or null when
// it is somebody else's to serve.
function siteRelative(value) {
  const lower = value.toLowerCase();
  const origin = origins.find((candidate) => lower.startsWith(candidate));
  if (origin) return value.slice(origin.length).split(/[?#]/, 1)[0].replace(/^\/+/, '');
  if (/^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('#') || value.startsWith('mailto:')) return null;
  return value.split(/[?#]/, 1)[0].replace(/^\/+/, '');
}

function metaContent(html) {
  const meta = new Map();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = tag[0].match(/\s(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const content = tag[0].match(/\scontent\s*=\s*["']([^"']*)["']/i);
    if (key && content) meta.set(key[1].trim().toLowerCase(), content[1].trim());
  }
  return meta;
}

// Dimensions straight out of the file header: PNG's IHDR, JPEG's first SOF
// marker. Enough to tell a card apart from what the page promised it would be.
function imageSize(file) {
  const buffer = fs.readFileSync(file);

  if (buffer.length > 24 && buffer.toString('latin1', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }

  return null;
}

// A social card is the one asset no browser ever requests. It is fetched by other
// people's link scrapers, so a wrong path is invisible while developing and shows
// up as a blank card in someone else's chat window — the moment someone is
// recommending us. Check the declared image is in the repo, in a format the
// scrapers decode, and the size the page claims it is.
function checkSocialCard(file, html) {
  const meta = metaContent(html);
  const width = Number(meta.get('og:image:width'));
  const height = Number(meta.get('og:image:height'));

  for (const key of ['og:image', 'og:image:secure_url', 'twitter:image']) {
    const value = meta.get(key);
    if (!value) continue;

    const relative = siteRelative(value);
    if (relative === null) continue;

    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) {
      fail(file, `${key} escapes project root: ${value}`);
      continue;
    }
    if (!fs.existsSync(target)) {
      fail(file, `${key} points at a file that is not in the repo: ${value}`);
      continue;
    }

    referenced.add(path.relative(root, target).split(path.sep)[0]);

    if (!/\.(?:png|jpe?g)$/i.test(relative)) {
      fail(file, `${key} must be PNG or JPEG; WebP and SVG are not decoded by every scraper: ${value}`);
    }

    const kilobytes = Math.round(fs.statSync(target).size / 1024);
    if (kilobytes > 1024) {
      fail(file, `${key} is ${kilobytes}kB; keep a social card under 1MB or slow scrapers drop it: ${value}`);
    }

    const size = imageSize(target);
    if (!size) {
      fail(file, `${key} is not a readable PNG or JPEG: ${value}`);
    } else if (width && height && (size.width !== width || size.height !== height)) {
      fail(file, `${key} is ${size.width}x${size.height} but the page declares ${width}x${height}: ${value}`);
    }
  }

  if (meta.get('twitter:card') === 'summary_large_image' && !meta.get('og:image') && !meta.get('twitter:image')) {
    fail(file, 'twitter:card is summary_large_image but no og:image or twitter:image is declared; the card renders empty');
  }
}

// The Pages deploy uploads an explicit allow-list, not the whole checkout, so
// that the repo's tooling (scripts/, AGENTS.md…) isn't served as part
// of the site. That means a new page or asset has to be added to the workflow
// too, or it 404s in production with nothing to warn you. Check the two agree.
const workflow = path.join(root, '.github', 'workflows', 'deploy-pages.yml');
let staged = null;

if (!fs.existsSync(workflow)) {
  fail('.github/workflows/deploy-pages.yml', 'deploy workflow is missing');
} else {
  const yaml = fs.readFileSync(workflow, 'utf8');
  const block = yaml.match(/cp -R\s+((?:.|\n)*?)\s+_site\//);

  if (!block) {
    fail('.github/workflows/deploy-pages.yml', 'no `cp -R … _site/` staging step found; the published file list cannot be checked');
  } else {
    staged = new Set(block[1].split(/[\s\\]+/).filter(Boolean));
  }
}

// Every page the deploy publishes is a page these checks cover. A list kept
// separately from the staging step drifts, and the page it forgets is precisely
// the one that ships unchecked.
const htmlFiles = staged ? [...staged].filter((file) => /\.html$/i.test(file)).sort() : [];

if (staged && !htmlFiles.length) {
  fail('.github/workflows/deploy-pages.yml', 'no .html pages in the `cp -R` list; there would be nothing to validate');
}

for (const file of htmlFiles) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    fail(file, 'expected HTML file is missing');
    continue;
  }

  const html = fs.readFileSync(absolute, 'utf8');

  if (/<style\b/i.test(html)) fail(file, 'inline <style> blocks are not allowed; use external CSS');
  if (/\sstyle\s*=/i.test(html)) fail(file, 'inline style attributes are not allowed; use CSS classes');
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) fail(file, 'inline <script> blocks are not allowed; use external JS');

  for (const match of html.matchAll(/<(?:script|img|source|image-slot)\b[^>]*\s(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    existsLocalAsset(file, match[1], 'src/href');
  }
  for (const match of html.matchAll(/<link\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    existsLocalAsset(file, match[1], 'href');
  }

  checkSocialCard(file, html);
}

if (staged) {
  for (const file of [...referenced].sort()) {
    if (!staged.has(file)) {
      fail('.github/workflows/deploy-pages.yml', `${file} is used by the site but not staged for deploy; add it to the \`cp -R\` list`);
    }
  }
  for (const file of staged) {
    if (!fs.existsSync(path.join(root, file))) {
      fail('.github/workflows/deploy-pages.yml', `staged for deploy but missing from the repo: ${file}`);
    }
  }
}

if (errors.length) {
  console.error('Static-site validation failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Static-site validation passed.');
