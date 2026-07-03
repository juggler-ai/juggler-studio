// Static-site architecture checks that complement Stylelint.
// Keep this dependency-free so ./check.sh remains lightweight.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', '404.html'];
const errors = [];

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

if (errors.length) {
  console.error('Static-site validation failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Static-site validation passed.');
