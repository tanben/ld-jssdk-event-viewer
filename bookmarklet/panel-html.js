/**
 * Panel HTML template for the bookmarklet overlay.
 *
 * Exports a function that returns the full panel markup as a string.
 * Loaded by the panel module and injected into the shadow DOM.
 */
(function () {
  'use strict';

  function section(id, title, containerId, opts) {
    opts = opts || {};
    var hide = opts.hidden ? ' style="display:none"' : '';
    var hasToggle = opts.toggle !== false;
    var copyTarget = opts.copyTarget || '';

    var h = '<div id="' + id + '" class="collapsible-section"' + hide + '>' +
      '<div class="section-header" data-target="' + containerId + '">' +
        '<span class="collapse-icon"></span>' +
        '<h3>' + title + (opts.countId ? ' <span id="' + opts.countId + '" class="section-count" data-count="0"></span>' : '') + '</h3>';

    if (hasToggle) {
      h += '<div class="view-toggle">' +
        '<button class="toggle-btn active" data-view="formatted" data-container="' + opts.containerKey + '">Formatted</button>' +
        '<button class="toggle-btn" data-view="raw" data-container="' + opts.containerKey + '">Raw</button>' +
      '</div>';
    }

    if (copyTarget) {
      h += '<button class="copy-btn" data-copy-target="' + copyTarget + '" title="Copy to clipboard">Copy</button>';
    }

    h += '</div>'; // end section-header
    h += '<div id="' + containerId + '" class="section-content">';
    h += opts.body || '';
    h += '</div></div>';
    return h;
  }

  function emptyState(id, msg, dataFor) {
    return '<div class="empty-state" id="' + id + '"' +
      (dataFor ? ' data-for="' + dataFor + '"' : '') +
      '>' + msg + '</div>';
  }

  function rawFormattedViews(prefix, rawId, formattedBody, rawClass) {
    return '<div id="' + prefix + 'RawView" class="view-panel" style="display:none;">' +
        '<textarea id="' + (rawId || '') + '" class="' + (rawClass || 'json-display') + '"></textarea>' +
      '</div>' +
      '<div id="' + prefix + 'FormattedView" class="view-panel" style="display:none;">' +
        formattedBody +
      '</div>';
  }

  function dataTable(id, headers, bodyId) {
    var h = '<div id="' + id + '" class="data-table"><div class="data-table-header">';
    headers.forEach(function (hdr) { h += '<div class="data-table-cell">' + hdr + '</div>'; });
    h += '</div><div id="' + bodyId + '" class="data-table-body"></div></div>';
    return h;
  }

  window.__ldPanelHTML = function () {
    return '' +
      '<div id="toast-container"></div>' +

      // Header
      '<div class="panel-header">' +
        '<div class="panel-title-row">' +
          '<h1>LD SDK Event Viewer</h1>' +
          '<button id="minimizeBtn" class="panel-control-btn" title="Minimize">&#x2015;</button>' +
          '<button id="closeBtn" class="panel-control-btn close" title="Close">&times;</button>' +
        '</div>' +
        '<div class="action-buttons">' +
          '<button id="clearBtn" class="action-btn clear-btn">Clear All</button>' +
          '<button id="exportBtn" class="action-btn export-btn">Export Data</button>' +
        '</div>' +
      '</div>' +

      // Scrollable body
      '<div class="panel-body">' +

        // Counters
        '<div id="typescounterContainer" class="types-counter">' +
          '<h3 id="clientIDValue"></h3>' +
          '<h3 class="counters-title">Counters</h3>' +
          '<div class="table-row">' +
            counterCell('custom', 'custom-value', 'Custom Events') +
            counterCell('identify', 'identify-value', 'Identify Events') +
            counterCell('in-experiments', 'experiments-value', 'Flags in Experiment') +
            counterCell('experiments', 'experiments-goal-value', 'Goals Matched') +
          '</div>' +
          '<div class="table-row">' +
            counterCell('click', 'click-value', 'Click Events') +
            counterCell('feature', 'feature-value', 'Flag Evaluations') +
            counterCell('stream-connection', 'streamConnection-value', 'Active Streams') +
            counterCell('stream-event', 'streamevent-value', 'Stream Events') +
          '</div>' +
        '</div>' +

        '<div id="detailsContainer" class="details-container">' +

          // Conversion Metrics
          section('conversionMetricsSection', 'Conversion Metrics', 'conversionMetricsContent', {
            hidden: true, containerKey: 'conversionMetrics',
            copyTarget: '#conversionMetricsRaw',
            body: emptyState('conversionMetricsEmptyState', 'Waiting for conversion metrics...') +
              rawFormattedViews('conversionMetrics', 'conversionMetricsRaw',
                dataTable('conversionMetricsTable', ['Status','Kind','Goal Key','URL Match','Target Match'], 'conversionMetricsTableBody'))
          }) +

          // Flags in Experiment
          section('flagsInExperimentSection', 'Flags in Experiment', 'flagsInExperimentContent', {
            hidden: true, containerKey: 'flagsInExperiment',
            copyTarget: '#flagsInExperimentRaw',
            body: emptyState('flagsInExperimentEmptyState', 'Waiting for flags in experiment...') +
              rawFormattedViews('flagsInExperiment', 'flagsInExperimentRaw',
                dataTable('flagsInExperimentTable', ['Flag Key','Value','Reason','Variation'], 'flagsInExperimentTableBody'))
          }) +

          // Context
          section('userContextContainer', 'Context', 'contextContent', {
            containerKey: 'context',
            copyTarget: '.user-context-details',
            body: emptyState('contextEmptyState', 'Waiting for LaunchDarkly context data...', '.user-context-details') +
              '<div id="contextRawView" class="view-panel" style="display:none;">' +
                '<textarea class="user-context-details json-display"></textarea>' +
              '</div>' +
              '<div id="contextFormattedView" class="view-panel" style="display:none;">' +
                '<div id="contextTableContainer"></div>' +
              '</div>'
          }) +

          // Feature Flags
          section('featureFlagsContainer', 'Feature Flags', 'flagsContent', {
            containerKey: 'flags', countId: 'featureFlagsCount',
            copyTarget: '.featureflags-details',
            body: emptyState('flagsEmptyState', 'Waiting for feature flag evaluations...', '.featureflags-details') +
              '<div id="flagsRawView" class="view-panel" style="display:none;">' +
                '<textarea class="featureflags-details json-display"></textarea>' +
              '</div>' +
              '<div id="flagsFormattedView" class="view-panel" style="display:none;">' +
                dataTable('featureFlagsTable', ['Flag Key','Value','Reason'], 'featureFlagsTableBody') +
              '</div>'
          }) +

          // Events
          section('networkDetailsContainer', 'Events', 'eventsContent', {
            containerKey: 'events',
            copyTarget: '#networkDetails',
            body: emptyState('eventsEmptyState', 'Waiting for SDK events...', '#networkDetails') +
              '<div id="eventsRawView" class="view-panel" style="display:none;">' +
                '<textarea id="networkDetails" class="network-details"></textarea>' +
              '</div>' +
              '<div id="eventsFormattedView" class="view-panel" style="display:none;">' +
                '<div class="event-filters">' +
                  filterBtn('all', 'All') +
                  filterBtn('received', 'Received') +
                  filterBtn('sent', 'Sent') +
                  '<span class="filter-divider"></span>' +
                  filterBtn('identify', 'identify') +
                  filterBtn('feature', 'feature') +
                  filterBtn('custom', 'custom') +
                  filterBtn('summary', 'summary') +
                '</div>' +
                '<div id="eventsTimeline" class="events-timeline"></div>' +
              '</div>'
          }) +

          // Experiment Goals
          section('experimentGoals', 'Experiment Goals', 'goalsContent', {
            hidden: true, toggle: false,
            copyTarget: '.experiments-details',
            body: emptyState(null, 'Waiting for experiment goal data...', '.experiments-details') +
              '<textarea class="experiments-details json-display"></textarea>'
          }) +

        '</div>' + // detailsContainer
      '</div>'; // panel-body
  };

  function counterCell(id, valueId, label) {
    return '<div id="' + id + '" class="table-cell-counter">' +
      '<span id="' + valueId + '" class="type-counter large-value">0</span>' +
      '<label class="type-counter">' + label + '</label>' +
    '</div>';
  }

  function filterBtn(filter, label) {
    var active = filter === 'all' ? ' active' : '';
    return '<button class="filter-btn' + active + '" data-filter="' + filter + '">' +
      label + ' <span class="filter-count" id="filter-count-' + filter + '">0</span></button>';
  }
})();
