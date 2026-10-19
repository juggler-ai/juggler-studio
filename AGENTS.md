# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`juggler-studio` is the **marketing / landing-page site** for the Juggler app
(the AI coding harness), deployed at [juggler.studio](https://juggler.studio).
It is a small **static site**: plain HTML, CSS, and JavaScript served as files
(GitHub Pages). This repo is *not* the Juggler app itself — that lives at
`github.com/juggler-ai/juggler`.

## Working on the site

There is no bundler or app build step. To view the site:

- `./scripts/serve.sh` (local static server, optional port arg), or
- open `index.html` directly in a browser.

The only external runtime dependency is Google Fonts, loaded via `<link>` tags.
The pages load no third-party scripts.

**Validation:** after installing dev packages with `npm install`, run
`./scripts/check.sh` before handing off changes. It runs Stylelint (`lint:css`)
and the static-site architecture checks (`scripts/validate-static-site.js`). Do
not invoke `npm run ...` or other lint/check commands directly;
`./scripts/check.sh` is the single entry point for all validation.

## File layout

| Path | Purpose |
|------|---------|
| `index.html` | The landing page. Loads `styles.css`, `main.js`, and `image-slot.js`. |
| `styles.css` | The site's stylesheet, shared by `index.html` and `404.html`. |
| `main.js` | Click-to-zoom lightbox for the page's screenshots/recordings. Plain ES5-style IIFE. |
| `404.html` | Not-found page; reuses the same theme tokens. |
| `robots.txt`, `sitemap.xml`, `CNAME` | SEO basics and the GitHub Pages custom domain, pointing at `https://juggler.studio/`. |
| `juggler-version.json` | **Template** for the version-check endpoint, which reads it from this repo and overlays the latest release's data onto it. Edit editorial copy / `match` patterns only; never hand-edit version numbers (see the file's `$comment`). |
| `scripts/` | `check.sh` (the validation entry point), `serve.sh` (local static server), and `validate-static-site.js` (the checks it runs). |
| `image-slot.js` | `<image-slot>` web component — a user-fillable image placeholder. Carries its own usage docs in a `/* BEGIN USAGE */` block at the top. |
| `assets/` | `juggler-logo.svg`, `juggler-wordmark.svg`. |

## Conventions

- **Vanilla everything.** No framework on the page itself. `main.js` is a plain
  ES5-style IIFE; keep DOM scripts unobtrusive and degrade gracefully.
- **Use `rem` for CSS lengths.** All CSS length units in HTML, CSS, and the scaffold
  component's style strings should be `rem` unless the value is unitless (`0`,
  `line-height`, `fr`, percentages, colors, transforms, etc.). Stylelint enforces
  this by disallowing `px`, `em`, viewport units, physical units, and `ch`.
- **Match the existing house style** in `styles.css` (compact multi-property
  lines, the existing variable names) rather than reformatting.

## Deploying — the published file list is explicit

`.github/workflows/deploy-pages.yml` stages a named list of files into `_site/`
and uploads only that, because Pages serves whatever it is given and the repo
also holds tooling (`scripts/`, `package.json`) that has no business being
served from `juggler.studio`.

**A new page or asset must be added to that `cp -R` list**, or it 404s in
production. `validate-static-site.js` cross-checks the list against what the
pages reference, so `./scripts/check.sh` catches the omission first.

## Scaffold component — leave the markers alone

`image-slot.js` is an "omelette starter scaffold" file brought in from a
prototyping runtime. It begins with `// @ds-adherence-ignore` and contains
`/* BEGIN USAGE */ … /* END USAGE */` docs. When editing it:

- Read its header usage block first — it documents every attribute.
- Do **not** strip the `@ds-adherence-ignore` or `BEGIN USAGE` markers;
  tooling relies on them.
- `<image-slot>` persists dropped images to a `.image-slots.state.json`
  sidecar via the host bridge, and that write is only permitted at the project
  root — so HTML using it must stay at the repo root.

## Git

- Commit messages: **one line, minimal, past tense**.
