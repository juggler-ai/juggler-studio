# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`juggler-studio` is the **marketing / landing-page site** for the Juggler app
(the AI coding workbench), deployed at [juggler.studio](https://juggler.studio).
It is a small **static site**: plain HTML, CSS, and JavaScript served as files.
This repo is *not* the Juggler app itself — that lives at
`github.com/juggler-ai/juggler`.

## Static site + CSS linting

This is still a plain static site: HTML, CSS, and JavaScript served as files.
There is no bundler or app build step. To work on the site:

- Open `index.html` directly in a browser, or
- Serve the directory statically, e.g. `python3 -m http.server` then open the
  printed URL.

External runtime dependencies (React, ReactDOM, Babel Standalone, Google Fonts)
are loaded from CDNs via `<script>`/`<link>` tags.

The only local tooling is Stylelint for CSS hygiene. After installing dev
packages with `npm install`, run `./check.sh` before handing
off changes. The script currently runs `npm run lint:css` and is the place to add
future validation/build steps. Agents must not invoke `npm run ...` or other
lint/check commands directly; `./check.sh` is the single entry point for all
validation.

## File layout

| Path | Purpose |
|------|---------|
| `index.html` | The landing page. Self-contained: inline `<style>` and inline `<script>`, plus it loads the scaffold components below. |
| `styles.css` | Extracted/standalone stylesheet (mirrors the inline styles in `index.html`). |
| `404.html` | Not-found page; reuses the same theme tokens. |
| `robots.txt`, `sitemap.xml` | SEO basics pointing at `https://juggler.studio/`. |
| `image-slot.js` | `<image-slot>` web component — a user-fillable image placeholder. Carries its own usage docs in a `/* BEGIN USAGE */` block at the top. |
| `tweaks-panel.jsx` | Reusable "Tweaks" panel + form-control helpers (React, compiled in-browser by Babel). Usage docs in its header comment. |
| `assets/` | `juggler-logo.svg`, `juggler-wordmark.svg`. |
| `uploads/README.md` | Copy of the app's product README (reference material). |

## Conventions

- **Vanilla everything.** No framework on the page itself. `main.js` is a plain
  ES5-style IIFE; keep DOM scripts unobtrusive and degrade gracefully.
- **Use `rem` for CSS lengths.** All CSS length units in HTML, CSS, and scaffold
  component style strings should be `rem` unless the value is unitless (`0`,
  `line-height`, `fr`, percentages, colors, transforms, etc.). Stylelint enforces
  this by disallowing `px`, `em`, viewport units, physical units, and `ch`.
- **Keep `index.html` and `styles.css` in sync.** The page's inline `<style>`
  and `styles.css` share the same rules; if you change one, check the other.
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

This working copy is not a git repository (`.git` is absent). Don't assume git
commands will work; confirm with the user before initializing one.
