/**
 * Bookmarklet initializer – thin adapter that wires the event bus
 * to the extension's panel.js via window.LDPanel.
 *
 * Bookmarklet-specific responsibilities:
 *   1. Shadow DOM host creation & CSS loading
 *   2. Draggable panel header
 *   3. Close / minimize buttons
 *   4. Wire event bus (window.__ldEventBus) → LDPanel handlers
 *
 * Requires (loaded in order by loader.js):
 *   - interceptors.js     (window.__ldEventBus)
 *   - panel-html.js       (window.__ldPanelHTML)
 *   - panel.js            (window.LDPanel)
 */
(function () {
  'use strict';

  // Prevent double-init; toggle visibility if re-invoked
  if (window.__ldEventViewerActive) {
    var existing = document.getElementById('ld-event-viewer-root');
    if (existing) existing.style.display = existing.style.display === 'none' ? '' : 'none';
    return;
  }
  window.__ldEventViewerActive = true;

  var bus = window.__ldEventBus;
  var panelHTML = window.__ldPanelHTML;
  var api = window.LDPanel;
  if (!bus || !panelHTML || !api) {
    console.error('[LD Event Viewer] Missing dependencies.');
    return;
  }

  // ================================================================
  // Shadow DOM host
  // ================================================================
  var host = document.createElement('div');
  host.id = 'ld-event-viewer-root';
  host.style.cssText = [
    'position:fixed', 'top:0', 'right:0',
    'width:480px', 'height:100vh',
    'z-index:2147483647',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
  ].join(';') + ';';
  document.documentElement.appendChild(host);

  var shadow = host.attachShadow({ mode: 'open' });

  // ================================================================
  // Load CSS into shadow DOM & build panel
  // ================================================================
  function loadCSS(url) {
    return new Promise(function (ok, fail) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = ok;
      link.onerror = fail;
      shadow.appendChild(link);
    });
  }

  function buildPanel() {
    var wrap = document.createElement('div');
    wrap.className = 'ld-viewer-panel';
    wrap.innerHTML = panelHTML();
    shadow.appendChild(wrap);
  }

  // ================================================================
  // Draggable
  // ================================================================
  function makeDraggable() {
    var hdr = shadow.querySelector('.panel-header');
    if (!hdr) return;
    var dragging = false, sx, sy, sr, st;
    hdr.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      var r = host.getBoundingClientRect();
      sr = window.innerWidth - r.right; st = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      host.style.right = Math.max(0, sr - (e.clientX - sx)) + 'px';
      host.style.top = Math.max(0, st + (e.clientY - sy)) + 'px';
    });
    document.addEventListener('mouseup', function () { dragging = false; });
  }

  // ================================================================
  // Bookmarklet-only buttons (close, minimize)
  // ================================================================
  function setupBookmarkletButtons() {
    var closeBtn = shadow.querySelector('#closeBtn');
    if (closeBtn) closeBtn.addEventListener('click', function () { host.style.display = 'none'; });

    var minimizeBtn = shadow.querySelector('#minimizeBtn');
    if (minimizeBtn) minimizeBtn.addEventListener('click', function () {
      var body = shadow.querySelector('.panel-body');
      if (body.style.display === 'none') {
        body.style.display = '';
        host.style.height = '100vh';
        minimizeBtn.innerHTML = '&#x2015;';
      } else {
        body.style.display = 'none';
        host.style.height = 'auto';
        minimizeBtn.innerHTML = '&#x25A1;';
      }
    });
  }

  // ================================================================
  // Wire event bus → LDPanel handlers
  // ================================================================
  function wireEvents() {
    bus.on('eval', function (d) { api.handleEval(d); });
    bus.on('sent', function (d) { api.handleSent(d); });
    bus.on('goals', function (d) { api.handleGoals(d); });
    bus.on('stream:open', function (d) { api.handleStreamOpen(d); });
    bus.on('stream:event', function (d) { api.handleStreamEvent(d); });
  }

  // ================================================================
  // Boot
  // ================================================================
  window.__ldEventViewerInit = function (cssUrl) {
    var doInit = function () {
      buildPanel();

      // Point panel.js at the shadow DOM
      api.setRoot(shadow);
      api.setupButtons();

      setupBookmarkletButtons();
      makeDraggable();
      wireEvents();
      api.showToast('LD Event Viewer active \u2013 intercepting SDK traffic', 'info');
    };

    loadCSS(cssUrl).then(doInit).catch(function () {
      doInit();
    });
  };

  // Auto-init if CSS URL was pre-set by loader
  if (window.__ldEventViewerCSSUrl) {
    window.__ldEventViewerInit(window.__ldEventViewerCSSUrl);
  }
})();
