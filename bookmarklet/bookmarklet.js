/**
 * Bookmarklet entry point — wires the event bus to the extension's
 * panel.js via window.LDPanel, injected as a fixed-position overlay.
 *
 * CSS is loaded into <head> via <link> elements — the extension's
 * mystyle.css plus a small overrides file for bookmarklet-specific
 * panel chrome. The panel HTML is fetched from panel.html (the same
 * file the extension uses) by loader.js.
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
  // Host element — fixed-position overlay
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

  // Track CSS links so we can remove them on cleanup
  const cssLinks = [];

  // ================================================================
  // Load CSS into <head>
  // ================================================================
  function loadCSS(url) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.ldEventViewer = 'true';
      link.onload = resolve;
      link.onerror = () => reject(new Error(`Failed to load CSS: ${url}`));
      document.head.appendChild(link);
      cssLinks.push(link);
    });
  }

  // ================================================================
  // Build panel DOM inside host element
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

    host.appendChild(wrapper);
  }

  // ================================================================
  // Draggable panel header
  // ================================================================
  function makeDraggable() {
    const header = host.querySelector('.panel-header');
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
    const root = document.getElementById('ld-event-viewer-root');
    if (root) root.remove();
    // Clean up CSS links from <head>
    for (const link of cssLinks) {
      if (link.parentNode) link.parentNode.removeChild(link);
    }
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
      wireActions(host, {
        close() {
          host.style.display = 'none';
        },
        minimize() {
          const body = host.querySelector('.panel-body');
          const minimizeBtn = host.querySelector('#minimizeBtn');
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

    // Load stylesheets, then initialize
    const cssPromises = cssUrls.map(url =>
      loadCSS(url).catch(error => {
        console.warn('[LD Event Viewer]', error.message);
      })
    );

    Promise.all(cssPromises).then(doInit);
  };
})();
