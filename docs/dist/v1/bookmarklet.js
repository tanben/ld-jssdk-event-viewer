/**
 * Bookmarklet entry point — wires the event bus to the extension's
 * panel.js via window.LDPanel, injected as a fixed-position overlay.
 *
 * Uses Shadow DOM to isolate the panel's CSS from the host page.
 * panel.js uses document.querySelector / document.getElementById
 * throughout, so we temporarily patch those methods to search the
 * shadow root first while panel.js initializes — and leave the
 * patches in place so ongoing handler calls (handleEval, etc.)
 * also find elements inside the shadow.
 *
 * data-action pattern:
 *   Interactive elements use data-action="event->handlerName" attributes.
 *   wireActions() reads these and binds event listeners to the
 *   corresponding handler functions, similar to Stimulus.
 *
 * Requires (loaded in order by loader.js):
 *   - interceptors.js        (LDJSSDK.bus)
 *   - panel.html (fetched)   (LDJSSDK.panelBodyHTML)
 *   - panel.js               (window.LDPanel)
 */
(function () {
  'use strict';

  const LDJSSDK = window.LDJSSDK = window.LDJSSDK || {};
  const api = window.LDPanel;

  // Prevent double-init; toggle visibility if re-invoked
  if (LDJSSDK.active) {
    const existing = document.getElementById('ld-event-viewer-root');
    if (existing) {
      existing.style.display = existing.style.display === 'none' ? '' : 'none';
    }
    return;
  }
  LDJSSDK.active = true;

  const bus = LDJSSDK.bus;
  const panelBodyHTML = LDJSSDK.panelBodyHTML;

  if (!bus || !panelBodyHTML || !api) {
    console.error('[LD Event Viewer] Missing dependencies:', {
      bus: !!bus,
      panelBodyHTML: !!panelBodyHTML,
      api: !!api,
    });
    return;
  }

  // ================================================================
  // wireActions — Stimulus-inspired declarative event binding
  // ================================================================
  function wireActions(root, actions) {
    for (const element of root.querySelectorAll('[data-action]')) {
      const [event, handlerName] = element.dataset.action.split('->');
      const handler = actions[handlerName];
      if (handler) {
        element.addEventListener(event, handler);
      } else {
        console.warn(`[LD Event Viewer] No handler for action: ${handlerName}`);
      }
    }
  }

  // ================================================================
  // Host element + Shadow DOM
  // ================================================================
  const host = document.createElement('div');
  host.id = 'ld-event-viewer-root';
  host.style.cssText = [
    'position:fixed', 'top:0', 'right:0',
    'width:480px', 'height:100vh',
    'z-index:2147483647',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
  ].join(';') + ';';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // ================================================================
  // Patch document query methods to search shadow root first.
  // panel.js uses document.querySelector, document.getElementById,
  // and document.querySelectorAll extensively — these patches let
  // it find elements inside the shadow without any changes.
  // ================================================================
  const _getElementById = document.getElementById.bind(document);
  const _querySelector = document.querySelector.bind(document);
  const _querySelectorAll = document.querySelectorAll.bind(document);

  document.getElementById = function (id) {
    return shadow.getElementById(id) || _getElementById(id);
  };

  document.querySelector = function (sel) {
    try { var el = shadow.querySelector(sel); if (el) return el; } catch (e) {}
    return _querySelector(sel);
  };

  document.querySelectorAll = function (sel) {
    try {
      var shadowResults = shadow.querySelectorAll(sel);
      if (shadowResults.length > 0) return shadowResults;
    } catch (e) {}
    return _querySelectorAll(sel);
  };

  // Also patch window.document variants (panel.js uses window.document.querySelector)
  if (window.document.querySelector !== document.querySelector) {
    window.document.querySelector = document.querySelector;
    window.document.querySelectorAll = document.querySelectorAll;
  }

  // ================================================================
  // Load CSS into shadow root
  // ================================================================
  function loadCSS(url) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = resolve;
      link.onerror = () => reject(new Error(`Failed to load CSS: ${url}`));
      shadow.appendChild(link);
    });
  }

  // ================================================================
  // Build panel DOM inside shadow root
  // ================================================================
  function buildPanel() {
    const wrapper = document.createElement('div');
    wrapper.className = 'ld-viewer-panel';

    // Bookmarklet chrome: draggable header with minimize/close controls,
    // wrapping panel.html's body content in a scrollable container.
    wrapper.innerHTML =
      '<div class="panel-header">' +
        '<div class="panel-title-row">' +
          '<h1>LD SDK Event Viewer</h1>' +
          '<button id="minimizeBtn" class="panel-control-btn" data-action="click->minimize" title="Minimize">\u2015</button>' +
          '<button id="closeBtn" class="panel-control-btn close" data-action="click->close" title="Close">\u00D7</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel-body">' + panelBodyHTML + '</div>';

    shadow.appendChild(wrapper);
  }

  // ================================================================
  // Draggable panel header
  // ================================================================
  function makeDraggable() {
    const header = shadow.querySelector('.panel-header');
    if (!header) return;

    let isDragging = false;
    let startClientX = 0;
    let startClientY = 0;
    let startRight = 0;
    let startTop = 0;

    header.addEventListener('mousedown', (event) => {
      if (event.target.tagName === 'BUTTON') return;

      isDragging = true;
      startClientX = event.clientX;
      startClientY = event.clientY;

      const rect = host.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;

      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!isDragging) return;
      const deltaX = event.clientX - startClientX;
      const deltaY = event.clientY - startClientY;
      host.style.right = Math.max(0, startRight - deltaX) + 'px';
      host.style.top = Math.max(0, startTop + deltaY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // ================================================================
  // Wire event bus → LDPanel handlers
  // ================================================================
  function wireEventBus() {
    bus.on('eval', (data) => api.handleEval(data));
    bus.on('sent', (data) => api.handleSent(data));
    bus.on('goals', (data) => api.handleGoals(data));
    bus.on('stream:open', (data) => api.handleStreamOpen(data));
    bus.on('stream:event', (data) => api.handleStreamEvent(data));
  }

  // ================================================================
  // Global remove function
  // ================================================================
  LDJSSDK.remove = function () {
    // Restore original document methods
    document.getElementById = _getElementById;
    document.querySelector = _querySelector;
    document.querySelectorAll = _querySelectorAll;

    const root = document.getElementById('ld-event-viewer-root');
    if (root) root.remove();
    LDJSSDK.active = false;
    console.log('[LD Event Viewer] Removed.');
  };

  // ================================================================
  // Boot
  // ================================================================
  LDJSSDK.init = function (cssUrls) {
    const doInit = function () {
      buildPanel();
      api.setupButtons();

      // Wire data-action handlers for bookmarklet-specific buttons
      wireActions(shadow, {
        close() {
          host.style.display = 'none';
        },
        minimize() {
          const body = shadow.querySelector('.panel-body');
          const minimizeBtn = shadow.querySelector('#minimizeBtn');
          if (body.style.display === 'none') {
            body.style.display = '';
            host.style.height = '100vh';
            minimizeBtn.innerHTML = '\u2015';
          } else {
            body.style.display = 'none';
            host.style.height = 'auto';
            minimizeBtn.innerHTML = '\u25A1';
          }
        },
      });

      makeDraggable();
      wireEventBus();
      api.showToast('LD Event Viewer active \u2013 intercepting SDK traffic', 'info');
    };

    // Load stylesheets into shadow root, then initialize
    const cssPromises = cssUrls.map(url =>
      loadCSS(url).catch(error => {
        console.warn('[LD Event Viewer]', error.message);
      })
    );

    Promise.all(cssPromises).then(doInit);
  };
})();
