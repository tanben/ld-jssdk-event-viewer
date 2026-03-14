/**
 * Network Interceptors for LaunchDarkly SDK Event Viewer (Bookmarklet mode)
 *
 * Monkey-patches fetch, XMLHttpRequest, and EventSource to intercept
 * LaunchDarkly SDK network traffic. This replaces the Chrome extension's
 * chrome.devtools.network.onRequestFinished API.
 *
 * Emits events via the LDJSSDK.bus event bus.
 */
(function () {
  'use strict';

  // ----------------------------------------------------------------
  // LDJSSDK namespace setup
  // ----------------------------------------------------------------
  const LDJSSDK = window.LDJSSDK = window.LDJSSDK || {};

  if (LDJSSDK.interceptorsInstalled) return;
  LDJSSDK.interceptorsInstalled = true;

  // ----------------------------------------------------------------
  // URL pattern constants
  // ----------------------------------------------------------------
  const EVAL_PATH = '/sdk/eval';
  const EVENTS_BULK_PATH = '/events/bulk';
  const GOALS_PATH = '/goals/';
  const STREAM_PATH = 'clientstream';

  // ----------------------------------------------------------------
  // Shared helpers — delegated to panel.js (window.LDPanel) at call
  // time. These are safe because the patched functions only fire when
  // an actual request happens, by which time panel.js is loaded.
  // ----------------------------------------------------------------
  function api() { return window.LDPanel; }

  // ----------------------------------------------------------------
  // Event bus — lightweight pub/sub for inter-module communication
  // ----------------------------------------------------------------
  const bus = LDJSSDK.bus = LDJSSDK.bus || {
    _handlers: {},
    on(event, handler) {
      (this._handlers[event] = this._handlers[event] || []).push(handler);
    },
    off(event, handler) {
      const handlers = this._handlers[event];
      if (!handlers) return;
      this._handlers[event] = handlers.filter(h => h !== handler);
    },
    emit(event, data) {
      const handlers = this._handlers[event] || [];
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.warn('[LD Event Viewer] Error in event handler:', event, error);
        }
      }
    }
  };

  // ----------------------------------------------------------------
  // URL helpers — delegate to panel.js (LDPanel) for shared functions
  // ----------------------------------------------------------------
  function isLDUrl(url) {
    return api().isLaunchDarklyUrl(url);
  }

  // ----------------------------------------------------------------
  // Shared response handler (DRY for fetch and XHR)
  // ----------------------------------------------------------------
  function handleLDResponse({ url, method, getResponseText, getPostBody }) {
    // sdk/eval — flag evaluations (GET responses)
    if (url.includes(EVAL_PATH) && method === 'GET') {
      const responseText = getResponseText();
      if (responseText && typeof responseText.then === 'function') {
        responseText.then(body => emitEvalEvent(url, body));
      } else if (responseText) {
        emitEvalEvent(url, responseText);
      }
    }

    // events/bulk — sent events (POST)
    if (url.includes(EVENTS_BULK_PATH) && method === 'POST') {
      const postBody = getPostBody();
      if (postBody) {
        bus.emit('sent', { url, body: postBody, timestamp: api().getTimestamp() });
      }
    }

    // goals — experiment goals
    if (url.includes(GOALS_PATH) && method === 'GET') {
      const responseText = getResponseText();
      if (responseText && typeof responseText.then === 'function') {
        responseText.then(body => emitGoalsEvent(url, body));
      } else if (responseText) {
        emitGoalsEvent(url, responseText);
      }
    }
  }

  function emitEvalEvent(url, body) {
    if (!body) return;
    try {
      const data = JSON.parse(body);
      if (data && Object.keys(data).length > 0) {
        bus.emit('eval', { url, data, bodyLength: body.length, timestamp: api().getTimestamp() });
      }
    } catch (error) {
      console.warn('[LD Event Viewer] Failed to parse eval response:', error.message);
    }
  }

  function emitGoalsEvent(url, body) {
    if (!body) return;
    try {
      bus.emit('goals', { url, data: JSON.parse(body), timestamp: api().getTimestamp() });
    } catch (error) {
      console.warn('[LD Event Viewer] Failed to parse goals response:', error.message);
    }
  }

  // ----------------------------------------------------------------
  // fetch monkey-patch
  // ----------------------------------------------------------------
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const [input, init = {}] = args;
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    const method = (init.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();

    if (!isLDUrl(url)) return originalFetch.apply(this, args);

    // Capture POST body before it's consumed
    const postBody = init.body || (typeof input !== 'string' && input?.body);
    const postBodyText = typeof postBody === 'string' ? postBody : undefined;

    return originalFetch.apply(this, args).then(response => {
      const clone = response.clone();

      handleLDResponse({
        url,
        method,
        getResponseText: () => clone.text(),
        getPostBody: () => postBodyText,
      });

      return response;
    });
  };

  // ----------------------------------------------------------------
  // XMLHttpRequest monkey-patch
  // ----------------------------------------------------------------
  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function (method, url, ...rest) {
    this._ldMethod = (method || 'GET').toUpperCase();
    this._ldUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  OriginalXHR.prototype.send = function (body) {
    if (this._ldUrl && isLDUrl(this._ldUrl)) {
      const postBodyText = typeof body === 'string' ? body : undefined;

      this.addEventListener('load', () => {
        try {
          handleLDResponse({
            url: this._ldUrl,
            method: this._ldMethod,
            getResponseText: () => this.responseText,
            getPostBody: () => postBodyText,
          });
        } catch (error) {
          console.warn('[LD Event Viewer] XHR handler error:', error.message);
        }
      });
    }
    return originalSend.apply(this, arguments);
  };

  // ----------------------------------------------------------------
  // EventSource monkey-patch (SSE stream connections)
  // ----------------------------------------------------------------
  const OriginalEventSource = window.EventSource;
  if (OriginalEventSource) {
    window.EventSource = function (url, config) {
      const eventSource = new OriginalEventSource(url, config);

      if (url && url.includes(STREAM_PATH) && isLDUrl(url)) {
        const contextHash = api().parseContextHashFromUrl(url);
        bus.emit('stream:open', {
          url,
          hash: contextHash,
          clientId: api().parseClientIDFromUrl(url),
          context: api().parseUrlForContext(url),
          timestamp: api().getTimestamp(),
          eventSource,
        });

        // Track individual SSE events
        const sseEventTypes = ['put', 'patch', 'ping'];
        for (const eventType of sseEventTypes) {
          eventSource.addEventListener(eventType, () => {
            bus.emit('stream:event', {
              hash: contextHash,
              type: eventType,
              timestamp: api().getTimestamp(),
            });
          });
        }
      }

      return eventSource;
    };
    window.EventSource.prototype = OriginalEventSource.prototype;
    window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
    window.EventSource.OPEN = OriginalEventSource.OPEN;
    window.EventSource.CLOSED = OriginalEventSource.CLOSED;
  }
})();
