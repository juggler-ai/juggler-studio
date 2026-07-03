// Click-to-zoom lightbox for the page's screenshots and screen recordings.
// Plain ES5-style IIFE, no framework. Every `.shot` (image-slot or <video>)
// becomes clickable and opens a larger view in a full-screen overlay built
// here (no inline HTML/CSS, so the static-site validator stays happy).
(function () {
  'use strict';

  // The big-view source for a thumbnail. Videos expose it directly; an
  // <image-slot> renders its resolved image into a shadow <img part="image">,
  // so read that and fall back to the author-set `src` attribute.
  function shotSrc(el) {
    if (el.tagName.toLowerCase() === 'video') {
      return el.currentSrc || el.getAttribute('src') || '';
    }
    var sr = el.shadowRoot;
    var img = sr && sr.querySelector('img[part="image"]');
    if (img && img.getAttribute('src')) return img.src;
    return el.getAttribute('src') || '';
  }

  function isVideo(el) { return el.tagName.toLowerCase() === 'video'; }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var shots = document.querySelectorAll('.shot');
    if (!shots.length) return;

    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('hidden', '');
    box.setAttribute('aria-hidden', 'true');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    var close = document.createElement('button');
    close.className = 'lightbox-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '\u00d7';

    var stage = document.createElement('div');
    stage.className = 'lightbox-stage';

    box.appendChild(close);
    box.appendChild(stage);
    document.body.appendChild(box);

    var open = false;

    function show(el) {
      var src = shotSrc(el);
      if (!src) return;
      stage.textContent = '';

      var node;
      if (isVideo(el)) {
        node = document.createElement('video');
        node.src = src;
        node.autoplay = true;
        node.loop = true;
        node.muted = true;
        node.setAttribute('playsinline', '');
      } else {
        node = document.createElement('img');
        node.src = src;
        node.alt = '';
      }
      node.className = 'lightbox-media';
      stage.appendChild(node);

      box.removeAttribute('hidden');
      box.setAttribute('aria-hidden', 'false');
      // Reserve the scrollbar's width before hiding overflow so the page
      // content doesn't jump right when the scrollbar disappears.
      var sbw = window.innerWidth - document.documentElement.clientWidth;
      if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
      document.body.classList.add('lightbox-open');
      void box.offsetWidth; // reflow so the fade-in transition runs
      box.classList.add('is-open');
      open = true;
    }

    function hide() {
      if (!open) return;
      open = false;
      box.classList.remove('is-open');
      box.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lightbox-open');
      document.body.style.paddingRight = '';
      // Clear after the fade so any playing video actually stops.
      window.setTimeout(function () {
        if (!open) { stage.textContent = ''; box.setAttribute('hidden', ''); }
      }, 200);
    }

    function bind(el) {
      el.classList.add('shot-zoom');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'View larger');
      el.addEventListener('click', function () { show(el); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          show(el);
        }
      });
    }

    for (var i = 0; i < shots.length; i++) bind(shots[i]);

    // Click anywhere in the overlay — backdrop, image, video, or button — closes it.
    box.addEventListener('click', function () { hide(); });
    document.addEventListener('keydown', function (e) {
      if (open && (e.key === 'Escape' || e.key === 'Esc')) hide();
    });
  });
})();

// Per-OS download links. The page ships with releases/latest hrefs as a no-JS
// fallback; here we read the per-OS asset URLs from the /juggler-version.json
// endpoint (the same one the app's update check uses — served dynamically by
// the Cloudflare Worker from the latest GitHub release) and upgrade the primary
// buttons plus the explicit macOS/Windows/Linux list. OSes with no asset in the
// response keep their fallback href untouched.
(function () {
  'use strict';

  // ?from=web tags this as a website page load so the Worker can keep it out of
  // the app-install analytics (the dataset should only count real update-checks
  // from the desktop app, not everyone who views the landing page).
  var JSON_URL = 'juggler-version.json?from=web';
  var OS_LABEL = { darwin: 'macOS', windows: 'Windows', linux: 'Linux' };

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Best-effort OS sniff. Browsers don't expose CPU arch reliably, so we match
  // on OS family only and take whichever arch the json publishes for it.
  function detectOS() {
    var uaData = navigator.userAgentData;
    var hint = ((uaData && uaData.platform) || navigator.platform || '') + ' ' +
      (navigator.userAgent || '');
    hint = hint.toLowerCase();
    if (hint.indexOf('win') !== -1) return 'windows';
    if (hint.indexOf('mac') !== -1) return 'darwin';
    if (hint.indexOf('linux') !== -1 || hint.indexOf('android') !== -1) return 'linux';
    return '';
  }

  // downloads keys look like "darwin/arm64", "windows/amd64" — match by OS prefix.
  function urlForOS(downloads, os) {
    if (!downloads || !os) return '';
    for (var key in downloads) {
      if (downloads.hasOwnProperty(key) && key.indexOf(os + '/') === 0) {
        var d = downloads[key];
        if (d && d.url) return d.url;
      }
    }
    return '';
  }

  ready(function () {
    fetch(JSON_URL, { cache: 'no-cache' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.downloads) return;
        var downloads = data.downloads;

        // Explicit per-OS links: upgrade each to its direct asset when present.
        // The json keys assets by os/arch only, which today are the desktop
        // installers — so only resolve links in a desktop group. Other app
        // groups (e.g. the terminal server) keep their releases/latest fallback
        // until the json grows per-app asset entries.
        var list = document.querySelectorAll('[data-dl-os]');
        for (var i = 0; i < list.length; i++) {
          var group = list[i].closest('[data-dl-app]');
          var app = group ? group.getAttribute('data-dl-app') : 'desktop';
          if (app !== 'desktop') continue;
          var url = urlForOS(downloads, list[i].getAttribute('data-dl-os'));
          if (url) list[i].href = url;
        }

        // Auto-detected primary buttons: point at the visitor's OS asset and
        // relabel. Only when we actually have a direct asset for that OS — else
        // the generic "Download → releases" fallback stays correct.
        var detected = detectOS();
        var detectedUrl = urlForOS(downloads, detected);
        if (!detected || !detectedUrl) return;
        var primary = document.querySelectorAll('[data-dl-primary]');
        for (var j = 0; j < primary.length; j++) {
          primary[j].href = detectedUrl;
          var span = primary[j].querySelector('.dl-os');
          var tmpl = span && span.getAttribute('data-dl-label');
          if (span && tmpl) span.textContent = tmpl.replace('%s', OS_LABEL[detected]);
        }
      })
      .catch(function () { /* keep the fallback hrefs */ });
  });
})();
