# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`juggler-studio` is the **marketing / landing-page site** for the Juggler app
(the AI coding workbench), deployed at [juggler.studio](https://juggler.studio).
It is a small **static site**: plain HTML, CSS, and JavaScript served as files
(GitHub Pages), plus one Cloudflare Worker in `worker/` that fronts the app's
version-check endpoint. This repo is *not* the Juggler app itself — that lives
at `github.com/juggler-ai/juggler`.

## Working on the site

There is no bundler or app build step. To view the site:

- `./scripts/serve.sh` (local static server, optional port arg), or
- open `index.html` directly in a browser.

External runtime dependencies (React, ReactDOM, Babel Standalone, Google Fonts)
are loaded from CDNs via `<script>`/`<link>` tags.

**Validation:** after installing dev packages with `npm install`, run
`./check.sh` before handing off changes. It runs Stylelint (`lint:css`) and the
static-site architecture checks (`scripts/validate-static-site.js`), and is the
place to add future validation steps. Do not invoke `npm run ...` or other
lint/check commands directly; `./check.sh` is the single entry point for all
validation.

## File layout

| Path | Purpose |
|------|---------|
| `index.html` | The landing page. Loads `styles.css`, `main.js`, and `image-slot.js`. |
| `styles.css` | The site's stylesheet, shared by `index.html` and `404.html`. |
| `main.js` | Click-to-zoom lightbox for the page's screenshots/recordings. Plain ES5-style IIFE. |
| `404.html` | Not-found page; reuses the same theme tokens. |
| `robots.txt`, `sitemap.xml`, `CNAME` | SEO basics and the GitHub Pages custom domain, pointing at `https://juggler.studio/`. |
| `juggler-version.json` | **Template** for the version-check endpoint — the Worker overlays release data. Edit editorial copy / `match` patterns only; never hand-edit version numbers (see the file's `$comment`). |
| `worker/` | The `juggler-version` Cloudflare Worker serving `https://juggler.studio/juggler-version.json` from the latest GitHub release. Own docs in `worker/README.md`. |
| `scripts/` | `serve.sh` (local static server) and `validate-static-site.js` (checks run by `./check.sh`). |
| `image-slot.js` | `<image-slot>` web component — a user-fillable image placeholder. Carries its own usage docs in a `/* BEGIN USAGE */` block at the top. |
| `tweaks-panel.jsx` | Reusable "Tweaks" panel + form-control helpers (React, compiled in-browser by Babel). Usage docs in its header comment. |
| `assets/` | `juggler-logo.svg`, `juggler-wordmark.svg`. |

## Conventions

- **Vanilla everything.** No framework on the page itself. `main.js` is a plain
  ES5-style IIFE; keep DOM scripts unobtrusive and degrade gracefully.
- **Use `rem` for CSS lengths.** All CSS length units in HTML, CSS, and scaffold
  component style strings should be `rem` unless the value is unitless (`0`,
  `line-height`, `fr`, percentages, colors, transforms, etc.). Stylelint enforces
  this by disallowing `px`, `em`, viewport units, physical units, and `ch`.
- **Match the existing house style** in `styles.css` (compact multi-property
  lines, the existing variable names) rather than reformatting.

## Scaffold components — leave the markers alone

`image-slot.js` and `tweaks-panel.jsx` are "omelette starter scaffold" files
brought in from a prototyping runtime. They begin with
`// @ds-adherence-ignore` and contain `/* BEGIN USAGE */ … /* END USAGE */`
docs and `EDITMODE-BEGIN/END` markers. When editing them:

- Read their header usage block first — it documents every attribute/prop.
- Do **not** strip the `@ds-adherence-ignore`, `BEGIN USAGE`, or `EDITMODE`
  markers; tooling relies on them.
- `<image-slot>` persists dropped images to a `.image-slots.state.json`
  sidecar via the host bridge, and that write is only permitted at the project
  root — so HTML using it must stay at the repo root.

## Git

- Commit messages: **one line, minimal, past tense**.
