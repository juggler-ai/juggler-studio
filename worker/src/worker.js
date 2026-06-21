import { SignalRoom } from "./signal-room.js";
import bootstrapHtml from "./assets/bootstrap.html";
import bootstrapJs from "./assets/bootstrap.client.txt";
import swJs from "./assets/sw.txt";

// Permissive CSP for the bootstrap page only. The injected real index.html has
// its server nonces stripped (the Worker can't know them), so inline scripts
// must run under 'unsafe-inline'; cdnjs + wss signaling need https:/wss:.
const BOOTSTRAP_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:; " +
  "connect-src 'self' https: wss:; " +
  "img-src 'self' https: data: blob:; " +
  "font-src 'self' https: data:; " +
  "style-src 'self' 'unsafe-inline' https:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:;";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);

    // --- juggler.studio WebRTC rendezvous (additive). Everything that is not a
    // rendezvous route falls through to the version-check default below,
    // unchanged. The marketing Pages site is never touched. ----------------
    if (url.pathname === "/sw.js") {
      return new Response(swJs, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "service-worker-allowed": "/",
          "cache-control": "no-cache",
        },
      });
    }
    if (url.pathname === "/bootstrap.js") {
      return new Response(bootstrapJs, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    }
    if (url.pathname.startsWith("/c/")) {
      const signal = url.pathname.match(/^\/c\/([A-Za-z0-9_-]{16,})\/signal$/);
      if (signal && request.headers.get("Upgrade") === "websocket") {
        const id = env.SIGNAL_ROOM.idFromName(signal[1]);
        return env.SIGNAL_ROOM.get(id).fetch(request);
      }
      if (/^\/c\/([A-Za-z0-9_-]{16,})\/?$/.test(url.pathname)) {
        return new Response(bootstrapHtml, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
            "content-security-policy": BOOTSTRAP_CSP,
          },
        });
      }
      // Any other /c/... (bad id, or /signal without an Upgrade) is ours: a 404
      // here, never a fall-through to the version-check default.
      return new Response("not found", { status: 404 });
    }
    // --- end rendezvous block; version-check default follows, untouched -----
    const params = parseParams(url, request);

    // 1. Log every check. Non-blocking — never let logging delay the response.
    ctx.waitUntil(logCheck(env, params));

    // 2. Build the payload dynamically: a static editorial template from the
    //    repo, with the version + download facts overlaid from the latest
    //    GitHub release. The release is the single source of truth for the
    //    version, URLs, sizes and checksums — nothing is hand-maintained.
    let payload;
    try {
      const [template, release] = await Promise.all([
        fetchTemplate(env),
        fetchLatestRelease(env),
      ]);
      payload = resolveVersion(template, release);
    } catch (err) {
      // Couldn't resolve a version (origin hiccup, rate limit, missing asset…).
      // Return an error rather than a guess: the app treats any non-2xx as
      // "no update info available" and silently ignores it.
      console.log("resolve_failed", String((err && err.message) || err));
      return new Response(JSON.stringify({ error: "version_unavailable" }), {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Always hit the Worker so every check is logged and overridable.
        "cache-control": "no-store",
      },
    });
  },
};

// ---- the param contract the app commits to sending ----
function parseParams(url, request) {
  const q = url.searchParams;
  const cf = request.cf || {};
  return {
    v:    q.get("v")    || "",   // current app version, e.g. "0.0.10"
    os:   q.get("os")   || "",   // "darwin" | "windows" | "linux"
    arch: q.get("arch") || "",   // "arm64" | "amd64"
    from: q.get("from") || "",   // "web" when the marketing site calls it
    // Enrichment Cloudflare adds for free — handy for rollout-by-region etc.
    country: cf.country || "",
    colo:    cf.colo || "",
    ua:      request.headers.get("user-agent") || "",
  };
}

function logCheck(env, p) {
  // Classify the caller. The desktop app's update check always carries the full
  // v/os/arch triple; the marketing site tags its fetch with ?from=web. Only
  // genuine app checks are the "running installs" signal — so only those are
  // written to the durable Analytics Engine dataset. Without this, every landing
  // -page view would inflate the install count and make the metric meaningless.
  const source = p.from === "web" ? "web" : (p.v ? "app" : "other");

  // console.* shows up in `wrangler tail` / the dashboard live log (all sources;
  // grep by the source token). It is NOT the durable metric.
  console.log("version_check", source, JSON.stringify(p));

  // Durable, SQL-queryable. App checks only — web/other are deliberately skipped
  // so stats.sh counts installs, not website traffic.
  if (source !== "app") return;
  // indexes[0] is the sampling key; blobs are free-form dimensions (up to 20).
  env.VERSION_CHECKS?.writeDataPoint({
    indexes: [p.v || "unknown"],
    blobs: [p.os, p.arch, p.v, p.country, p.colo, source],
    doubles: [1],
  });
}

// Editorial template (schema, notice copy, per-platform asset patterns) lives
// in the repo so it stays version-controlled and reviewable. Read from
// raw.githubusercontent.com, NOT the Pages URL: juggler.studio's custom domain
// 301s the *.github.io URL back into this Worker's route and would recurse.
async function fetchTemplate(env) {
  const res = await fetch(env.TEMPLATE_URL, {
    cf: { cacheTtl: 60, cacheEverything: true }, // cache origin briefly at edge
  });
  if (!res.ok) throw new Error(`template ${res.status}`);
  return res.json();
}

// The source of truth for the version itself: the latest published release of
// the (private) app repo. Needs a GitHub token with contents:read, stored as a
// Worker secret (`wrangler secret put GITHUB_TOKEN`). `releases/latest` already
// excludes drafts and prereleases.
async function fetchLatestRelease(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.SOURCE_REPO}/releases/latest`,
    {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "juggler-version-worker",
        "x-github-api-version": "2022-11-28",
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    },
  );
  if (!res.ok) throw new Error(`release ${res.status}`);
  return res.json();
}

// ---- merge template + release into the payload the app consumes ----
function resolveVersion(template, release) {
  const version = release.tag_name;
  if (!version) throw new Error("release missing tag_name");

  const assets = release.assets || [];
  const downloads = {};
  for (const [platform, spec] of Object.entries(template.downloads || {})) {
    const asset = assets.find((a) => matchGlob(spec.match, a.name));
    if (!asset) {
      throw new Error(`no asset matching "${spec.match}" for ${platform}`);
    }
    downloads[platform] = {
      url: asset.browser_download_url,
      // GitHub exposes the digest as "sha256:<hex>"; the payload wants bare hex.
      sha256: String(asset.digest || "").replace(/^sha256:/, ""),
      size: asset.size,
    };
  }

  // Carry the editorial fields through (schema/schemaVersion/notice), but drop
  // `$`-prefixed template metadata (e.g. $comment) so it never reaches the app.
  const carried = {};
  for (const [k, v] of Object.entries(template)) {
    if (!k.startsWith("$")) carried[k] = v;
  }

  // latest + downloads are overlaid; then interpolate ${version} through the
  // editorial strings (notice id/urls).
  return interpolate({ ...carried, latest: version, downloads }, version);
}

// Tiny glob: only `*` is special (matches any run of characters).
function matchGlob(pattern, name) {
  if (!pattern) return false;
  const re = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return re.test(name);
}

// Recursively replace ${version} in every string of a JSON-ish value.
function interpolate(value, version) {
  if (typeof value === "string") return value.replaceAll("${version}", version);
  if (Array.isArray(value)) return value.map((v) => interpolate(v, version));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, version);
    return out;
  }
  return value;
}

export { SignalRoom };
