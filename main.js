// Detect the visitor's OS to label the download button and highlight the
// matching row in the platform menu. Progressive enhancement: the button
// works as a plain link to the releases page even if this never runs.
(function () {
  var ua = navigator.userAgent || '';
  var os = 'mac';
  if (/Windows|Win64|Win32/i.test(ua)) os = 'win';
  else if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) os = 'linux';
  else if (/Mac|iPhone|iPad|iPod/i.test(ua)) os = 'mac';

  var names = { mac: 'macOS', win: 'Windows', linux: 'Linux' };
  var label = document.getElementById('dl-label');
  if (label && names[os]) label.textContent = 'Download for ' + names[os];

  var menu = document.getElementById('dl-menu');
  var caret = document.getElementById('dl-caret');
  var primary = document.getElementById('dl-primary');
  if (!menu || !caret) return;

  menu.querySelectorAll('a[data-os]').forEach(function (a) {
    if (a.dataset.os === os) {
      a.classList.add('cur');
      a.querySelector('.mk').textContent = '\u25CF';
      if (primary) primary.href = a.href;
    }
  });

  function close() {
    menu.hidden = true;
    caret.setAttribute('aria-expanded', 'false');
  }
  caret.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    caret.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== caret) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
