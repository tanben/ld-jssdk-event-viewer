var extensionGlobals = {
  logEditor: {
    insert: (msg) => {
      let ele = document.querySelector("textArea#networkDetails");
      ele.value += `\n`;
      ele.value += msg;
    },
    setValue: (msg) => {
      let ele = document.querySelector("textArea#networkDetails");
      ele.value = msg;
    },
  },
  eventSource: [],
};

main();

//------------

function main() {
  chrome.devtools.network.onRequestFinished.addListener(onEventSourceEvents);
  chrome.devtools.network.onRequestFinished.addListener(evalxHandler);

  chrome.devtools.network.onRequestFinished.addListener(goalsHandler);
  chrome.devtools.network.onRequestFinished.addListener(logNetwork);
  chrome.devtools.network.onRequestFinished.addListener(eventsHandler);
  chrome.devtools.network.onNavigated.addListener(onNavHandler);
}

function onEventSourceEvents(handler) {
  chrome.devtools.network.getHAR(function (events) {
    if (events?.entries && events?.entries.length == 0){
      return;
    }

    let eventSources = events.entries.filter(
      ({ _resourceType, request }) =>
        _resourceType === "eventsource" &&
        request.url.includes("clientstream") &&
        !extensionGlobals.eventSource.includes(
          parseContextHashFromUrl(request.url)
        )
    );
    

    eventSources.forEach((eventSource) => {
      const { request } = eventSource;
      const hash = parseContextHashFromUrl(request.url);
      extensionGlobals.eventSource.push(hash);
      eventStreamHandler(request);
      updateStreamConnectionCounter();
    });
  });
}

function onNavHandler() {
  document.querySelectorAll(".metric").forEach((ele) => ele.remove());

  let typeCounters = window.document.querySelectorAll("span.type-counter");
  typeCounters.forEach((counter) => (counter.textContent = 0));

  extensionGlobals.logEditor.setValue("");
  document.querySelectorAll("textArea").forEach((e) => (e.value = null));
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

  let clientID= parseClientIDFromUrl(request.url);
  let clientIDValue = document.querySelector("#clientIDValue");
  clientIDValue.textContent = `Client-side ID: ${clientID}`;

  return userObj;
}
function getFlagsInExperiment(flagJSON){
  let flags={};

  if (!flagJSON){
    return data;
  }

  for (key in flagJSON){
      let value =  flagJSON[key];
      if (!value?.reason){
          continue
      }

      if (value.reason?.inExperiment == true){
        flags[key]= value;
      }
      
  }

  return flags;
}
function evalxHandler(request) {
  
  if (!request.request.url.includes("app.launchdarkly.com")) {
    return;
  }

  if (
    !request.request.url.includes("/sdk/eval") ||
    (request.request.url.includes("/sdk/evalx/") &&
      request.response.content.size == 0)
  ) {
    return;
  }

  if (request.request.method == "GET") {
    updateUserContextDetails(request.request);
  }
  // http://www.softwareishard.com/blog/har-12-spec/#request
  // https://metacpan.org/pod/Archive::Har::Entry::Timings
  log(
    `Launchpad Extension: sdk/eval request-response HAR timings in (ms)=${JSON.stringify(
      request.timings
    )}`
  );

  request.getContent((body) => {
    if (!body) {
      log(`evalxHandler() body is empty skipping.`);
      return;
    }

    let bodyObj = JSON.parse(body);

    
    if (bodyObj && bodyObj.length == 0) {
      log(`evalxHandler() body parsed array is empty skipping.`);
      return;
    }

    log(
      `Launchpad Extension: sdk/evalcontent body size=${
        body.length
      } bytes , flags=${Object.keys(bodyObj).length}`
    );

    let flagsInExperimentData = getFlagsInExperiment(bodyObj);
    let flagsInExperimentCount= Object.keys(flagsInExperimentData).length;
    updateExperimentsCounter(flagsInExperimentCount);
    if (flagsInExperimentCount >0){
      document.getElementById('flagsInExperiment').style.display='block';

      updateFlagInExperimentTable(flagsInExperimentData);
    }
    
    let ffTextArea = document.querySelector(".featureflags-details");
    ffTextArea.value = ffTextArea.value || "";

    ffTextArea.value +=
      (ffTextArea.value.length > 0 ? "," : "") +
      JSON.stringify(bodyObj, null, 4);
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(
      "======== RECEIVE EVENT START ========\n"
    );
    extensionGlobals.logEditor.insert(
      `${request.request.method} url[${request.request.url}]`
    );
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(JSON.stringify(bodyObj));
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(
      "======== RECEIVE EVENT END   ========\n"
    );
  });
}

function eventStreamHandler(request) {
  let { url } = request;
  let source = new EventSource(url);

  let logInsert = function (method, url, data) {
    let context = parseUrlForContext(url);

    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(
      `======== [${method}] - Stream RECEIVE EVENT START ========\n`
    );
    extensionGlobals.logEditor.insert(`${method} url[${url}]`);
    extensionGlobals.logEditor.insert("\n");

    extensionGlobals.logEditor.insert(
      `Client_SIDE_ID=${parseClientIDFromUrl(url)}`
    );

    extensionGlobals.logEditor.insert(
      `DATA=${JSON.stringify(JSON.parse(data), null, 4)}`
    );
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(
      `CONTEXT=${JSON.stringify(context, null, 4)}`
    );

    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(
      `======== [${method}] - Stream RECEIVE EVENT END ========\n`
    );
  };
  source.addEventListener(
    "patch",
    function (e) {
      logInsert("PATCH", url, e.data);
      updateStreamEventsCounter();
    },
    false
  );
  source.addEventListener(
    "put",
    function (e) {
      logInsert("PUT", url, e.data);
      updateStreamEventsCounter();
    },
    false
  );
}

function eventsHandler(request) {
  if (!request.request.url.includes("launchdarkly.com") ||  request.request.method !== "POST") {
    return;
  }

  if (!request.request.url.includes("/events/bulk") ) {
    return;
  }

  let events = JSON.parse(request.request.postData.text);
  extensionGlobals.logEditor.insert("\n");
  extensionGlobals.logEditor.insert("======== SENT EVENT START ========\n");
  extensionGlobals.logEditor.insert(
    `${request?.request?.method} url[${request?.request?.url}]`
  );
  extensionGlobals.logEditor.insert("\n");
  extensionGlobals.logEditor.insert(JSON.stringify(events));
  extensionGlobals.logEditor.insert("\n");
  extensionGlobals.logEditor.insert("======== SENT EVENT END   ========\n");

  let eventTypeCounts = countEventTypes(events);
  updateTypeCounters(eventTypeCounts);
}

function updateTypeCounters(eventTypeCounts) {
  Object.keys(eventTypeCounts).forEach((key) => {
    let eleId = `${key}-value`;
    let ele = window.document.querySelector(`#${eleId}`);
    if (!ele) {
      log(`updateTypeCounters(): eleId=${eleId} NOT FOUND!`);
      return;
    }
    ele.textContent = parseInt(ele.textContent) + eventTypeCounts[key];
  });
}
function updateExperimentGoalsCounter(count) {
  let ele = window.document.querySelector("#experiments-goal-value");
  ele.textContent = parseInt(ele.textContent) + count;
}
function updateExperimentsCounter(count) {
  let ele = window.document.querySelector("#experiments-value");
  ele.textContent = parseInt(ele.textContent) + count;
}
function updateStreamEventsCounter() {
  let ele = window.document.querySelector("#streamevent-value");
  ele.textContent = parseInt(ele.textContent) + 1;
}
function updateStreamConnectionCounter() {
  let ele = window.document.querySelector("#streamConnection-value");
  ele.textContent = parseInt(ele.textContent) + 1;
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
  if (!request.request.url.includes("launchdarkly.com")) {
    return;
  }
  if (
    !request.request.url.includes("/goals/") ||
    (request.request.url.includes("/goals") &&
      request.response.content.size == 0)
  ) {
    return;
  }
  request.getContent((body) => {
    if (!body) {
      return;
    }
    Promise.allSettled([
      evalInspectPage((_) => window.location.href),
      evalInspectPage((_) => window.location.search),
      evalInspectPage((_) => window.location.hash),
    ])
      .then((results) => {
        let [winHref, winSearch, winHash] = results;
        // log(`winHref=${JSON.stringify(winHref)}`);
        // log(`winSearch=${JSON.stringify(winSearch)}`);
        // log(`winHash=${JSON.stringify(winHash)}`);
        let href = winHref.value[0].result;
        let search = winSearch.value[0].result;
        let hash = winHash.value[0].result;
        processGoals(JSON.parse(body), href, search, hash);
      })
      .catch((err) => {
        log(`goalsHandler() Error=${err}`);
      });
  });
}

function updateConversionMetricsTable(goals) {
  if (!goals || (goals && goals.length == 0)) {
    return;
  }

  let goalTextArea = document.querySelector(".experiments-details");
  goalTextArea.value = JSON.stringify(goals, null, 4);

  const rowDiv = document.createElement("div");
  rowDiv.className = "table-row metric";
  let goalsMapped = goals.map(
    ({
      kind = "",
      key = "",
      selector,
      urlMatch = false,
      targetMatch = "N/A",
      urls,
    }) => ({
      enabled: urlMatch && (targetMatch == "N/A" ? true : targetMatch),
      kind,
      key,
      urlMatch,
      targetMatch,
      urls,
      selector,
    })
  );
  goalsMapped.forEach((goal) => {
    for (key in goal) {
      if (key === "urls" || key === "selector") {
        continue;
      }

      let cell = document.createElement("div");
      cell.className = "table-cell";

      switch (key) {
        case "enabled":
          cell.className +=
            goal[key] == true ? " metric-enabled" : " metric-disabled";
          cell.textContent = "";
          break;
        default:
          cell.textContent = goal[key];
          break;
      }
      rowDiv.appendChild(cell);
    }
  });
  let containerHeaderEle = document.querySelector(
    "#conversionMetricsContainer > div.table-row"
  );
  containerHeaderEle.appendChild(rowDiv);
}



function updateFlagInExperimentTable(flags) {
  if (!flags || (flags && Object.keys(flags).length == 0)) {
    return;
  }


  const rowDiv = document.createElement("div");
  rowDiv.className = "table-row metric";
  

  for (let key in flags){
    let {value, reason} = flags[key];
    let data={key,  kind:flags[key].reason.kind, value:flags[key].value};
    
    for (let key in  data){
      let cell = document.createElement("div");
      cell.className = "table-cell";
      cell.textContent = data[key];
      rowDiv.appendChild(cell);
    }
    
  }

  let containerHeaderEle = document.querySelector(
    "#flagsInExperimentContainer > div.table-row"
  );
  containerHeaderEle.appendChild(rowDiv);
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
      let element = document.getElementById('conversionMetrics');
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
  chrome.devtools.inspectedWindow.eval(`console.log('${msg}');`);
}

function evalInspectPage(code, params = "") {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: chrome.devtools.inspectedWindow.tabId },
        args: [params],
        func: code,
      },
      function (result) {
        // log(`executeScript: Result=${JSON.stringify(result)}`);
        resolve(result);
      }
    );
  });
}

function logNetwork(request) {
  if (!request.request.url.includes("launchdarkly.com")) {
    return;
  }
  if (
    !request.request.url.includes("/events/bulk/") ||
    !request.request.url.includes("/sdk/eval")
  ) {
    return;
  }
  new Promise((resolve) => {
    switch (request.request.method) {
      case "POST":
        let data = request.request.postData
          ? request.request.postData.text
          : null;
        resolve(data);
        break;
      case "GET":
        request.getContent((body) => {
          // log(`GET ${request.request.url} ${body}`)
          if (!body || (body && JSON.parse(body).length == 0)) {
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

    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert("======== EVENT START ========\n");
    extensionGlobals.logEditor.insert(
      `Method: [${request.request.method}] URL: [${request.request.url}]`
    );
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(JSON.stringify(data, null, 4));
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert("======== EVENT END   ========\n");
  });
}

function log(message) {
  chrome.scripting.executeScript({
    target: { tabId: chrome.devtools.inspectedWindow.tabId },
    args: [message],
    func: (str) => {
      console.log(str);
    },
  });
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
