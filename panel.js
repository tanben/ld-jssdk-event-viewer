// Goal tracking helpers (inlined from goalTracker-mod.js)
function escapeStringRegexp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function doesUrlMatch(matcher, href, search, hash) {
  var keepHash = (matcher.kind === 'substring' || matcher.kind === 'regex') && hash.includes('/');
  var canonicalUrl = (keepHash ? href : href.replace(hash, '')).replace(search, '');
  var regex, testUrl;
  switch (matcher.kind) {
    case 'exact':     testUrl = href;         regex = new RegExp('^' + escapeStringRegexp(matcher.url) + '/?$'); break;
    case 'canonical': testUrl = canonicalUrl;  regex = new RegExp('^' + escapeStringRegexp(matcher.url) + '/?$'); break;
    case 'substring': testUrl = canonicalUrl;  regex = new RegExp('.*' + escapeStringRegexp(matcher.substring) + '.*$'); break;
    case 'regex':     testUrl = canonicalUrl;  regex = new RegExp(matcher.pattern); break;
    default: return false;
  }
  return regex.test(testUrl);
}

// not ideal to have globals but it's the only way to pass data between the content script and the panel
// todo: find a better way to pass data between the content script and the panel
var extensionGlobals = {
  logEditor: {
    insert: (msg) => {
      let ele = document.querySelector("textArea#networkDetails");
      ele.value += `\n`;
      ele.value += msg;
      updateEmptyState(ele);
    },
    setValue: (msg) => {
      let ele = document.querySelector("textArea#networkDetails");
      ele.value = msg;
      updateEmptyState(ele);
    },
  },
  // Track stream connections: hash -> { url, status: 'active'|'closed', startTime, eventCount }
  streamConnections: new Map(),
  eventsData: [] // Store events for formatted view
};

// Extension: attach Chrome DevTools listeners; Bookmarklet: just set up UI
if (typeof chrome !== 'undefined' && chrome.devtools) {
  main();
} else {
  setupButtons();
}

//------------

function main() {
  chrome.devtools.network.onRequestFinished.addListener(onEventSourceEvents);
  chrome.devtools.network.onRequestFinished.addListener(evalxHandler);

  chrome.devtools.network.onRequestFinished.addListener(goalsHandler);
  chrome.devtools.network.onRequestFinished.addListener(logNetwork);
  chrome.devtools.network.onRequestFinished.addListener(eventsHandler);
  chrome.devtools.network.onNavigated.addListener(onNavHandler);
  
  checkDoNotTrack();
  setupButtons();
}

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

function setupButtons() {
  // Clear button
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearAllData();
      showToast('All data cleared', 'success');
    });
  }
  
  // Export button
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportData();
      showToast('Data exported successfully', 'success');
    });
  }
  
  // Setup collapsible sections
  setupCollapsibleSections();
  
  // Setup copy buttons
  setupCopyButtons();
  
  // Initialize empty states
  initializeEmptyStates();
  
  // Setup view toggles
  setupViewToggles();
}

// View Toggle (Raw/Formatted)
function setupViewToggles() {
  const toggleBtns = document.querySelectorAll('.toggle-btn');
  
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent section collapse
      
      const view = btn.getAttribute('data-view');
      const containerType = btn.getAttribute('data-container');
      const container = btn.closest('.collapsible-section');
      
      // Update active button state
      container.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Determine which views to toggle based on container type
      let rawView, formattedView;
      if (containerType === 'context') {
        rawView = document.getElementById('contextRawView');
        formattedView = document.getElementById('contextFormattedView');
      } else if (containerType === 'events') {
        rawView = document.getElementById('eventsRawView');
        formattedView = document.getElementById('eventsFormattedView');
      } else if (containerType === 'flagsInExperiment') {
        rawView = document.getElementById('flagsInExperimentRawView');
        formattedView = document.getElementById('flagsInExperimentFormattedView');
      } else if (containerType === 'conversionMetrics') {
        rawView = document.getElementById('conversionMetricsRawView');
        formattedView = document.getElementById('conversionMetricsFormattedView');
      } else {
        rawView = document.getElementById('flagsRawView');
        formattedView = document.getElementById('flagsFormattedView');
      }
      
      const emptyState = container.querySelector('.empty-state');
      
      // Check if we have data
      const textarea = container.querySelector('textarea');
      const hasData = textarea && textarea.value && textarea.value.trim();
      
      if (hasData) {
        if (view === 'raw') {
          rawView.style.display = 'block';
          formattedView.style.display = 'none';
        } else {
          rawView.style.display = 'none';
          formattedView.style.display = 'block';
        }
        if (emptyState) emptyState.classList.add('hidden');
      }
    });
  });
  
  // Setup event filters
  setupEventFilters();
}

// Event Filters
function setupEventFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter');
      
      // Update active state
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Filter events
      filterEvents(filter);
    });
  });
}

function filterEvents(filter) {
  const eventCards = document.querySelectorAll('.event-card');
  
  eventCards.forEach(card => {
    const direction = card.getAttribute('data-direction');
    const eventType = card.getAttribute('data-event-type');
    
    let show = false;
    
    if (filter === 'all') {
      show = true;
    } else if (filter === 'received' || filter === 'sent') {
      show = direction === filter;
    } else {
      show = eventType === filter;
    }
    
    if (show) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

// Update Feature Flags Table
function updateFeatureFlagsTable(flagsData) {
  const tableBody = document.getElementById('featureFlagsTableBody');
  if (!tableBody) return;
  
  // Clear existing rows
  tableBody.innerHTML = '';
  
  // Update the counter
  const flagCount = flagsData ? Object.keys(flagsData).length : 0;
  const countBadge = document.getElementById('featureFlagsCount');
  if (countBadge) {
    countBadge.textContent = flagCount;
    countBadge.setAttribute('data-count', flagCount);
  }
  
  if (!flagsData || flagCount === 0) {
    tableBody.innerHTML = '<div class="data-table-empty">No feature flags evaluated yet</div>';
    return;
  }
  
  // Create rows for each flag
  for (const flagKey in flagsData) {
    const flag = flagsData[flagKey];
    const row = document.createElement('div');
    row.className = 'data-table-row';
    
    // Flag Key cell
    const keyCell = document.createElement('div');
    keyCell.className = 'data-table-cell';
    keyCell.textContent = flagKey;
    
    // Value cell
    const valueCell = document.createElement('div');
    valueCell.className = 'data-table-cell';
    valueCell.innerHTML = formatFlagValue(flag.value);
    
    // Reason cell
    const reasonCell = document.createElement('div');
    reasonCell.className = 'data-table-cell';
    reasonCell.innerHTML = formatFlagReason(flag.reason);
    
    row.appendChild(keyCell);
    row.appendChild(valueCell);
    row.appendChild(reasonCell);
    tableBody.appendChild(row);
  }
}

function formatFlagValue(value) {
  if (value === true) {
    return '<span class="value-true">true</span>';
  } else if (value === false) {
    return '<span class="value-false">false</span>';
  } else if (typeof value === 'string') {
    return `<span class="value-string">"${escapeHtml(value)}"</span>`;
  } else if (typeof value === 'number') {
    return `<span class="value-number">${value}</span>`;
  } else if (typeof value === 'object') {
    return `<span class="value-string">${escapeHtml(JSON.stringify(value))}</span>`;
  }
  return String(value);
}

function formatFlagReason(reason) {
  if (!reason) return '<span style="color: #999;">—</span>';
  
  let html = '';
  
  if (reason.kind) {
    html += `<span class="reason-badge reason-kind">${escapeHtml(reason.kind)}</span>`;
  }
  
  if (reason.inExperiment) {
    html += `<span class="reason-badge reason-experiment">In Experiment</span>`;
  }
  
  return html || '<span style="color: #999;">—</span>';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Update Context Table
function updateContextTable(contextData) {
  const container = document.getElementById('contextTableContainer');
  if (!container) return;
  
  // Clear existing content
  container.innerHTML = '';
  
  if (!contextData || Object.keys(contextData).length === 0) {
    container.innerHTML = '<div class="data-table-empty">No context data yet</div>';
    return;
  }
  
  // Separate root-level primitives from nested objects
  const rootAttributes = {};
  const contextGroups = {};
  
  for (const key in contextData) {
    const value = contextData[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      contextGroups[key] = value;
    } else {
      rootAttributes[key] = value;
    }
  }
  
  // Render root attributes if any
  if (Object.keys(rootAttributes).length > 0) {
    const rootDiv = document.createElement('div');
    rootDiv.className = 'context-root';
    
    for (const key in rootAttributes) {
      const item = document.createElement('div');
      item.className = 'context-root-item';
      item.innerHTML = `
        <span class="context-root-key">${escapeHtml(key)}:</span>
        <span class="context-root-value">${escapeHtml(String(rootAttributes[key]))}</span>
      `;
      rootDiv.appendChild(item);
    }
    
    container.appendChild(rootDiv);
  }
  
  // Render each context group
  for (const groupName in contextGroups) {
    const group = contextGroups[groupName];
    const groupDiv = document.createElement('div');
    groupDiv.className = 'context-group';
    
    // Group header
    const header = document.createElement('div');
    header.className = 'context-group-header';
    header.innerHTML = `
      <span>${escapeHtml(groupName)}</span>
      ${group.key ? `<span class="context-kind-badge">${escapeHtml(group.key)}</span>` : ''}
    `;
    groupDiv.appendChild(header);
    
    // Group body with attributes
    const body = document.createElement('div');
    body.className = 'context-group-body';
    
    for (const attrKey in group) {
      const attrValue = group[attrKey];
      const attrDiv = document.createElement('div');
      attrDiv.className = 'context-attribute';
      
      const keyDiv = document.createElement('div');
      keyDiv.className = 'context-attr-key';
      keyDiv.textContent = attrKey;
      
      const valueDiv = document.createElement('div');
      valueDiv.className = 'context-attr-value';
      valueDiv.innerHTML = formatContextValue(attrKey, attrValue);
      
      attrDiv.appendChild(keyDiv);
      attrDiv.appendChild(valueDiv);
      body.appendChild(attrDiv);
    }
    
    groupDiv.appendChild(body);
    container.appendChild(groupDiv);
  }
}

function formatContextValue(key, value) {
  if (value === true) {
    return '<span class="value-true">true</span>';
  } else if (value === false) {
    return '<span class="value-false">false</span>';
  } else if (key === 'key') {
    return `<span class="value-key">${escapeHtml(String(value))}</span>`;
  } else if (typeof value === 'string') {
    return `<span class="value-string">${escapeHtml(value)}</span>`;
  } else if (typeof value === 'object') {
    return `<span class="value-string">${escapeHtml(JSON.stringify(value))}</span>`;
  }
  return escapeHtml(String(value));
}

// ==================== Events Timeline Functions ====================

function addEventToTimeline(eventData) {
  const timeline = document.getElementById('eventsTimeline');
  if (!timeline) return;
  
  // Store event data
  extensionGlobals.eventsData.push(eventData);
  
  // Create event card
  const card = createEventCard(eventData);
  timeline.insertBefore(card, timeline.firstChild); // Add to top
  
  // Apply current filter to the new card
  applyFilterToCard(card);
  
  // Update filter counters
  updateFilterCounters();
  
  // Show the events view
  showEventsView();
}

function applyFilterToCard(card) {
  // Get the current active filter
  const activeFilterBtn = document.querySelector('.filter-btn.active');
  if (!activeFilterBtn) return;
  
  const filter = activeFilterBtn.getAttribute('data-filter');
  if (filter === 'all') return; // Show all
  
  const direction = card.getAttribute('data-direction');
  const eventType = card.getAttribute('data-event-type');
  
  let show = false;
  
  if (filter === 'received' || filter === 'sent') {
    show = direction === filter;
  } else {
    show = eventType === filter;
  }
  
  if (!show) {
    card.classList.add('hidden');
  }
}

function getCurrentFilter() {
  const activeFilterBtn = document.querySelector('.filter-btn.active');
  return activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';
}

function updateFilterCounters() {
  const events = extensionGlobals.eventsData || [];
  
  // Count by direction
  const receivedCount = events.filter(e => e.direction === 'received').length;
  const sentCount = events.filter(e => e.direction === 'sent').length;
  
  // Count by type
  // todo: need to find a more efficient way to count these types
  const identifyCount = events.filter(e => e.type === 'identify').length;
  const featureCount = events.filter(e => e.type === 'feature').length;
  const customCount = events.filter(e => e.type === 'custom').length;
  const summaryCount = events.filter(e => e.type === 'summary').length;
  
  // Update counter elements
  const updateCount = (id, count) => {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  };
  
  updateCount('filter-count-all', events.length);
  updateCount('filter-count-received', receivedCount);
  updateCount('filter-count-sent', sentCount);
  updateCount('filter-count-identify', identifyCount);
  updateCount('filter-count-feature', featureCount);
  updateCount('filter-count-custom', customCount);
  updateCount('filter-count-summary', summaryCount);
}

function showEventsView() {
  showSectionView('networkDetailsContainer', 'eventsEmptyState', 'eventsRawView', 'eventsFormattedView');
}

/**
 * Generic helper to show the active view for a section
 */
function showSectionView(containerSelector, emptyStateId, rawViewId, formattedViewId) {
  const emptyState = document.getElementById(emptyStateId);
  if (emptyState) {
    emptyState.classList.add('hidden');
  }
  
  const container = document.getElementById(containerSelector) || document.querySelector(containerSelector);
  if (!container) return;
  
  const activeToggle = container.querySelector('.toggle-btn.active');
  if (activeToggle) {
    const activeView = activeToggle.getAttribute('data-view');
    const rawView = document.getElementById(rawViewId);
    const formattedView = document.getElementById(formattedViewId);
    
    if (rawView && formattedView) {
      if (activeView === 'raw') {
        rawView.style.display = 'block';
        formattedView.style.display = 'none';
      } else {
        rawView.style.display = 'none';
        formattedView.style.display = 'block';
      }
    }
  }
}

/**
 * Check if URL is a LaunchDarkly SDK endpoint
 */
function isLaunchDarklyUrl(url) {
  if (!url) return false;
  return url.includes('launchdarkly.com') || 
         url.includes('launchdarkly.us');
}

function createEventCard(eventData) {
  const card = document.createElement('div');
  card.className = 'event-card collapsed'; // Collapsed by default
  card.setAttribute('data-direction', eventData.direction);
  card.setAttribute('data-event-type', eventData.type || 'received');
  
  // Header
  const header = document.createElement('div');
  header.className = 'event-card-header';
  header.onclick = () => card.classList.toggle('collapsed');
  
  // Direction icon
  const directionIcon = document.createElement('span');
  directionIcon.className = 'event-direction';
  directionIcon.textContent = eventData.direction === 'received' ? '⬇️' : '⬆️';
  
  // Direction badge
  const directionBadge = document.createElement('span');
  directionBadge.className = `event-type-badge ${eventData.direction}`;
  directionBadge.textContent = eventData.direction;
  
  // Event type badge (for sent events)
  let typeBadge = null;
  if (eventData.type && eventData.type !== 'received') {
    typeBadge = document.createElement('span');
    typeBadge.className = `event-type-badge ${eventData.type}`;
    typeBadge.textContent = eventData.type;
  }
  
  // Event key/description
  const keySpan = document.createElement('span');
  keySpan.className = 'event-key';
  keySpan.textContent = eventData.key || eventData.description || '';
  
  // Timestamp
  const timestamp = document.createElement('span');
  timestamp.className = 'event-timestamp';
  timestamp.textContent = eventData.timestamp;
  
  // For received events, add response time and payload size to header
  let headerStats = null;
  if (eventData.direction === 'received') {
    headerStats = document.createElement('span');
    headerStats.className = 'event-header-stats';
    
    // Calculate total response time
    if (eventData.timings) {
      const timingKeys = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
      let totalTime = 0;
      timingKeys.forEach(key => {
        if (eventData.timings[key] && eventData.timings[key] > 0) {
          totalTime += eventData.timings[key];
        }
      });
      
      // Format and color based on speed
      const timeStr = totalTime >= 1000 ? `${(totalTime / 1000).toFixed(2)}s` : `${Math.round(totalTime)}ms`;
      const timeColor = totalTime > 2000 ? '#f44336' : totalTime > 500 ? '#ff9800' : '#4CAF50';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'event-stat';
      timeSpan.innerHTML = `<span class="stat-icon">⏱</span><span class="stat-value" style="color: ${timeColor}">${timeStr}</span>`;
      headerStats.appendChild(timeSpan);
    }
    
    // Add payload size
    if (eventData.bodySize) {
      const sizeStr = formatByteSize(eventData.bodySize);
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'event-stat';
      sizeSpan.innerHTML = `<span class="stat-icon">📦</span><span class="stat-value">${sizeStr}</span>`;
      headerStats.appendChild(sizeSpan);
    }
  }
  
  // Expand icon
  const expandIcon = document.createElement('span');
  expandIcon.className = 'event-expand-icon';
  
  header.appendChild(directionIcon);
  header.appendChild(directionBadge);
  if (typeBadge) header.appendChild(typeBadge);
  header.appendChild(keySpan);
  if (headerStats) header.appendChild(headerStats);
  header.appendChild(timestamp);
  header.appendChild(expandIcon);
  
  // Body
  const body = document.createElement('div');
  body.className = 'event-card-body';
  body.innerHTML = createEventCardBody(eventData);
  
  // Attach click handlers for timing sections (if any)
  const timingHeaders = body.querySelectorAll('.timing-header');
  timingHeaders.forEach(timingHeader => {
    timingHeader.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent card collapse
      const timingSection = timingHeader.closest('.timing-section');
      if (timingSection) {
        timingSection.classList.toggle('collapsed');
      }
    });
  });
  
  card.appendChild(header);
  card.appendChild(body);
  
  return card;
}

function createEventCardBody(eventData) {
  let html = '';
  
  // URL if present
  if (eventData.url) {
    html += `<div class="event-url">${escapeHtml(eventData.url)}</div>`;
  }
  
  // Handle different event types
  if (eventData.direction === 'received') {
    // Received events - show flag count and body size
    if (eventData.data && typeof eventData.data === 'object') {
      const flagCount = Object.keys(eventData.data).length;
      html += `<div class="event-detail-row">
        <span class="event-detail-key">Flags</span>
        <span class="event-detail-value">${flagCount} flag(s) evaluated</span>
      </div>`;
    }
    
    // Show payload/body size
    if (eventData.bodySize) {
      html += `<div class="event-detail-row">
        <span class="event-detail-key">Payload Size</span>
        <span class="event-detail-value">${formatByteSize(eventData.bodySize)}</span>
      </div>`;
    }
    
    // Show HAR timing information
    if (eventData.timings) {
      html += createTimingDisplay(eventData.timings);
    }
  } else if (eventData.type === 'feature') {
    // Feature event
    html += createDetailRow('Flag Key', eventData.key);
    html += createDetailRow('Value', formatEventValue(eventData.data?.value));
    html += createDetailRow('Variation', eventData.data?.variation);
    if (eventData.data?.reason) {
      html += createDetailRow('Reason', formatFlagReason(eventData.data.reason));
    }
  } else if (eventData.type === 'custom') {
    // Custom event
    html += createDetailRow('Metric Key', eventData.key);
    if (eventData.data?.metricValue !== undefined) {
      html += createDetailRow('Metric Value', eventData.data.metricValue);
    }
    if (eventData.data?.url) {
      html += createDetailRow('URL', eventData.data.url);
    }
  } else if (eventData.type === 'identify') {
    // Identify event - show context details
    if (eventData.data?.context) {
      const context = eventData.data.context;
      const contextKind = context.kind || 'user';
      html += createDetailRow('Context Kind', contextKind);
      
      // Check if context has nested objects (multi-kind) or is a flat user object
      const nestedObjects = {};
      const flatProperties = {};
      
      for (const contextKey in context) {
        if (contextKey === 'kind') continue; // Skip the kind property
        
        const contextValue = context[contextKey];
        if (typeof contextValue === 'object' && contextValue !== null && !Array.isArray(contextValue)) {
          nestedObjects[contextKey] = contextValue;
        } else {
          flatProperties[contextKey] = contextValue;
        }
      }
      
      // If there are nested objects (multi-kind context), show them grouped
      if (Object.keys(nestedObjects).length > 0) {
        for (const contextKey in nestedObjects) {
          const contextObj = nestedObjects[contextKey];
          html += `<div class="identify-context-group">
            <div class="identify-context-header">${escapeHtml(contextKey)}</div>
            <div class="identify-context-body">`;
          
          // Show all properties of this context object
          for (const propKey in contextObj) {
            const propValue = contextObj[propKey];
            html += `<div class="event-detail-row">
              <span class="event-detail-key">${escapeHtml(propKey)}</span>
              <span class="event-detail-value ${getValueClass(propValue)}">${formatEventValue(propValue)}</span>
            </div>`;
          }
          
          html += '</div></div>';
        }
      }
      
      // If there are flat properties (single user context), show them directly
      if (Object.keys(flatProperties).length > 0) {
        html += `<div class="identify-context-group">
          <div class="identify-context-header">${escapeHtml(contextKind)}</div>
          <div class="identify-context-body">`;
        
        for (const propKey in flatProperties) {
          const propValue = flatProperties[propKey];
          html += `<div class="event-detail-row">
            <span class="event-detail-key">${escapeHtml(propKey)}</span>
            <span class="event-detail-value ${getValueClass(propValue)}">${formatEventValue(propValue)}</span>
          </div>`;
        }
        
        html += '</div></div>';
      }
    }
  } else if (eventData.type === 'summary') {
    // Summary event
    if (eventData.data?.features) {
      html += '<div class="summary-features">';
      for (const flagKey in eventData.data.features) {
        const feature = eventData.data.features[flagKey];
        html += `<div class="summary-feature">
          <div class="summary-feature-key">${escapeHtml(flagKey)}</div>`;
        if (feature.counters) {
          feature.counters.forEach(counter => {
            html += `<div class="event-detail-row">
              <span class="event-detail-key">Value</span>
              <span class="event-detail-value">${formatEventValue(counter.value)} (${counter.count}x)</span>
            </div>`;
          });
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }
  
  return html || '<div style="color: #999; font-style: italic;">No additional details</div>';
}

/**
 * Create timing display for HAR timing data
 * @param {Object} timings - HAR timing object
 * @returns {string} HTML string for timing display
 */
function createTimingDisplay(timings) {
  if (!timings) return '';
  
  // Calculate total time (sum of all positive timing values)
  const timingKeys = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
  let totalTime = 0;
  
  timingKeys.forEach(key => {
    if (timings[key] && timings[key] > 0) {
      totalTime += timings[key];
    }
  });
  
  // Format time value
  const formatTime = (ms) => {
    if (ms === undefined || ms === null || ms < 0) return '—';
    if (ms < 1) return '<1 ms';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${Math.round(ms)} ms`;
  };
  
  // Get color based on time
  const getTimeColor = (ms, type) => {
    if (ms === undefined || ms === null || ms < 0) return '#999';
    if (type === 'total') {
      if (ms > 2000) return '#f44336'; // Red for slow
      if (ms > 500) return '#ff9800';  // Orange for medium
      return '#4CAF50'; // Green for fast
    }
    return '#666';
  };
  
  // Collapsed by default - use data attribute for JS to attach click handler
  let html = `<div class="timing-section collapsed" data-timing-section="true">
    <div class="timing-header">
      <span class="timing-expand-icon"></span>
      <span class="timing-title">Response Time</span>
      <span class="timing-total" style="color: ${getTimeColor(totalTime, 'total')}">${formatTime(totalTime)}</span>
    </div>
    <div class="timing-breakdown">`;
  
  // Add individual timing rows with detailed tooltips
  const timingLabels = {
    blocked: { 
      label: 'Blocked', 
      desc: 'Time spent waiting in the browser queue before the request could be sent. This includes time waiting for a network connection to become available.'
    },
    dns: { 
      label: 'DNS', 
      desc: 'Time spent performing the DNS lookup to resolve the domain name to an IP address.'
    },
    connect: { 
      label: 'Connect', 
      desc: 'Time spent establishing the TCP connection to the server.'
    },
    ssl: { 
      label: 'SSL', 
      desc: 'Time spent completing the SSL/TLS handshake for secure HTTPS connections.'
    },
    send: { 
      label: 'Send', 
      desc: 'Time spent sending the HTTP request to the server.'
    },
    wait: { 
      label: 'Wait', 
      desc: 'Time spent waiting for the server to respond (Time To First Byte - TTFB). This is often the largest portion and indicates server processing time.'
    },
    receive: { 
      label: 'Receive', 
      desc: 'Time spent receiving/downloading the response body from the server.'
    }
  };
  
  timingKeys.forEach(key => {
    const value = timings[key];
    const info = timingLabels[key];
    const displayValue = formatTime(value);
    const barWidth = totalTime > 0 && value > 0 ? Math.max(2, (value / totalTime) * 100) : 0;
    
    html += `<div class="timing-row">
      <span class="timing-label">
        ${info.label}
        <span class="timing-tooltip-trigger">ⓘ
          <span class="timing-tooltip">${info.desc}</span>
        </span>
      </span>
      <div class="timing-bar-container">
        <div class="timing-bar timing-bar-${key}" style="width: ${barWidth}%"></div>
      </div>
      <span class="timing-value">${displayValue}</span>
    </div>`;
  });
  
  html += '</div></div>';
  
  return html;
}

function createDetailRow(key, value) {
  if (value === undefined || value === null) return '';
  return `<div class="event-detail-row">
    <span class="event-detail-key">${escapeHtml(key)}</span>
    <span class="event-detail-value">${typeof value === 'string' && value.startsWith('<') ? value : escapeHtml(String(value))}</span>
  </div>`;
}

/**
 * Format byte size to human-readable format
 */
function formatByteSize(bytes) {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  
  return `${size} ${units[i]}`;
}

function formatEventValue(value) {
  if (value === true) return '<span class="value-true">true</span>';
  if (value === false) return '<span class="value-false">false</span>';
  if (typeof value === 'string') return `"${escapeHtml(value)}"`;
  if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
  return String(value);
}

function getValueClass(value) {
  if (value === true) return 'value-true';
  if (value === false) return 'value-false';
  return '';
}

// Add received event to timeline
function addReceivedEvent(url, data, timestamp, timings, bodySize) {
  addEventToTimeline({
    direction: 'received',
    type: 'received',
    timestamp: timestamp,
    url: url,
    description: `${Object.keys(data).length} flags`,
    data: data,
    timings: timings,
    bodySize: bodySize
  });
}

// Add sent events to timeline
function addSentEvents(url, events, timestamp) {
  if (!Array.isArray(events)) return;
  
  events.forEach(event => {
    const eventData = {
      direction: 'sent',
      type: event.kind || 'unknown',
      timestamp: timestamp,
      key: event.key || '',
      data: event
    };
    
    // Set description based on event type
    // todo: fix this if-else chain
    if (event.kind === 'identify') {
      eventData.description = 'User identified';
    } else if (event.kind === 'feature') {
      eventData.description = event.key;
    } else if (event.kind === 'custom') {
      eventData.description = event.key;
      if (event.metricValue !== undefined) {
        eventData.description += ` (${event.metricValue})`;
      }
    } else if (event.kind === 'summary') {
      const featureCount = event.features ? Object.keys(event.features).length : 0;
      eventData.description = `${featureCount} flag(s) summarized`;
    }
    
    addEventToTimeline(eventData);
  });
}

// Toast Notification System
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  container.appendChild(toast);
  
  // Remove toast after animation
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Collapsible Sections
function setupCollapsibleSections() {
  const headers = document.querySelectorAll('.section-header');
  
  headers.forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't collapse when clicking copy button
      if (e.target.classList.contains('copy-btn')) return;
      
      const targetId = header.getAttribute('data-target');
      const content = document.getElementById(targetId);
      
      if (content) {
        header.classList.toggle('collapsed');
        content.classList.toggle('collapsed');
      }
    });
  });
}

// Copy to Clipboard
function setupCopyButtons() {
  const copyBtns = document.querySelectorAll('.copy-btn');
  
  copyBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent section collapse
      
      const targetSelector = btn.getAttribute('data-copy-target');
      const targetEl = document.querySelector(targetSelector);
      
      if (targetEl && targetEl.value && targetEl.value.trim()) {
        copyToClipboard(targetEl.value).then(() => {
          btn.classList.add('copied');
          btn.textContent = 'Copied!';
          
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.textContent = 'Copy';
          }, 2000);
        }).catch(err => {
          showToast('Failed to copy to clipboard', 'error');
        });
      } else {
        showToast('Nothing to copy', 'warning');
      }
    });
  });
}

// Clipboard helper with fallback for DevTools panel
function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    // Try the modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(resolve)
        .catch(() => {
          // Fallback to execCommand
          if (fallbackCopyToClipboard(text)) {
            resolve();
          } else {
            reject(new Error('Copy failed'));
          }
        });
    } else {
      // Use fallback method
      if (fallbackCopyToClipboard(text)) {
        resolve();
      } else {
        reject(new Error('Copy failed'));
      }
    }
  });
}

function fallbackCopyToClipboard(text) {
  // Create a temporary textarea
  const textArea = document.createElement('textarea');
  textArea.value = text;
  
  // Make it invisible but still part of the document
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '2em';
  textArea.style.height = '2em';
  textArea.style.padding = '0';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (err) {
    success = false;
  }
  
  document.body.removeChild(textArea);
  return success;
}

// Empty States Management
function initializeEmptyStates() {
  const textareas = document.querySelectorAll('textarea');
  
  textareas.forEach(textarea => {
    updateEmptyState(textarea);
    
    // Create a MutationObserver to watch for value changes
    const observer = new MutationObserver(() => updateEmptyState(textarea));
    observer.observe(textarea, { attributes: true, childList: true, characterData: true });
    
    // Also listen for input events
    textarea.addEventListener('input', () => updateEmptyState(textarea));
  });
}

function updateEmptyState(textarea) {
  const selector = getTextareaSelector(textarea);
  const emptyState = document.querySelector(`.empty-state[data-for="${selector}"]`);
  
  if (emptyState) {
    if (textarea.value && textarea.value.trim()) {
      emptyState.classList.add('hidden');
      textarea.style.display = 'block';
    } else {
      emptyState.classList.remove('hidden');
      textarea.style.display = 'none';
    }
  }
}

function getTextareaSelector(textarea) {
  if (textarea.id) return `#${textarea.id}`;
  if (textarea.className) return `.${textarea.className.split(' ')[0]}`;
  return '';
}

// Counter Animation
function animateCounter(element) {
  element.classList.add('updated');
  setTimeout(() => {
    element.classList.remove('updated');
  }, 300);
}

function clearAllData() {
  //todo: need to find a more efficient way to clear these sections maybe just rerender the container?

  // Clear all metric rows
  document.querySelectorAll(".metric").forEach((ele) => ele.remove());

  // Reset counters
  let typeCounters = window.document.querySelectorAll("span.type-counter");
  typeCounters.forEach((counter) => (counter.textContent = 0));

  // Clear all text areas
  extensionGlobals.logEditor.setValue("");
  document.querySelectorAll("textArea").forEach((e) => {
    e.value = "";
    updateEmptyState(e);
  });
  
  // Clear stream connection tracking (no actual connections to close anymore)
  extensionGlobals.streamConnections.clear();
  
  // Hide optional sections
  document.getElementById('conversionMetricsSection').style.display = 'none';
  document.getElementById('flagsInExperimentSection').style.display = 'none';
  document.getElementById('experimentGoals').style.display = 'none';
  
  // Clear feature flags table and reset views
  const flagsTableBody = document.getElementById('featureFlagsTableBody');
  if (flagsTableBody) {
    flagsTableBody.innerHTML = '';
  }
  
  // Reset feature flags counter
  const featureFlagsCount = document.getElementById('featureFlagsCount');
  if (featureFlagsCount) {
    featureFlagsCount.textContent = '0';
    featureFlagsCount.setAttribute('data-count', '0');
  }
  
  // Show empty state and hide views for flags
  const flagsEmptyState = document.getElementById('flagsEmptyState');
  if (flagsEmptyState) {
    flagsEmptyState.classList.remove('hidden');
  }
  document.getElementById('flagsRawView').style.display = 'none';
  document.getElementById('flagsFormattedView').style.display = 'none';
  
  // Clear context table and reset views
  const contextTableContainer = document.getElementById('contextTableContainer');
  if (contextTableContainer) {
    contextTableContainer.innerHTML = '';
  }
  
  // Show empty state and hide views for context
  const contextEmptyState = document.getElementById('contextEmptyState');
  if (contextEmptyState) {
    contextEmptyState.classList.remove('hidden');
  }
  const contextRawView = document.getElementById('contextRawView');
  const contextFormattedView = document.getElementById('contextFormattedView');
  if (contextRawView) contextRawView.style.display = 'none';
  if (contextFormattedView) contextFormattedView.style.display = 'none';
  
  // Clear events timeline and reset views
  const eventsTimeline = document.getElementById('eventsTimeline');
  if (eventsTimeline) {
    eventsTimeline.innerHTML = '';
  }
  extensionGlobals.eventsData = [];
  
  // Show empty state and hide views for events
  const eventsEmptyState = document.getElementById('eventsEmptyState');
  if (eventsEmptyState) {
    eventsEmptyState.classList.remove('hidden');
  }
  const eventsRawView = document.getElementById('eventsRawView');
  const eventsFormattedView = document.getElementById('eventsFormattedView');
  if (eventsRawView) eventsRawView.style.display = 'none';
  if (eventsFormattedView) eventsFormattedView.style.display = 'none';
  
  // Clear flags in experiment section
  const flagsInExperimentTableBody = document.getElementById('flagsInExperimentTableBody');
  if (flagsInExperimentTableBody) {
    flagsInExperimentTableBody.innerHTML = '';
  }
  const flagsInExperimentRaw = document.getElementById('flagsInExperimentRaw');
  if (flagsInExperimentRaw) {
    flagsInExperimentRaw.value = '';
  }
  const flagsInExperimentEmptyState = document.getElementById('flagsInExperimentEmptyState');
  if (flagsInExperimentEmptyState) {
    flagsInExperimentEmptyState.classList.remove('hidden');
  }
  const flagsInExperimentRawView = document.getElementById('flagsInExperimentRawView');
  const flagsInExperimentFormattedView = document.getElementById('flagsInExperimentFormattedView');
  if (flagsInExperimentRawView) flagsInExperimentRawView.style.display = 'none';
  if (flagsInExperimentFormattedView) flagsInExperimentFormattedView.style.display = 'none';
  
  // Clear conversion metrics section
  const conversionMetricsTableBody = document.getElementById('conversionMetricsTableBody');
  if (conversionMetricsTableBody) {
    conversionMetricsTableBody.innerHTML = '';
  }
  const conversionMetricsRaw = document.getElementById('conversionMetricsRaw');
  if (conversionMetricsRaw) {
    conversionMetricsRaw.value = '';
  }
  const conversionMetricsEmptyState = document.getElementById('conversionMetricsEmptyState');
  if (conversionMetricsEmptyState) {
    conversionMetricsEmptyState.classList.remove('hidden');
  }
  const conversionMetricsRawView = document.getElementById('conversionMetricsRawView');
  const conversionMetricsFormattedView = document.getElementById('conversionMetricsFormattedView');
  if (conversionMetricsRawView) conversionMetricsRawView.style.display = 'none';
  if (conversionMetricsFormattedView) conversionMetricsFormattedView.style.display = 'none';
  
  // Reset filter to "All"
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-filter') === 'all') {
      btn.classList.add('active');
    }
  });
  
  // Reset filter counters
  updateFilterCounters();
  
  // Reset Client ID
  document.querySelector("#clientIDValue").textContent = "";
}

function exportData() {
  const exportObj = {
    exportedAt: new Date().toISOString(),
    context: document.querySelector(".user-context-details")?.value || "",
    featureFlags: document.querySelector(".featureflags-details")?.value || "",
    events: document.querySelector("#networkDetails")?.value || "",
    experimentGoals: document.querySelector(".experiments-details")?.value || "",
    counters: {
      custom: document.querySelector("#custom-value")?.textContent || "0",
      identify: document.querySelector("#identify-value")?.textContent || "0",
      click: document.querySelector("#click-value")?.textContent || "0",
      feature: document.querySelector("#feature-value")?.textContent || "0",
      experiments: document.querySelector("#experiments-value")?.textContent || "0",
      experimentGoals: document.querySelector("#experiments-goal-value")?.textContent || "0",
      streamConnections: document.querySelector("#streamConnection-value")?.textContent || "0",
      streamEvents: document.querySelector("#streamevent-value")?.textContent || "0"
    }
  };
  
  const dataStr = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `ld-sdk-events-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  log('Data exported successfully');
}

function checkDoNotTrack() {
  try {
    if (!chrome.runtime?.id) {
      return;
    }
    
    chrome.scripting.executeScript(
      {
        target: { tabId: chrome.devtools.inspectedWindow.tabId },
        func: () => {
          // Global Privacy Control (GPC) is the modern replacement for DNT
          const gpcEnabled = navigator.globalPrivacyControl === true;
          
          // Legacy Do Not Track (deprecated, removed from Chrome Dec 2025)
          const dntEnabled = navigator.doNotTrack === "1" || 
                            navigator.doNotTrack === "yes" || 
                            window.doNotTrack === "1";
          
          return {
            gpc: gpcEnabled,
            dnt: dntEnabled,
            privacySignal: gpcEnabled || dntEnabled
          };
        },
      },
      (result) => {
        if (chrome.runtime.lastError) {
          console.log('checkDoNotTrack error:', chrome.runtime.lastError.message);
          return;
        }
        
        if (result && result[0]) {
          const { gpc, dnt, privacySignal } = result[0].result;
          
          // Find existing banner or create a new one
          let dntBanner = document.getElementById('dnt-status-banner');
          if (!dntBanner) {
            dntBanner = document.createElement('div');
            dntBanner.id = 'dnt-status-banner';
            dntBanner.className = 'dnt-banner';
            document.body.insertBefore(dntBanner, document.body.firstChild);
          }
          
          // Determine message based on which signal is active
          if (gpc) {
            dntBanner.textContent = 'Global Privacy Control (GPC) is enabled in this browser.';
          } else if (dnt) {
            dntBanner.textContent = 'Do Not Track (DNT) is enabled in this browser.';
          } else {
            dntBanner.textContent = 'No privacy signal (GPC/DNT) is enabled in this browser.';
          }
          
          // Set different colors based on privacy signal status
          if (privacySignal) {
            dntBanner.style.backgroundColor = '#f44336'; // Red for enabled
          } else {
            dntBanner.style.backgroundColor = '#4CAF50'; // Green for disabled
          }
        }
      }
    );
  } catch (err) {
    console.log('checkDoNotTrack exception:', err.message);
  }
}

/**
 * Detect EventSource/SSE connections directly from the request
 * instead of scanning the entire HAR on every request (O(n²) -> O(1))
 */
function onEventSourceEvents(request) {
  if (request._resourceType !== "eventsource") return;

  const url = request.request?.url;
  if (!url || !url.includes("clientstream")) return;

  handleStreamOpen({
    url: url,
    hash: parseContextHashFromUrl(url),
    clientId: parseClientIDFromUrl(url),
    context: parseUrlForContext(url)
  });
}

function onNavHandler() {
  document.querySelectorAll(".metric").forEach((ele) => ele.remove());

  let typeCounters = window.document.querySelectorAll("span.type-counter");
  typeCounters.forEach((counter) => (counter.textContent = 0));

  extensionGlobals.logEditor.setValue("");
  document.querySelectorAll("textArea").forEach((e) => (e.value = null));
  
  // Clear stream connection tracking on navigation
  // (page refresh will create new SSE connections)
  extensionGlobals.streamConnections.clear();
  
  // Clear events timeline on navigation
  extensionGlobals.eventsData = [];
  const eventsTimeline = document.getElementById('eventsTimeline');
  if (eventsTimeline) {
    eventsTimeline.innerHTML = '';
  }
  updateFilterCounters();
  
  // Re-check Do Not Track status on navigation
  checkDoNotTrack();
}
function parseClientIDFromUrl(url) {
  let section = url.split("/");
  section.splice(1,1); 
  return section[section.length - 3];
}

function parseContextHashFromUrl(url) {
  let section = url.split("/");
  let userHashQS = section[section.length - 1];
  if (!userHashQS || userHashQS.length == 0) {
    return null;
  }
  const [hash, _] = userHashQS.split("?");
  return hash;
}
function parseUrlForContext(url) {
  let userObj = {};
  try {
    const userHash = parseContextHashFromUrl(url);
    userObj = JSON.parse(atob(userHash));
  } catch (err) {
    log(`error in parseUrlForContext() err=${err.message}`);
  }
  return userObj;
}
function updateUserContextDetails(request) {
  if (!request || !request.url) {
    return {};
  }
  let userObj = parseUrlForContext(request.url);
  let textArea = document.querySelector(".user-context-details");
  if (!userObj) {
    return userObj;
  }
  textArea.value +=
    (textArea.value && textArea.value.length > 0 ? "," : "") +
    JSON.stringify(userObj, null, 4);
  updateEmptyState(textArea);
  
  // Update formatted context table
  updateContextTable(userObj);
  
  // Hide empty state and show the active view
  const contextEmptyState = document.getElementById('contextEmptyState');
  if (contextEmptyState) {
    contextEmptyState.classList.add('hidden');
  }
  
  // Show the currently active view
  const activeToggle = document.querySelector('#userContextContainer .toggle-btn.active');
  if (activeToggle) {
    const activeView = activeToggle.getAttribute('data-view');
    const rawView = document.getElementById('contextRawView');
    const formattedView = document.getElementById('contextFormattedView');
    
    if (activeView === 'raw') {
      rawView.style.display = 'block';
      formattedView.style.display = 'none';
    } else {
      rawView.style.display = 'none';
      formattedView.style.display = 'block';
    }
  }

  let clientID= parseClientIDFromUrl(request.url);
  let clientIDValue = document.querySelector("#clientIDValue");
  clientIDValue.textContent = `Client-side ID: ${clientID}`;

  return userObj;
}
function getFlagsInExperiment(flagJSON){
  let flags = {};

  if (!flagJSON){
    return flags;
  }

  for (let key in flagJSON){
    let value = flagJSON[key];
    if (!value?.reason){
      continue;
    }

    if (value.reason?.inExperiment === true){
      flags[key] = value;
    }
  }

  return flags;
}
function evalxHandler(request) {
  const url = request.request?.url;

  if (!isLaunchDarklyUrl(url)) return;
  if (!url.includes("/sdk/eval")) return;
  if (url.includes("/sdk/evalx/") && request.response?.content?.size === 0) return;

  request.getContent((body) => {
    if (!body) { log(`evalxHandler() body is empty, skipping.`); return; }

    let data;
    try { data = JSON.parse(body); } catch (err) { log(`evalxHandler() JSON parse error: ${err.message}`); return; }
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) { log(`evalxHandler() parsed response is empty, skipping.`); return; }

    handleEval({ url: url, data: data, method: request.request.method, bodyLength: body.length, timings: request.timings });
  });
}

/**
 * Log stream connection detection without creating a duplicate EventSource.
 */
function logStreamConnection(connectionInfo, hash) {
  const timestamp = getTimestamp();
  
  extensionGlobals.logEditor.insert("\n");
  extensionGlobals.logEditor.insert(
    `======== [${timestamp}] Stream Connection Detected ========\n`
  );
  extensionGlobals.logEditor.insert(`URL: ${connectionInfo.url}\n`);
  extensionGlobals.logEditor.insert(`Client-side ID: ${connectionInfo.clientId}\n`);
  extensionGlobals.logEditor.insert(`Context Hash: ${hash}\n`);
  extensionGlobals.logEditor.insert(
    `Context: ${JSON.stringify(connectionInfo.context, null, 4)}\n`
  );
  extensionGlobals.logEditor.insert(
    `======== Stream Connection End ========\n`
  );
}

/**
 * Mark a stream connection as closed
 */
function closeStreamConnection(hash) {
  const connection = extensionGlobals.streamConnections.get(hash);
  if (connection) {
    connection.status = 'closed';
    connection.endTime = new Date().toISOString();
    updateStreamConnectionCounter();
  }
}

function eventsHandler(request) {
  const url = request.request?.url;

  if (!isLaunchDarklyUrl(url) || request.request?.method !== "POST") return;
  if (!url.includes("/events/bulk")) return;

  const postData = request.request?.postData?.text;
  if (!postData) { log(`eventsHandler() no postData, skipping.`); return; }

  handleSent({ url: url, body: postData });
}

function updateTypeCounters(eventTypeCounts) {
  Object.keys(eventTypeCounts).forEach((key) => {
    let eleId = `${key}-value`;
    let ele = window.document.querySelector(`#${eleId}`);
    if (!ele) {
      log(`updateTypeCounters(): eleId=${eleId} NOT FOUND!`);
      return;
    }
    const newValue = parseInt(ele.textContent) + eventTypeCounts[key];
    if (newValue !== parseInt(ele.textContent)) {
      ele.textContent = newValue;
      animateCounter(ele);
    }
  });
}
function updateExperimentGoalsCounter(count) {
  let ele = window.document.querySelector("#experiments-goal-value");
  const newValue = parseInt(ele.textContent) + count;
  ele.textContent = newValue;
  animateCounter(ele);
}
function updateExperimentsCounter(count) {
  let ele = window.document.querySelector("#experiments-value");
  ele.textContent = count;
  animateCounter(ele);
}
/**
 * Update stream events counter (legacy - kept for compatibility)
 * Note: Without creating duplicate EventSource connections, we cannot
 * intercept individual SSE events. This counter now shows total connections.
 */
function updateStreamEventsCounter() {
  const ele = window.document.querySelector("#streamevent-value");
  if (!ele) return;
  
  // Count total events across all connections
  let totalEvents = 0;
  extensionGlobals.streamConnections.forEach(conn => {
    totalEvents += conn.eventCount || 0;
  });
  
  ele.textContent = totalEvents;
  animateCounter(ele);
}

/**
 * Update stream connection counter to show active connections
 */
function updateStreamConnectionCounter() {
  const ele = window.document.querySelector("#streamConnection-value");
  if (!ele) return;
  
  // Count only active connections
  let activeCount = 0;
  extensionGlobals.streamConnections.forEach(conn => {
    if (conn.status === 'active') {
      activeCount++;
    }
  });
  
  const newValue = activeCount;
  if (parseInt(ele.textContent) !== newValue) {
    ele.textContent = newValue;
    animateCounter(ele);
  }
}

/**
 * Get total stream connections (active + closed)
 */
function getTotalStreamConnections() {
  return extensionGlobals.streamConnections.size;
}

function countEventTypes(events) {
  return events.reduce(
    (acc, curr) => {
      let { custom, click, identify, feature } = acc;
      let { kind } = curr;

      switch (kind) {
        case "identify":
          identify++;
          break;
        case "custom":
          custom++;
          break;
        case "click":
          click++;
          break;
        case "feature":
          feature++;
          break;
        case "summary":
          feature = Object.keys(curr.features).length;
          break;
      }
      return {
        identify,
        custom,
        click,
        feature,
      };
    },
    {
      custom: 0,
      click: 0,
      identify: 0,
      feature: 0,
    }
  );
}

function goalsHandler(request) {
  const url = request.request?.url;

  if (!isLaunchDarklyUrl(url)) return;
  if (!url.includes("/goals/")) return;
  if (request.response?.content?.size === 0) return;

  request.getContent((body) => {
    if (!body) return;

    let data;
    try { data = JSON.parse(body); } catch (err) { log(`goalsHandler() JSON parse error: ${err.message}`); return; }

    // Extension uses evalInspectPage to read the inspected page's URL
    Promise.allSettled([
      evalInspectPage((_) => window.location.href),
      evalInspectPage((_) => window.location.search),
      evalInspectPage((_) => window.location.hash),
    ])
      .then((results) => {
        const [winHref, winSearch, winHash] = results;
        handleGoals({
          url: url, data: data,
          href: winHref.value?.[0]?.result || '',
          search: winSearch.value?.[0]?.result || '',
          hash: winHash.value?.[0]?.result || ''
        });
      })
      .catch((err) => { log(`goalsHandler() Error: ${err.message || err}`); });
  });
}

function updateConversionMetricsTable(goals) {
  if (!goals || goals.length === 0) {
    return;
  }

  // Update raw textarea
  const rawTextarea = document.getElementById('conversionMetricsRaw');
  if (rawTextarea) {
    rawTextarea.value = JSON.stringify(goals, null, 2);
  }

  // Update formatted table
  const tableBody = document.getElementById('conversionMetricsTableBody');
  if (tableBody) {
    // Clear existing rows
    tableBody.innerHTML = '';

    // Process goals
    const goalsMapped = goals.map(
      ({
        kind = "",
        key = "",
        selector,
        urlMatch = false,
        targetMatch = "N/A",
        urls,
      }) => ({
        enabled: urlMatch && (targetMatch === "N/A" ? true : targetMatch),
        kind,
        key,
        urlMatch,
        targetMatch,
      })
    );
    
    // Create a row for each goal
    goalsMapped.forEach((goal) => {
      const row = document.createElement('div');
      row.className = 'data-table-row';
      
      // Status cell
      const statusCell = document.createElement('div');
      statusCell.className = 'data-table-cell';
      statusCell.innerHTML = goal.enabled 
        ? '<span class="status-badge status-enabled">Enabled</span>'
        : '<span class="status-badge status-disabled">Disabled</span>';
      
      // Kind cell
      const kindCell = document.createElement('div');
      kindCell.className = 'data-table-cell';
      kindCell.innerHTML = `<span class="metric-kind-badge">${escapeHtml(goal.kind)}</span>`;
      
      // Goal Key cell
      const keyCell = document.createElement('div');
      keyCell.className = 'data-table-cell';
      keyCell.textContent = goal.key;
      
      // URL Match cell
      const urlMatchCell = document.createElement('div');
      urlMatchCell.className = 'data-table-cell';
      urlMatchCell.innerHTML = goal.urlMatch 
        ? '<span class="value-true">true</span>' 
        : '<span class="value-false">false</span>';
      
      // Target Match cell
      const targetMatchCell = document.createElement('div');
      targetMatchCell.className = 'data-table-cell';
      if (goal.targetMatch === "N/A") {
        targetMatchCell.innerHTML = '<span style="color: #999;">N/A</span>';
      } else {
        targetMatchCell.innerHTML = goal.targetMatch 
          ? '<span class="value-true">true</span>' 
          : '<span class="value-false">false</span>';
      }
      
      row.appendChild(statusCell);
      row.appendChild(kindCell);
      row.appendChild(keyCell);
      row.appendChild(urlMatchCell);
      row.appendChild(targetMatchCell);
      tableBody.appendChild(row);
    });
  }
  
  // Hide empty state and show the active view
  const emptyState = document.getElementById('conversionMetricsEmptyState');
  if (emptyState) {
    emptyState.classList.add('hidden');
  }
  
  // Show the currently active view
  const activeToggle = document.querySelector('#conversionMetricsSection .toggle-btn.active');
  if (activeToggle) {
    const activeView = activeToggle.getAttribute('data-view');
    const rawView = document.getElementById('conversionMetricsRawView');
    const formattedView = document.getElementById('conversionMetricsFormattedView');
    
    if (activeView === 'raw') {
      rawView.style.display = 'block';
      formattedView.style.display = 'none';
    } else {
      rawView.style.display = 'none';
      formattedView.style.display = 'block';
    }
  }
}



function updateFlagInExperimentTable(flags) {
  if (!flags || Object.keys(flags).length === 0) {
    return;
  }

  // Update raw textarea
  const rawTextarea = document.getElementById('flagsInExperimentRaw');
  if (rawTextarea) {
    rawTextarea.value = JSON.stringify(flags, null, 2);
  }

  // Update formatted table
  const tableBody = document.getElementById('flagsInExperimentTableBody');
  if (tableBody) {
    // Clear existing rows
    tableBody.innerHTML = '';
    
    // Create a row for each flag
    for (const flagKey in flags) {
      const flag = flags[flagKey];
      const row = document.createElement('div');
      row.className = 'data-table-row';
      
      // Flag Key cell
      const keyCell = document.createElement('div');
      keyCell.className = 'data-table-cell';
      keyCell.textContent = flagKey;
      
      // Value cell
      const valueCell = document.createElement('div');
      valueCell.className = 'data-table-cell';
      valueCell.innerHTML = formatFlagValue(flag.value);
      
      // Reason cell
      const reasonCell = document.createElement('div');
      reasonCell.className = 'data-table-cell';
      reasonCell.innerHTML = formatFlagReason(flag.reason);
      
      // Variation cell
      const variationCell = document.createElement('div');
      variationCell.className = 'data-table-cell';
      variationCell.textContent = flag.variation !== undefined ? flag.variation : '—';
      
      row.appendChild(keyCell);
      row.appendChild(valueCell);
      row.appendChild(reasonCell);
      row.appendChild(variationCell);
      tableBody.appendChild(row);
    }
  }
  
  // Hide empty state and show the active view
  const emptyState = document.getElementById('flagsInExperimentEmptyState');
  if (emptyState) {
    emptyState.classList.add('hidden');
  }
  
  // Show the currently active view
  const activeToggle = document.querySelector('#flagsInExperimentSection .toggle-btn.active');
  if (activeToggle) {
    const activeView = activeToggle.getAttribute('data-view');
    const rawView = document.getElementById('flagsInExperimentRawView');
    const formattedView = document.getElementById('flagsInExperimentFormattedView');
    
    if (activeView === 'raw') {
      rawView.style.display = 'block';
      formattedView.style.display = 'none';
    } else {
      rawView.style.display = 'none';
      formattedView.style.display = 'block';
    }
  }
}



function processGoals(goals, locationHref, search, hash) {
  if (goals.length == 0) {
    updateConversionMetricsTable([]);
    return;
  }
  
  const code = (sel) => {
    return !sel ? null : window.document.querySelector(`${sel}`);
  };
  const tasks = [];
  goals.forEach(({ selector }) => {
    tasks.push(evalInspectPage(code, selector));
  });
  Promise.allSettled(tasks).then((results) => {
    let collection = [];
    results.forEach((result, idx) => {
      let { kind, key, selector, urls } = goals[idx];
      let matchedUrl = urls.filter((url) =>
        doesUrlMatch(url, locationHref, search, hash)
      );
      let urlMatch = matchedUrl && matchedUrl.length > 0;
      let entry = {
        kind,
        key,
        selector,
        urlMatch,
        targetMatch:
          result.value[0] && result.value[0].result != null ? true : false,
        urls,
      };
      entry.targetMatch = entry.kind === "pageview" ? "N/A" : entry.targetMatch;
      collection.push(entry);
    });
    if (collection.length > 0){
      let element = document.getElementById('conversionMetricsSection');
      if (element) {
        element.style.display = 'block';
      }

      element = document.getElementById('experimentGoals');
      if (element) {
        element.style.display = 'block';
      }
    }
    updateConversionMetricsTable(collection);
    
    let enabledExperiments = collection.filter(
      ({ urlMatch, targetMatch }) =>
        urlMatch == true && (targetMatch == true || targetMatch == "N/A")
    );
    updateExperimentGoalsCounter(enabledExperiments.length);
  });
}

function logInspectedWindow(msg) {
  try {
    if (!chrome.runtime?.id) {
      return;
    }
    
    chrome.scripting.executeScript({
      target: { tabId: chrome.devtools.inspectedWindow.tabId },
      args: [msg],
      func: (str) => {
        console.log(str);
      },
    }).catch(() => {
      // Silently handle errors when context is invalidated
    });
  } catch (err) {
    // Silently handle extension context invalidation
  }
}

function evalInspectPage(code, params = "") {
  return new Promise((resolve, reject) => {
    try {
      if (!chrome.runtime?.id) {
        reject(new Error('Extension context invalidated'));
        return;
      }
      
      chrome.scripting.executeScript(
        {
          target: { tabId: chrome.devtools.inspectedWindow.tabId },
          args: [params],
          func: code,
        },
        function (result) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(result);
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

function logNetwork(request) {
  const url = request.request?.url;
  
  if (!isLaunchDarklyUrl(url)) {
    return;
  }
  
  // Only process /events/bulk/ or /sdk/eval endpoints
  if (!url.includes("/events/bulk/") && !url.includes("/sdk/eval")) {
    return;
  }
  
  new Promise((resolve) => {
    const method = request.request?.method;
    
    switch (method) {
      case "POST":
        resolve(request.request?.postData?.text || null);
        break;
      case "GET":
        request.getContent((body) => {
          if (!body) {
            return resolve(null);
          }
          try {
            const parsed = JSON.parse(body);
            // Check for empty response (works for arrays and objects)
            if (!parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) {
              return resolve(null);
            }
          } catch (err) {
            log(`logNetwork() JSON parse error: ${err.message}`);
            return resolve(null);
          }
          resolve(body);
        });
        break;
      default:
        resolve(null);
        break;
    }
  }).then((data) => {
    if (!data) {
      return;
    }

    const timestamp = getTimestamp();
    extensionGlobals.logEditor.insert(
      `\n======== [${timestamp}] EVENT START ========\n` +
      `Method: [${request.request.method}] URL: [${url}]\n` +
      `${JSON.stringify(data, null, 4)}\n` +
      `======== EVENT END   ========\n`
    );
  });
}

function log(message) {
  try {
    // Check if chrome.runtime is still valid
    if (!chrome.runtime?.id) {
      console.log('[Extension context invalidated]', message);
      return;
    }
    
    chrome.scripting.executeScript({
      target: { tabId: chrome.devtools.inspectedWindow.tabId },
      args: [message],
      func: (str) => {
        console.log(str);
      },
    }).catch((err) => {
      // Silently handle errors when context is invalidated
      console.log('[DevTools log fallback]', message);
    });
  } catch (err) {
    // Fallback to console.log if extension context is invalidated
    console.log('[DevTools log fallback]', message);
  }
}

function toggle() {
  let container = this.parentElement.querySelector(":scope  div.container");
  if (!container.offsetParent) {
    container.style = "display:block";
  } else {
    container.style = "display:none";
  }
}

function debug(msg) {
  extensionGlobals.logEditor.insert("======== DEBUG  START ========\n");
  extensionGlobals.logEditor.insert(msg);
  extensionGlobals.logEditor.insert("======== DEBUG  END ========\n");
}

// ================================================================
// Shared handler functions — used by both Chrome extension handlers
// and the bookmarklet adapter (window.LDPanel).
// ================================================================

function handleEval(d) {
  var url = d.url;
  var bodyObj = d.data;
  var method = d.method || 'GET';
  var timestamp = d.timestamp || getTimestamp();

  if (method === 'GET') {
    updateUserContextDetails({ url: url });
  }

  var flagsInExperimentData = getFlagsInExperiment(bodyObj);
  var flagsInExperimentCount = Object.keys(flagsInExperimentData).length;
  updateExperimentsCounter(flagsInExperimentCount);
  if (flagsInExperimentCount > 0) {
    var flagsInExpSection = document.getElementById('flagsInExperimentSection');
    if (flagsInExpSection) flagsInExpSection.style.display = 'block';
    updateFlagInExperimentTable(flagsInExperimentData);
  }

  var ffTextArea = document.querySelector(".featureflags-details");
  if (ffTextArea) {
    ffTextArea.value = JSON.stringify(bodyObj, null, 2);
    updateEmptyState(ffTextArea);
  }

  updateFeatureFlagsTable(bodyObj);
  showSectionView('featureFlagsContainer', 'flagsEmptyState', 'flagsRawView', 'flagsFormattedView');

  extensionGlobals.logEditor.insert(
    '\n======== [' + timestamp + '] RECEIVE EVENT START ========\n' +
    method + ' url[' + url + ']\n' +
    JSON.stringify(bodyObj) + '\n' +
    '======== RECEIVE EVENT END   ========\n'
  );

  addReceivedEvent(url, bodyObj, timestamp, d.timings || null, d.bodyLength || 0);
}

function handleSent(d) {
  var url = d.url;
  var timestamp = d.timestamp || getTimestamp();
  var events;
  try { events = JSON.parse(d.body); } catch (e) { return; }
  if (!Array.isArray(events) || events.length === 0) return;

  extensionGlobals.logEditor.insert(
    '\n======== [' + timestamp + '] SENT EVENT START ========\n' +
    'POST url[' + url + ']\n' +
    JSON.stringify(events) + '\n' +
    '======== SENT EVENT END   ========\n'
  );

  var eventTypeCounts = countEventTypes(events);
  updateTypeCounters(eventTypeCounts);
  addSentEvents(url, events, timestamp);
}

function handleGoals(d) {
  processGoals(
    d.data,
    d.href || window.location.href,
    d.search || window.location.search,
    d.hash || window.location.hash
  );
}

function handleStreamOpen(d) {
  var hash = d.hash;
  if (!hash || extensionGlobals.streamConnections.has(hash)) return;

  var connectionInfo = {
    url: d.url,
    status: 'active',
    startTime: d.timestamp || new Date().toISOString(),
    eventCount: 0,
    context: d.context,
    clientId: d.clientId
  };
  extensionGlobals.streamConnections.set(hash, connectionInfo);
  logStreamConnection(connectionInfo, hash);
  updateStreamConnectionCounter();
}

function handleStreamEvent(d) {
  var conn = extensionGlobals.streamConnections.get(d.hash);
  if (conn) {
    conn.eventCount = (conn.eventCount || 0) + 1;
  }
  updateStreamEventsCounter();
}

// ================================================================
// Bookmarklet API — allows the bookmarklet to drive panel.js
// without Chrome DevTools APIs.
// ================================================================
window.LDPanel = {
  setupButtons: setupButtons,
  handleEval: handleEval,
  handleSent: handleSent,
  handleGoals: handleGoals,
  handleStreamOpen: handleStreamOpen,
  handleStreamEvent: handleStreamEvent,
  clearAllData: clearAllData,
  showToast: showToast,
  isLaunchDarklyUrl: isLaunchDarklyUrl,
  parseContextHashFromUrl: parseContextHashFromUrl,
  parseClientIDFromUrl: parseClientIDFromUrl,
  parseUrlForContext: parseUrlForContext,
  getTimestamp: getTimestamp
};
