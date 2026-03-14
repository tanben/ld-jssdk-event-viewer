/**
 * Bookmarklet Loader for LaunchDarkly SDK Event Viewer
 *
 * Two usage modes:
 *
 * 1. Bookmarklet (toolbar button):
 *    Click on any page to inject the viewer. Patches fetch/XHR/EventSource
 *    for the current page session. If the LD SDK already initialized, reload
 *    the page after clicking the bookmarklet so the patches catch the first
 *    requests.
 *
 * 2. Script tag (<script src="loader.js">):
 *    Add to your HTML during development. Since the tag loads before the SDK,
 *    all requests are captured automatically — no reload needed.
 *
 * To remove the viewer from the page, call:
 *    __ldEventViewerRemove()
 */
(function () {
  'use strict';

  // Toggle visibility if already loaded
  if (window.__ldEventViewerActive) {
    var el = document.getElementById('ld-event-viewer-root');
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
    return;
  }

  // ----------------------------------------------------------------
  // Resolve base URL
  // ----------------------------------------------------------------
  var baseUrl = '';

  var scripts = document.querySelectorAll('script[src]');
  for (var i = scripts.length - 1; i >= 0; i--) {
    var src = scripts[i].src;
    if (src.indexOf('loader.js') !== -1) {
      baseUrl = src.replace(/\/loader\.js.*$/, '');
      break;
    }
  }

  if (!baseUrl && window.__ldEventViewerBase) {
    baseUrl = window.__ldEventViewerBase;
  }

  if (!baseUrl) {
    console.error('[LD Event Viewer] Could not determine base URL.');
    return;
  }

  // Global to remove the viewer
  window.__ldEventViewerRemove = function () {
    var root = document.getElementById('ld-event-viewer-root');
    if (root) root.remove();
    window.__ldEventViewerActive = false;
    console.log('[LD Event Viewer] Removed.');
  };

  // ----------------------------------------------------------------
  // Load modules
  // ----------------------------------------------------------------
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load: ' + url)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  var modules = [
    baseUrl + '/interceptors.js',
    baseUrl + '/panel-html.js',
    baseUrl + '/panel.js',
    baseUrl + '/bookmarklet-init.js'
  ];

  var cssUrl = baseUrl + '/bookmarklet.css';

  modules.reduce(function (chain, url) {
    return chain.then(function () { return loadScript(url); });
  }, Promise.resolve()).then(function () {
    if (typeof window.__ldEventViewerInit === 'function') {
      window.__ldEventViewerInit(cssUrl);
    } else {
      console.error('[LD Event Viewer] Init function not found.');
    }
  }).catch(function (err) {
    console.error('[LD Event Viewer] Failed to load:', err);
  });
})();
