/**
 * Network Interceptors for LaunchDarkly SDK Event Viewer (Bookmarklet mode)
 *
 * Monkey-patches fetch, XMLHttpRequest, and EventSource to intercept
 * LaunchDarkly SDK network traffic. This replaces the Chrome extension's
 * chrome.devtools.network.onRequestFinished API.
 *
 * Emits events via a global event bus: window.__ldEventBus
 */
(function () {
  'use strict';

  if (window.__ldInterceptorsInstalled) return;
  window.__ldInterceptorsInstalled = true;

  // ----------------------------------------------------------------
  // Event bus – lightweight pub/sub for inter-module communication
  // ----------------------------------------------------------------
  var bus = window.__ldEventBus = window.__ldEventBus || {
    _handlers: {},
    on: function (evt, fn) {
      (this._handlers[evt] = this._handlers[evt] || []).push(fn);
    },
    emit: function (evt, data) {
      (this._handlers[evt] || []).forEach(function (fn) { fn(data); });
    }
  };

  // ----------------------------------------------------------------
  // Helpers (inline copies of URL parsers from panel.js)
  // ----------------------------------------------------------------
  function isLDUrl(url) {
    return url && (url.includes('launchdarkly.com') || url.includes('launchdarkly.us'));
  }
  function parseContextHashFromUrl(url) {
    var parts = url.split('/');
    var last = parts[parts.length - 1] || '';
    return last.split('?')[0] || null;
  }
  function parseClientIDFromUrl(url) {
    var parts = url.split('/');
    parts.splice(1, 1);
    return parts[parts.length - 3];
  }
  function parseUrlForContext(url) {
    try {
      var hash = parseContextHashFromUrl(url);
      return JSON.parse(atob(hash));
    } catch (e) { return {}; }
  }
  function ts() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }

  // ----------------------------------------------------------------
  // fetch monkey-patch
  // ----------------------------------------------------------------
  var originalFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var input = args[0];
    var init = args[1] || {};
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    var method = (init.method || (input && typeof input !== 'string' && input.method) || 'GET').toUpperCase();

    if (!isLDUrl(url)) return originalFetch.apply(this, args);

    // Capture POST body before it's consumed
    var postBody = init.body || (input && typeof input !== 'string' && input.body) || null;
    var postBodyText = typeof postBody === 'string' ? postBody : null;

    return originalFetch.apply(this, args).then(function (response) {
      var clone = response.clone();

      // sdk/eval → flag evaluations (GET responses)
      if (url.includes('/sdk/eval') && method === 'GET') {
        clone.text().then(function (body) {
          if (!body) return;
          try {
            var data = JSON.parse(body);
            if (data && Object.keys(data).length > 0) {
              bus.emit('eval', { url: url, data: data, bodyLength: body.length, timestamp: ts() });
            }
          } catch (e) { /* ignore */ }
        });
      }

      // events/bulk → sent events (POST)
      if (url.includes('/events/bulk') && method === 'POST' && postBodyText) {
        bus.emit('sent', { url: url, body: postBodyText, timestamp: ts() });
      }

      // goals → experiment goals
      if (url.includes('/goals/') && method === 'GET') {
        clone.text().then(function (body) {
          if (!body) return;
          try {
            bus.emit('goals', { url: url, data: JSON.parse(body), timestamp: ts() });
          } catch (e) { /* ignore */ }
        });
      }

      return response;
    });
  };

  // ----------------------------------------------------------------
  // XMLHttpRequest monkey-patch
  // ----------------------------------------------------------------
  var OrigXHR = window.XMLHttpRequest;
  var xhrOpen = OrigXHR.prototype.open;
  var xhrSend = OrigXHR.prototype.send;

  OrigXHR.prototype.open = function (method, url) {
    this.__ldMethod = (method || 'GET').toUpperCase();
    this.__ldUrl = url;
    return xhrOpen.apply(this, arguments);
  };

  OrigXHR.prototype.send = function (body) {
    var self = this;
    if (self.__ldUrl && isLDUrl(self.__ldUrl)) {
      self.__ldBody = typeof body === 'string' ? body : null;
      self.addEventListener('load', function () {
        try {
          var url = self.__ldUrl;
          var method = self.__ldMethod;
          var responseText = self.responseText;

          if (url.includes('/sdk/eval') && method === 'GET' && responseText) {
            var data = JSON.parse(responseText);
            if (data && Object.keys(data).length > 0) {
              bus.emit('eval', { url: url, data: data, bodyLength: responseText.length, timestamp: ts() });
            }
          }

          if (url.includes('/events/bulk') && method === 'POST' && self.__ldBody) {
            bus.emit('sent', { url: url, body: self.__ldBody, timestamp: ts() });
          }

          if (url.includes('/goals/') && method === 'GET' && responseText) {
            bus.emit('goals', { url: url, data: JSON.parse(responseText), timestamp: ts() });
          }
        } catch (e) { /* ignore */ }
      });
    }
    return xhrSend.apply(this, arguments);
  };

  // ----------------------------------------------------------------
  // EventSource monkey-patch (SSE stream connections)
  // ----------------------------------------------------------------
  var OriginalEventSource = window.EventSource;
  if (OriginalEventSource) {
    window.EventSource = function (url, config) {
      var es = new OriginalEventSource(url, config);
      if (url && url.includes('clientstream') && isLDUrl(url)) {
        var hash = parseContextHashFromUrl(url);
        bus.emit('stream:open', {
          url: url,
          hash: hash,
          clientId: parseClientIDFromUrl(url),
          context: parseUrlForContext(url),
          timestamp: ts(),
          eventSource: es
        });

        // Track individual SSE events
        ['put', 'patch', 'ping'].forEach(function (evtName) {
          es.addEventListener(evtName, function () {
            bus.emit('stream:event', { hash: hash, type: evtName, timestamp: ts() });
          });
        });
      }
      return es;
    };
    window.EventSource.prototype = OriginalEventSource.prototype;
    window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
    window.EventSource.OPEN = OriginalEventSource.OPEN;
    window.EventSource.CLOSED = OriginalEventSource.CLOSED;
  }
})();
