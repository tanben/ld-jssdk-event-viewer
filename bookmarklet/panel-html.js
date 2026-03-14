/**
 * Panel HTML template for the bookmarklet overlay.
 *
 * Uses HTM (Hyperscript Tagged Markup) for composable, readable templates.
 * HTM must be loaded before this file (self.htm is set by the CDN script).
 *
 * Interactive elements use data-action="event->handlerName" attributes
 * for declarative event wiring (Stimulus-inspired pattern).
 *
 * Exports: LDJSSDK.panelHTML — a function returning the full panel markup.
 */
(function () {
  'use strict';

  const LDJSSDK = window.LDJSSDK = window.LDJSSDK || {};

  // ----------------------------------------------------------------
  // HTM setup — bind to a string-returning h() function
  // ----------------------------------------------------------------
  const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'source', 'track', 'wbr',
  ]);

  function flatten(arr) {
    let out = '';
    for (const item of arr) {
      if (item == null || item === false) continue;
      if (Array.isArray(item)) {
        out += flatten(item);
      } else {
        out += String(item);
      }
    }
    return out;
  }

  const html = htm.bind(function h(tag, props, ...children) {
    const attrs = props
      ? Object.entries(props)
          .filter(([, value]) => value !== false && value !== undefined && value !== null)
          .map(([key, value]) => value === true ? key : `${key}="${value}"`)
          .join(' ')
      : '';
    const open = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
    if (VOID_ELEMENTS.has(tag)) return open;
    const inner = flatten(children);
    return `${open}${inner}</${tag}>`;
  });

  // ----------------------------------------------------------------
  // Pure template functions
  // ----------------------------------------------------------------

  function counterCell(id, valueId, label) {
    return html`
      <div id=${id} class="table-cell-counter">
        <span id=${valueId} class="type-counter large-value">0</span>
        <label class="type-counter">${label}</label>
      </div>
    `;
  }

  function filterButton(filter, label, isActive) {
    const activeClass = isActive ? ' active' : '';
    return html`
      <button class=${'filter-btn' + activeClass} data-filter=${filter}>
        ${label} <span class="filter-count" id=${'filter-count-' + filter}>0</span>
      </button>
    `;
  }

  function emptyState(id, message, dataFor) {
    return html`
      <div class="empty-state" id=${id} data-for=${dataFor || false}>
        ${message}
      </div>
    `;
  }

  function rawFormattedViews(prefix, rawId, rawClass, formattedContent) {
    return html`
      <div id=${prefix + 'RawView'} class="view-panel" style="display:none;">
        <textarea id=${rawId || false} class=${rawClass || 'json-display'}></textarea>
      </div>
    ` + html`
      <div id=${prefix + 'FormattedView'} class="view-panel" style="display:none;">
        ${formattedContent}
      </div>
    `;
  }

  function dataTable(id, headers, bodyId) {
    const headerCells = headers
      .map(header => html`<div class="data-table-cell">${header}</div>`)
      .join('');

    return html`
      <div id=${id} class="data-table">
        <div class="data-table-header">${headerCells}</div>
        <div id=${bodyId} class="data-table-body"></div>
      </div>
    `;
  }

  function viewToggle(containerKey) {
    return html`
      <div class="view-toggle">
        <button class="toggle-btn active" data-view="formatted" data-container=${containerKey}>Formatted</button>
        <button class="toggle-btn" data-view="raw" data-container=${containerKey}>Raw</button>
      </div>
    `;
  }

  function copyButton(copyTarget) {
    return html`
      <button class="copy-btn" data-copy-target=${copyTarget} title="Copy to clipboard">Copy</button>
    `;
  }

  function section({ id, title, contentId, hidden, containerKey, copyTarget, countId, body }) {
    const hideAttr = hidden ? ' style="display:none"' : '';
    const hasToggle = containerKey !== undefined;

    return `<div id="${id}" class="collapsible-section"${hideAttr}>` +
      html`
        <div class="section-header" data-action="click->toggleSection" data-target=${contentId}>
          <span class="collapse-icon"></span>
          <h3>
            ${title}
            ${countId ? html`<span id=${countId} class="section-count" data-count="0"></span>` : ''}
          </h3>
          ${hasToggle ? viewToggle(containerKey) : ''}
          ${copyTarget ? copyButton(copyTarget) : ''}
        </div>
      ` +
      html`
        <div id=${contentId} class="section-content">
          ${body}
        </div>
      ` +
    `</div>`;
  }

  // ----------------------------------------------------------------
  // Counter rows
  // ----------------------------------------------------------------
  function countersBlock() {
    return html`
      <div id="typescounterContainer" class="types-counter">
        <h3 id="clientIDValue"></h3>
        <h3 class="counters-title">Counters</h3>
        <div class="table-row">
          ${counterCell('custom', 'custom-value', 'Custom Events')}
          ${counterCell('identify', 'identify-value', 'Identify Events')}
          ${counterCell('in-experiments', 'experiments-value', 'Flags in Experiment')}
          ${counterCell('experiments', 'experiments-goal-value', 'Goals Matched')}
        </div>
        <div class="table-row">
          ${counterCell('click', 'click-value', 'Click Events')}
          ${counterCell('feature', 'feature-value', 'Flag Evaluations')}
          ${counterCell('stream-connection', 'streamConnection-value', 'Active Streams')}
          ${counterCell('stream-event', 'streamevent-value', 'Stream Events')}
        </div>
      </div>
    `;
  }

  // ----------------------------------------------------------------
  // Event filters
  // ----------------------------------------------------------------
  function eventFilters() {
    return html`
      <div class="event-filters">
        ${filterButton('all', 'All', true)}
        ${filterButton('received', 'Received', false)}
        ${filterButton('sent', 'Sent', false)}
        <span class="filter-divider"></span>
        ${filterButton('identify', 'identify', false)}
        ${filterButton('feature', 'feature', false)}
        ${filterButton('custom', 'custom', false)}
        ${filterButton('summary', 'summary', false)}
      </div>
    `;
  }

  // ----------------------------------------------------------------
  // Main panel template
  // ----------------------------------------------------------------
  LDJSSDK.panelHTML = function () {
    // Build sections as strings, then assemble with plain concatenation
    // for the wrapper divs (HTM requires well-formed trees, so we only
    // use it for complete subtrees).

    const toast = html`<div id="toast-container"></div>`;

    const header = html`
      <div class="panel-header">
        <div class="panel-title-row">
          <h1>LD SDK Event Viewer</h1>
          <button id="minimizeBtn" class="panel-control-btn" data-action="click->minimize" title="Minimize">${'\u2015'}</button>
          <button id="closeBtn" class="panel-control-btn close" data-action="click->close" title="Close">${'\u00D7'}</button>
        </div>
        <div class="action-buttons">
          <button id="clearBtn" class="action-btn clear-btn" data-action="click->clearAll">Clear All</button>
          <button id="exportBtn" class="action-btn export-btn" data-action="click->exportData">Export Data</button>
        </div>
      </div>
    `;

    const sections =
      section({
        id: 'conversionMetricsSection',
        title: 'Conversion Metrics',
        contentId: 'conversionMetricsContent',
        hidden: true,
        containerKey: 'conversionMetrics',
        copyTarget: '#conversionMetricsRaw',
        body: emptyState('conversionMetricsEmptyState', 'Waiting for conversion metrics...') +
          rawFormattedViews('conversionMetrics', 'conversionMetricsRaw', 'json-display',
            dataTable('conversionMetricsTable',
              ['Status', 'Kind', 'Goal Key', 'URL Match', 'Target Match'],
              'conversionMetricsTableBody')),
      }) +

      section({
        id: 'flagsInExperimentSection',
        title: 'Flags in Experiment',
        contentId: 'flagsInExperimentContent',
        hidden: true,
        containerKey: 'flagsInExperiment',
        copyTarget: '#flagsInExperimentRaw',
        body: emptyState('flagsInExperimentEmptyState', 'Waiting for flags in experiment...') +
          rawFormattedViews('flagsInExperiment', 'flagsInExperimentRaw', 'json-display',
            dataTable('flagsInExperimentTable',
              ['Flag Key', 'Value', 'Reason', 'Variation'],
              'flagsInExperimentTableBody')),
      }) +

      section({
        id: 'userContextContainer',
        title: 'Context',
        contentId: 'contextContent',
        containerKey: 'context',
        copyTarget: '.user-context-details',
        body: emptyState('contextEmptyState', 'Waiting for LaunchDarkly context data...', '.user-context-details') +
          rawFormattedViews('context', null, 'user-context-details json-display',
            html`<div id="contextTableContainer"></div>`),
      }) +

      section({
        id: 'featureFlagsContainer',
        title: 'Feature Flags',
        contentId: 'flagsContent',
        containerKey: 'flags',
        countId: 'featureFlagsCount',
        copyTarget: '.featureflags-details',
        body: emptyState('flagsEmptyState', 'Waiting for feature flag evaluations...', '.featureflags-details') +
          rawFormattedViews('flags', null, 'featureflags-details json-display',
            dataTable('featureFlagsTable', ['Flag Key', 'Value', 'Reason'], 'featureFlagsTableBody')),
      }) +

      section({
        id: 'networkDetailsContainer',
        title: 'Events',
        contentId: 'eventsContent',
        containerKey: 'events',
        copyTarget: '#networkDetails',
        body: emptyState('eventsEmptyState', 'Waiting for SDK events...', '#networkDetails') +
          rawFormattedViews('events', 'networkDetails', 'network-details',
            eventFilters() + html`<div id="eventsTimeline" class="events-timeline"></div>`),
      }) +

      section({
        id: 'experimentGoals',
        title: 'Experiment Goals',
        contentId: 'goalsContent',
        hidden: true,
        copyTarget: '.experiments-details',
        body: emptyState(undefined, 'Waiting for experiment goal data...', '.experiments-details') +
          html`<textarea class="experiments-details json-display"></textarea>`,
      });

    // Assemble with plain strings for wrapper divs (not HTM)
    return toast + header +
      '<div class="panel-body">' +
        countersBlock() +
        '<div id="detailsContainer" class="details-container">' +
          sections +
        '</div>' +
      '</div>';
  };
})();
