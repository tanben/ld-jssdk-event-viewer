/**
 * Main script for the LD SDK Event Viewer docs landing page (index.html).
 *
 * Handles:
 *   - Dynamic bookmarklet URL generation based on current origin
 *   - Tab switching with hash-based deep linking
 *   - Clipboard copy helpers for code snippets
 */
(function () {
  'use strict';

  // ----------------------------------------------------------------
  // Dynamic URLs — resolve dist path relative to current page
  // ----------------------------------------------------------------
  const base = window.location.origin +
    window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') +
    '/dist/v1';

  const bmCode = "javascript:void(function(){var s=document.createElement('script');" +
    "s.src='" + base + "/loader.js';" +
    "(document.head||document.documentElement).appendChild(s)})()";

  document.getElementById('bm').href = bmCode;
  document.getElementById('bmUrl').value = bmCode;

  document.getElementById('scriptSnippet').textContent =
    '<script src="' + base + '/loader.js"><\/script>';

  // ----------------------------------------------------------------
  // Tabs
  // ----------------------------------------------------------------
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  function activateTab(tabId) {
    for (const btn of tabButtons) {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    }
    for (const panel of tabPanels) {
      panel.classList.toggle('active', panel.id === 'tab-' + tabId);
    }
  }

  for (const btn of tabButtons) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      activateTab(tab);
      if (tab === 'bookmarklet') {
        history.replaceState(null, '', '#bookmarklet');
      } else {
        history.replaceState(null, '', window.location.pathname);
      }
    });
  }

  // Auto-select bookmarklet tab when linked via #bookmarklet
  if (window.location.hash === '#bookmarklet') {
    activateTab('bookmarklet');
  }

  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#bookmarklet') {
      activateTab('bookmarklet');
    } else {
      activateTab('extension');
    }
  });

  // ----------------------------------------------------------------
  // Clipboard helpers
  // ----------------------------------------------------------------
  window.copy = function (inputId, btn) {
    const el = document.getElementById(inputId);
    el.select();
    navigator.clipboard.writeText(el.value).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  };

  window.copyPre = function (preId, btn) {
    const code = document.getElementById(preId).querySelector('code');
    navigator.clipboard.writeText(code.textContent).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  };
})();
