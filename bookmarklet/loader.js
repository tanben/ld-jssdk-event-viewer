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
 *    Add to your HTML during development. Since the tag loads with the page,
 *    all requests are captured automatically — no reload needed.
 *
 * To remove the viewer from the page, call:
 *    LDJSSDK.remove()
 *
 * Module load order (sequential, each depends on the previous):
 *   1. interceptors.js   — event bus + fetch/XHR/EventSource patches
 *   2. HTM (CDN)         — tagged template library (sets self.htm)
 *   3. panel-html.js     — HTML templates (needs htm)
 *   4. panel.js          — extension panel logic (needs DOM)
 *   5. bookmarklet.js    — wires everything together (needs all above)
 */
(async function () {
  'use strict';

  const LDJSSDK = window.LDJSSDK = window.LDJSSDK || {};

  // Toggle visibility if already loaded
  if (LDJSSDK.active) {
    const element = document.getElementById('ld-event-viewer-root');
    if (element) {
      element.style.display = element.style.display === 'none' ? '' : 'none';
    }
    return;
  }

  // ----------------------------------------------------------------
  // Resolve base URL
  // ----------------------------------------------------------------
  let baseUrl = '';

  const scripts = document.querySelectorAll('script[src]');
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = scripts[i].src;
    if (src.includes('loader.js')) {
      baseUrl = src.replace(/\/loader\.js.*$/, '');
      break;
    }
  }

  if (!baseUrl && LDJSSDK.baseUrl) {
    baseUrl = LDJSSDK.baseUrl;
  }

  if (!baseUrl) {
    console.error('[LD Event Viewer] Could not determine base URL.');
    return;
  }

  // ----------------------------------------------------------------
  // Script loader
  // ----------------------------------------------------------------
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load: ${url}`));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // ----------------------------------------------------------------
  // CSS URLs for the bookmarklet panel (passed to LDJSSDK.init)
  // ----------------------------------------------------------------
  const cssUrls = [
    baseUrl + '/mystyle.css',
    baseUrl + '/bookmarklet-overrides.css',
  ];

  // ----------------------------------------------------------------
  // Load modules sequentially (each depends on the previous)
  // ----------------------------------------------------------------
  const HTM_CDN_URL = 'https://unpkg.com/htm@3/dist/htm.js';

  try {
    await loadScript(baseUrl + '/interceptors.js');
    await loadScript(HTM_CDN_URL);
    await loadScript(baseUrl + '/panel-html.js');
    await loadScript(baseUrl + '/panel.js');
    await loadScript(baseUrl + '/bookmarklet.js');

    if (typeof LDJSSDK.init === 'function') {
      LDJSSDK.init(cssUrls);
    } else {
      console.error('[LD Event Viewer] Init function not found.');
    }
  } catch (error) {
    console.error('[LD Event Viewer] Failed to load:', error);
  }
})();
