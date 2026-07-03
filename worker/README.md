# juggler-version Worker

Cloudflare Worker that fronts `https://juggler.studio/juggler-version.json`.

It **generates** the payload dynamically — nothing about the version is
hand-maintained:

1. Parses the update-check query params (`v`, `os`, `arch`).
2. Logs each request to the `juggler_version_checks` Analytics Engine dataset.
3. Reads an editorial **template** from the repo (`TEMPLATE_URL`) and the
   **latest GitHub release** of the app repo (`SOURCE_REPO`), then merges them:
   the template supplies the schema + notice copy + per-platform asset `match`
   patterns; the release supplies `latest` (the tag), and each download's
   `url`, `sha256` (from the asset digest) and `size`.

The release is the single source of truth for the version. If a payload can't
be resolved (origin hiccup, rate limit, no matching release asset), the Worker
returns **HTTP 502** rather than a guess — the app treats any non-2xx as "no
update info" and silently ignores it.

`resolveVersion(template, release)` in `src/worker.js` is where the merge
happens; extend it there for any future dynamic behaviour.

## Param contract

The desktop app sends:

| Param  | Meaning                         | Example    |
|--------|---------------------------------|------------|
| `v`    | Current app version             | `0.0.10`   |
| `os`   | Operating system                | `darwin`   |
| `arch` | CPU architecture                | `arm64`    |

## Scripts

All live in this folder. Run them directly or via `npm run <name>`.

| Script | What it does |
|--------|--------------|
| `./deploy.sh` | Redeploy the Worker (uploads code + syncs routes). Args pass through to `wrangler deploy`. |
| `./tail.sh` | Stream live logs; each check prints a `version_check {...}` line. Args pass through to `wrangler tail`. |
| `./stats.sh` | Query the Analytics Engine dataset and print hit totals, OS / arch / version / country breakdowns, and per-day counts. |

First-time setup:

```sh
cd worker
npm install                         # installs wrangler (dev dependency)
npx wrangler login                  # one-time browser auth
npx wrangler secret put GITHUB_TOKEN # paste a token with contents:read on SOURCE_REPO
./deploy.sh                         # publishes the Worker + route
```

> **The `GITHUB_TOKEN` is temporary.** It exists only because `SOURCE_REPO`
> (`juggler-ai/juggler`) is currently private, so the releases API needs auth.
> Once that repo is public, the token and all the secret-management faff can be
> removed entirely: delete the `GITHUB_TOKEN` secret (`npx wrangler secret
> delete GITHUB_TOKEN`), drop the `authorization` header from
> `fetchLatestRelease` in `src/worker.js`, and redeploy. The public releases
> API works unauthenticated. Nothing else changes.

## Stats

`./stats.sh` reads the dataset over Cloudflare's SQL API. It needs an account ID
and an API token with **Account → Account Analytics → Read**:

```sh
cp .env.example .env   # account ID is prefilled; paste your API token
./stats.sh             # last 7 days
DAYS=30 ./stats.sh     # last 30 days
```

`.env` is git-ignored — never commit the token. `stats.sh` needs `curl` and `jq`.

## Local dev

```sh
npx wrangler dev       # run the Worker locally
```

## Notes

- The route only intercepts `juggler.studio/juggler-version.json`; the rest of
  the site stays on GitHub Pages untouched.
- `TEMPLATE_URL` points at `raw.githubusercontent.com`, NOT the Pages URL.
  Because `juggler.studio` uses a custom domain, the `*.github.io` Pages URL
  301-redirects back to `juggler.studio`, which would re-enter this Worker's
  route and recurse. `raw.githubusercontent.com` reads the same repo file while
  bypassing Pages. Update the branch/path in `wrangler.toml` if they change.
- The template (`juggler-version.json` at the repo root) is **not** a version
  record — it holds only editorial copy and per-platform asset `match` globs.
  Never hand-edit version numbers; cut a GitHub release instead.
- `GITHUB_TOKEN` is a Worker secret (not in `wrangler.toml`). It needs
  `contents:read` on `SOURCE_REPO` because that repo is private. Rotate with
  `npx wrangler secret put GITHUB_TOKEN`.
- Responses are sent with `cache-control: no-store` so every check reaches the
  Worker and gets logged; the template and release fetches are edge-cached ~60s,
  which also keeps GitHub API usage well under the rate limit.

## WebRTC rendezvous (juggler.studio/c/<id>)

The same Worker also fronts the WebRTC-rendezvous WAN feature (replaces
cloudflared). This is **additive** — the version-check path above and the
GitHub Pages marketing site are untouched.

New routes claimed by the Worker (everything else still falls through to Pages):

| Route | Serves |
|-------|--------|
| `juggler.studio/c/*` | `/c/<id>` → `bootstrap.html`; `/c/<id>/signal?role=host\|guest` → the `SignalRoom` Durable Object (WS) |
| `juggler.studio/sw.js` | the service worker (`Service-Worker-Allowed: /`) |
| `juggler.studio/bootstrap.js` | the bootstrap module |

`<id>` is an unguessable `[A-Za-z0-9_-]{16,}` token validated inside the Worker;
a `/c/...` request with a bad id is 404 (never falls through to Pages).

- **`SignalRoom`** (`src/signal-room.js`) is a SQLite-backed Durable Object, one
  instance per `<id>`, that pushes rendezvous-owned ICE config to both peers,
  then relays a single SDP offer + answer between the host (local binary, dials
  out) and the guest (remote browser), then idles. Its `v1` migration is declared
  in `wrangler.toml` and **auto-applies on `wrangler deploy`** — no manual step.
- **Client-scoped passthrough SW.** Because the Pages site shares this origin,
  `sw.js` tunnels a request over the DataChannel **only** when it comes from a
  registered bridging client (the bootstrap page registers via `bridge-register`
  and the SW acks). Every other request — Pages navigations and their assets —
  passes straight through to the network, so Pages is unaffected.
- **ICE config is owned by juggler.studio and is STUN-only by design.**
  `SignalRoom` sends a protocol-v2 `{type:"config", iceServers:[...]}` frame to
  both host and guest before SDP, containing the single STUN server from
  `STUN_URL` (default `stun:stun.l.google.com:19302`). juggler.studio
  deliberately runs **no public TURN relay**: TURN would carry all peer traffic
  at uncapped hosted cost. Direct P2P is the only mode this Worker serves; for
  networks that block direct WebRTC, use the Juggler app's optional `cloudflared`
  relay mode (handled entirely on the Juggler binary side, not this Worker).
- The three bootstrap assets live in `src/assets/` and are imported as **Text**
  modules (the `[[rules]]` entry in `wrangler.toml`); the JS assets use a neutral
  `.txt` extension so they never collide with the default `.js` ESM rule.

Deploy is unchanged: `./deploy.sh` (`npx wrangler deploy`).
