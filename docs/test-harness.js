/**
 * Test harness for the LD SDK Event Viewer demo page (test.html).
 *
 * Provides:
 *   - Mock LD server responses (fetch intercept) for offline testing
 *   - Simulation buttons that fire synthetic SDK events
 *   - Inline panels for identity context, custom event data, and flag evaluation
 *   - Optional live SDK connection via client-side ID input
 *   - Info tooltip toggle for mobile
 *   - Log output
 */
(function () {
  'use strict';

  // ================================================================
  // Info tooltips: click to toggle for mobile, hover handled by CSS
  // ================================================================
  for (const btn of document.querySelectorAll('.info-toggle')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.info-wrap');
      const wasActive = wrap.classList.contains('active');
      for (const w of document.querySelectorAll('.info-wrap.active')) {
        w.classList.remove('active');
      }
      if (!wasActive) wrap.classList.add('active');
    });
  }

  document.addEventListener('click', () => {
    for (const w of document.querySelectorAll('.info-wrap.active')) {
      w.classList.remove('active');
    }
  });

  // ================================================================
  // Log
  // ================================================================
  const logEl = document.getElementById('log');

  function log(msg) {
    logEl.textContent += '[' + new Date().toLocaleTimeString() + '] ' + msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ================================================================
  // Resolve base URL (works on localhost AND GitHub Pages subpaths)
  // ================================================================
  const base = window.location.origin +
    window.location.pathname.replace(/\/test\.html$/, '').replace(/\/$/, '') +
    '/dist/v1';

  // ================================================================
  // Bookmarklet drag link
  // ================================================================
  const bmCode = "javascript:void(function(){var s=document.createElement('script');" +
    "s.src='" + base + "/loader.js';" +
    "(document.head||document.documentElement).appendChild(s)})()";

  document.getElementById('bmDrag').href = bmCode;

  // ================================================================
  // Launch the bookmarklet
  // ================================================================
  document.getElementById('launchBtn').addEventListener('click', () => {
    const s = document.createElement('script');
    s.src = base + '/loader.js';
    (document.head || document.documentElement).appendChild(s);
    log('Loaded bookmarklet from ' + base);
    document.body.style.maxWidth = 'calc(100vw - 500px)';
    document.body.style.margin = '0 0 0 10px';
  });

  // ================================================================
  // Panel toggle — clicking a toggle button opens/closes its panel
  // ================================================================
  function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    // Close other panels
    for (const p of document.querySelectorAll('.op-panel.open')) {
      if (p.id !== panelId) p.classList.remove('open');
    }
    panel.classList.toggle('open');
  }

  document.getElementById('simIdentifyToggle').addEventListener('click', () => togglePanel('identityPanel'));
  document.getElementById('simCustomToggle').addEventListener('click', () => togglePanel('customPanel'));
  document.getElementById('evalToggle').addEventListener('click', () => togglePanel('evalPanel'));

  // ================================================================
  // Mode: mock (default) or live (real LD SDK)
  // ================================================================
  let liveClient = null;

  // ================================================================
  // Mock data
  // ================================================================
  const MOCK_CLIENT_ID = '6123456789abcdef01234567';

  const DEFAULT_CONTEXT = {
    kind: 'multi',
    user: { key: 'user-123', name: 'Jane Doe', email: 'jane@acme.com', plan: 'enterprise' },
    org: { key: 'org-456', name: 'Acme Corp', tier: 'premium' },
    device: { key: 'device-789', os: 'macOS', browser: 'Chrome' },
  };

  const DEFAULT_EVENT_DATA = {
    key: 'page-load-time',
    metricValue: 1234,
    data: { url: 'https://example.com/dashboard', component: 'main-nav', duration_ms: 1234 },
  };

  let customFlags = null;
  let customContextHash = null;

  const MOCK_FLAGS = {
    'enable-new-ui': { value: true, variation: 0, version: 12, reason: { kind: 'RULE_MATCH', ruleIndex: 0, inExperiment: true } },
    'dark-mode': { value: false, variation: 1, version: 5, reason: { kind: 'FALLTHROUGH' } },
    'banner-text': { value: 'Welcome!', variation: 2, version: 3, reason: { kind: 'TARGET_MATCH' } },
    'max-items': { value: 50, variation: 0, version: 7, reason: { kind: 'FALLTHROUGH' } },
    'feature-config': { value: { theme: 'blue', layout: 'grid' }, variation: 1, version: 2, reason: { kind: 'FALLTHROUGH' } },
  };

  const MOCK_GOALS = [
    { kind: 'pageview', key: 'homepage-view', urls: [{ kind: 'substring', substring: 'test.html' }] },
    { kind: 'click', key: 'signup-click', selector: '#simAll', urls: [{ kind: 'substring', substring: 'test.html' }] },
    { kind: 'click', key: 'missing-element', selector: '#nonexistent', urls: [{ kind: 'substring', substring: 'test.html' }] },
  ];

  // ================================================================
  // Editors — identity context, event data, eval context
  // ================================================================
  const identityContextEl = document.getElementById('identityContext');
  const eventDataEditorEl = document.getElementById('eventDataEditor');
  const evalContextEl = document.getElementById('evalContext');

  identityContextEl.value = JSON.stringify(DEFAULT_CONTEXT, null, 2);
  eventDataEditorEl.value = JSON.stringify(DEFAULT_EVENT_DATA, null, 2);
  evalContextEl.value = JSON.stringify(DEFAULT_CONTEXT, null, 2);

  document.getElementById('resetIdentityContext').addEventListener('click', () => {
    identityContextEl.value = JSON.stringify(DEFAULT_CONTEXT, null, 2);
    log('Identity context reset');
  });

  document.getElementById('resetEventData').addEventListener('click', () => {
    eventDataEditorEl.value = JSON.stringify(DEFAULT_EVENT_DATA, null, 2);
    log('Event data reset');
  });

  document.getElementById('resetEvalContext').addEventListener('click', () => {
    evalContextEl.value = JSON.stringify(DEFAULT_CONTEXT, null, 2);
    log('Eval context reset');
  });

  function parseJSON(el, label) {
    try {
      const obj = JSON.parse(el.value);
      if (!obj || typeof obj !== 'object') {
        log(label + ' must be a JSON object');
        return null;
      }
      return obj;
    } catch (e) {
      log('Invalid ' + label + ' JSON: ' + e.message);
      return null;
    }
  }

  // ================================================================
  // Mock server (intercepts fetch when no live SDK)
  // ================================================================
  function mockResponse(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url || '');

    if (url.includes('app.launchdarkly.com/sdk/evalx/') && url.includes(MOCK_CLIENT_ID)) {
      if (customFlags && customContextHash && url.includes(customContextHash)) {
        log('Mock: responding to evalx with custom flags (' + Object.keys(customFlags).length + ' flags)');
        const flags = customFlags;
        customFlags = null;
        customContextHash = null;
        return Promise.resolve(mockResponse(flags));
      }
      log('Mock: responding to evalx request');
      return Promise.resolve(mockResponse(MOCK_FLAGS));
    }

    if (url.includes('events.launchdarkly.com/events/bulk/') && url.includes(MOCK_CLIENT_ID)) {
      log('Mock: acknowledging events/bulk POST');
      return Promise.resolve(new Response('', { status: 202 }));
    }

    if (url.includes('app.launchdarkly.com/sdk/goals/') && url.includes(MOCK_CLIENT_ID)) {
      log('Mock: responding to goals request');
      return Promise.resolve(mockResponse(MOCK_GOALS));
    }

    return originalFetch.apply(this, arguments);
  };

  // ================================================================
  // SDK key input — connect to real LD environment
  // ================================================================
  const sdkKeyInput = document.getElementById('sdkKeyInput');
  const sdkKeyBtn = document.getElementById('sdkKeyBtn');
  const sdkKeyDetails = document.getElementById('sdkKeyDetails');
  const sdkKeySummary = document.getElementById('sdkKeySummary');

  const savedKey = localStorage.getItem('ld-demo-sdk-key');
  if (savedKey) connectLive(savedKey);

  sdkKeyBtn.addEventListener('click', () => {
    const key = sdkKeyInput.value.trim();
    if (!key) { log('Enter a client-side ID first.'); return; }
    localStorage.setItem('ld-demo-sdk-key', key);
    connectLive(key);
  });

  function connectLive(clientSideId) {
    log('Loading LD JS SDK...');
    sdkKeyBtn.disabled = true;
    sdkKeyBtn.textContent = 'Loading...';

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/launchdarkly-js-client-sdk@3';
    script.onload = () => {
      log('LD JS SDK loaded, initializing with key: ' + clientSideId.substring(0, 6) + '...');
      const context = { kind: 'user', key: 'demo-user-' + Date.now(), name: 'Demo User', email: 'demo@example.com' };
      liveClient = LDClient.initialize(clientSideId, context, { evaluationReasons: true });

      liveClient.on('ready', () => {
        log('LIVE: SDK connected — ' + Object.keys(liveClient.allFlags()).length + ' flags loaded');
        switchToLive();
      });

      liveClient.on('failed', () => {
        log('LIVE: SDK failed to connect — check your client-side ID');
        sdkKeyBtn.disabled = false;
        sdkKeyBtn.textContent = 'Connect';
        liveClient = null;
      });
    };

    script.onerror = () => {
      log('Failed to load LD JS SDK from CDN');
      sdkKeyBtn.disabled = false;
      sdkKeyBtn.textContent = 'Connect';
    };

    (document.head || document.documentElement).appendChild(script);
  }

  function switchToLive() {
    sdkKeyDetails.open = false;
    sdkKeySummary.innerHTML = '<span class="sdk-key-status">\u2713 Connected to LD</span>';
    document.getElementById('simHeader').innerHTML =
      'Try it out <span class="sdk-live-badge">LIVE</span>';
    document.getElementById('simDesc').innerHTML =
      '<small>These buttons trigger real SDK calls against your LD environment.</small>';
  }

  // ================================================================
  // Simulation functions (mock or live)
  // ================================================================
  function simSentEvents(events) {
    const url = 'https://events.launchdarkly.com/events/bulk/' + MOCK_CLIENT_ID;
    log('POSTing ' + events.length + ' event(s) to: ' + url);
    fetch(url, {
      method: 'POST',
      body: JSON.stringify(events),
      headers: { 'Content-Type': 'application/json' },
    }).then(() => { log('Events acknowledged'); });
  }

  function simEval() {
    if (liveClient) {
      log('LIVE: Fetching all flags...');
      const flags = liveClient.allFlags();
      log('LIVE: ' + Object.keys(flags).length + ' flags — ' +
        JSON.stringify(flags).substring(0, 200) + '...');
      return;
    }
    const context = parseJSON(identityContextEl, 'context');
    if (!context) return;
    const contextHash = btoa(JSON.stringify(context));
    const url = 'https://app.launchdarkly.com/sdk/evalx/' + MOCK_CLIENT_ID +
      '/contexts/' + contextHash;
    log('Fetching flags for context: ' + (context.user?.key || context.key || '?'));
    fetch(url).then(() => { log('Eval response processed'); });
  }

  function simIdentify() {
    const context = parseJSON(identityContextEl, 'context');
    if (!context) return;

    if (liveClient) {
      const identifyCtx = context.kind === 'multi' && context.user ? context.user : context;
      if (!identifyCtx.kind) identifyCtx.kind = 'user';
      log('LIVE: Calling identify(' + identifyCtx.key + ')...');
      liveClient.identify(identifyCtx).then(() => {
        log('LIVE: identify complete — ' +
          Object.keys(liveClient.allFlags()).length + ' flags re-evaluated');
      });
      return;
    }
    log('Sending identify event for: ' + (context.user?.key || context.key || '?'));
    simSentEvents([
      { kind: 'identify', key: context.user?.key || context.key || 'anonymous', context: context, creationDate: Date.now() },
    ]);
  }

  function simCustom() {
    const eventData = parseJSON(eventDataEditorEl, 'event data');
    if (!eventData) return;
    const key = eventData.key || 'custom-event';

    if (liveClient) {
      log('LIVE: Calling track("' + key + '", data, ' + (eventData.metricValue || 0) + ')...');
      liveClient.track(key, eventData.data || {}, eventData.metricValue || undefined);
      liveClient.flush();
      log('LIVE: Custom event tracked and flushed');
      return;
    }
    log('Sending custom event: ' + key + ' (metricValue: ' + (eventData.metricValue || 'none') + ')');
    simSentEvents([
      { kind: 'custom', key: key, data: eventData.data || {}, metricValue: eventData.metricValue || undefined, creationDate: Date.now() },
    ]);
  }

  function simFeatureEvents() {
    if (liveClient) {
      log('LIVE: Reading flag variations to generate feature events...');
      const flags = liveClient.allFlags();
      const keys = Object.keys(flags).slice(0, 5);
      for (const k of keys) { liveClient.variation(k); }
      liveClient.flush();
      log('LIVE: Evaluated ' + keys.length + ' flags, events flushed');
      return;
    }
    simSentEvents([
      { kind: 'feature', key: 'enable-new-ui', value: true, variation: 0, version: 12, default: false, creationDate: Date.now(), reason: { kind: 'RULE_MATCH', inExperiment: true } },
      { kind: 'feature', key: 'dark-mode', value: false, variation: 1, version: 5, default: false, creationDate: Date.now() },
      {
        kind: 'summary', startDate: Date.now() - 60000, endDate: Date.now(),
        features: {
          'enable-new-ui': { default: false, counters: [{ value: true, variation: 0, version: 12, count: 3 }] },
          'dark-mode': { default: false, counters: [{ value: false, variation: 1, version: 5, count: 7 }] },
        },
      },
    ]);
  }

  function simGoals() {
    if (liveClient) {
      log('LIVE: Goals are fetched automatically by the SDK on init.');
      return;
    }
    const url = 'https://app.launchdarkly.com/sdk/goals/' + MOCK_CLIENT_ID;
    log('Fetching goals: ' + url);
    fetch(url).then(() => { log('Goals response processed'); });
  }

  function simStream() {
    if (liveClient) {
      log('LIVE: Streaming connection is already open. Change a flag in LD to see an update.');
      return;
    }
    const context = parseJSON(identityContextEl, 'context');
    if (!context) return;
    const contextHash = btoa(JSON.stringify(context));
    log('Simulating stream connection...');
    try {
      const streamUrl = 'https://clientstream.launchdarkly.com/eval/' +
        MOCK_CLIENT_ID + '/' + contextHash;
      const es = new EventSource(streamUrl);
      es.onerror = () => {
        es.close();
        log('Stream closed (expected – mock endpoint)');
      };
    } catch (e) {
      log('Stream simulation error: ' + e.message);
    }
  }

  function simAll() {
    simEval();
    setTimeout(simIdentify, 200);
    setTimeout(simFeatureEvents, 400);
    setTimeout(simCustom, 600);
    setTimeout(simGoals, 800);
    setTimeout(simStream, 1000);
  }

  // ================================================================
  // Evaluate section — single flag + own context
  // ================================================================
  const FLAG_DEFAULTS = {
    'enable-new-ui':    'true',
    'dark-mode':        'false',
    'banner-text':      '"Welcome back!"',
    'max-items':        '100',
    'checkout-flow':    '"multi-step"',
    'rate-limit':       '5000',
    'maintenance-mode': 'false',
  };

  const flagPickerEl = document.getElementById('flagPicker');
  const customFlagKeyEl = document.getElementById('customFlagKey');
  const flagValueEl = document.getElementById('flagValue');
  const evalStatusEl = document.getElementById('evalStatus');
  let evalCounter = 0;

  function setEvalStatus(msg, isError) {
    evalStatusEl.textContent = msg;
    evalStatusEl.className = 'eval-status' + (isError ? ' error' : '');
    if (msg) setTimeout(() => { evalStatusEl.textContent = ''; }, 4000);
  }

  function parseValue(raw) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === '' || raw === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    try { return JSON.parse(raw); }
    catch (e) { return raw; }
  }

  flagPickerEl.addEventListener('change', () => {
    const isCustom = flagPickerEl.value === '__custom';
    customFlagKeyEl.style.display = isCustom ? '' : 'none';
    if (isCustom) {
      customFlagKeyEl.focus();
      flagValueEl.value = '';
    } else {
      flagValueEl.value = FLAG_DEFAULTS[flagPickerEl.value] || '';
    }
  });

  flagValueEl.value = FLAG_DEFAULTS[flagPickerEl.value] || 'true';

  document.getElementById('evalBtn').addEventListener('click', () => {
    const flagKey = flagPickerEl.value === '__custom'
      ? customFlagKeyEl.value.trim()
      : flagPickerEl.value;

    if (!flagKey) {
      setEvalStatus('Enter a flag key', true);
      customFlagKeyEl.focus();
      return;
    }

    const rawValue = flagValueEl.value.trim();
    const value = parseValue(rawValue);

    const context = parseJSON(evalContextEl, 'eval context');
    if (!context) {
      setEvalStatus('Fix context JSON first', true);
      return;
    }

    evalCounter++;

    const flagResponse = {};
    flagResponse[flagKey] = {
      value: value,
      variation: typeof value === 'boolean' ? (value ? 0 : 1) : 0,
      version: evalCounter,
      reason: { kind: 'RULE_MATCH', ruleIndex: 0 },
    };

    const contextHash = btoa(JSON.stringify(context));
    customFlags = flagResponse;
    customContextHash = contextHash;

    const evalUrl = 'https://app.launchdarkly.com/sdk/evalx/' + MOCK_CLIENT_ID +
      '/contexts/' + contextHash;
    log('Evaluating ' + flagKey + ' = ' + JSON.stringify(value) +
      ' for ' + (context.user?.key || context.key || '?'));
    fetch(evalUrl).then(() => {
      log('Done — check the viewer panel');
      setEvalStatus(flagKey + ' = ' + JSON.stringify(value));
    });

    setTimeout(() => {
      simSentEvents([
        { kind: 'feature', key: flagKey, value: value,
          variation: flagResponse[flagKey].variation,
          version: evalCounter,
          default: value === true ? false : null,
          creationDate: Date.now(),
          reason: { kind: 'RULE_MATCH', ruleIndex: 0 } },
      ]);
    }, 200);
  });

  // ================================================================
  // Wire up buttons
  // ================================================================
  document.getElementById('simEval').addEventListener('click', simEval);
  document.getElementById('simIdentify').addEventListener('click', simIdentify);
  document.getElementById('simCustom').addEventListener('click', simCustom);
  document.getElementById('simGoals').addEventListener('click', simGoals);
  document.getElementById('simStream').addEventListener('click', simStream);
  document.getElementById('simAll').addEventListener('click', simAll);

  log('Ready. Launch the event viewer, then send some traffic.');
})();
