// Static-site architecture checks that complement Stylelint.
// Keep this dependency-free so ./scripts/check.sh remains lightweight.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'extensions.html', '404.html'];
const errors = [];
const referenced = new Set();

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
}

// The Pages deploy uploads an explicit allow-list, not the whole checkout, so
// that the repo's tooling (scripts/, AGENTS.md…) isn't served as part
// of the site. That means a new page or asset has to be added to the workflow
// too, or it 404s in production with nothing to warn you. Check the two agree.
const workflow = path.join(root, '.github', 'workflows', 'deploy-pages.yml');
if (!fs.existsSync(workflow)) {
  fail('.github/workflows/deploy-pages.yml', 'deploy workflow is missing');
} else {
  const yaml = fs.readFileSync(workflow, 'utf8');
  const block = yaml.match(/cp -R\s+((?:.|\n)*?)\s+_site\//);

  if (!block) {
    fail('.github/workflows/deploy-pages.yml', 'no `cp -R … _site/` staging step found; the published file list cannot be checked');
  } else {
    const staged = new Set(block[1].split(/[\s\\]+/).filter(Boolean));
    for (const file of [...htmlFiles, ...referenced].sort()) {
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
}

if (errors.length) {
  console.error('Static-site validation failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Static-site validation passed.');
