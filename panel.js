var extensionGlobals = {
    logEditor: {
        insert: (msg) => {
            let ele = document.querySelector('textArea#networkDetails');
            ele.value += `\n`;
            ele.value += msg;
        },
        setValue: (msg) => {
            let ele = document.querySelector('textArea#networkDetails');
            ele.value = msg;
        }
    }
};

main();


//------------

function main() {

    chrome.devtools.network.onRequestFinished.addListener(goalsHandler);
    chrome.devtools.network.onRequestFinished.addListener(logNetwork);
    chrome.devtools.network.onRequestFinished.addListener(eventsHandler);
    chrome.devtools.network.onRequestFinished.addListener(evalxHandler);

    chrome.devtools.network.onNavigated.addListener(onNavHandler);
}

function onNavHandler() {
    document.querySelectorAll('.metric').forEach(ele => ele.remove());

    let typeCounters = window.document.querySelectorAll('span.type-counter');
    typeCounters.forEach(counter => (counter.textContent = 0));

    extensionGlobals.logEditor.setValue("");
    document.querySelector('.experiments-details').value = null;
    document.querySelector('.featureflags-details').value = null;
}

function evalxHandler(request) {

    if (!request.request.url.includes("launchdarkly.com")) {
        return
    }

    if (!request.request.url.includes("/sdk/eval") || (request.request.url.includes("/sdk/evalx/") && request.response.content.size == 0)) {
        return;
    }


    request.getContent((body) => {
        let bodyObj = JSON.parse(body);

        if (bodyObj.length == 0) {
            return;
        }
        let bodyStrfy = JSON.stringify(bodyObj, null, 4);

        let ffTextArea = document.querySelector('.featureflags-details');
        ffTextArea.value = bodyStrfy;

        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert("======== RECEIVE EVENT START ========\n");
        extensionGlobals.logEditor.insert(`${request.request.method} url[${request.request.url}]`);
        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert(bodyStrfy);
        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert("======== RECEIVE EVENT END   ========\n");
    });
}

function eventsHandler(request) {
    if (!request.request.url.includes("launchdarkly.com")) {
        return
    }

    if (!request.request.url.includes("/events/bulk/") || (request.request.url.includes("/events/bulk/") && request.request.method !== "POST")) {
        return;
    }

    let events = JSON.parse(request.request.postData.text);
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert("======== SENT EVENT START ========\n");
    extensionGlobals.logEditor.insert(`${request.request.method} url[${request.request.url}]`);
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert(JSON.stringify(events, null, 4));
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert("======== SENT EVENT END   ========\n");

    let eventTypeCounts = countEventTypes(events);
    updateTypeCounters(eventTypeCounts);
}

function updateTypeCounters(eventTypeCounts) {
    Object.keys(eventTypeCounts).forEach(key => {
        let eleId = `${key}-value`;
        let ele = window.document.querySelector(`#${eleId}`);
        if (!ele) {
            log(`updateTypeCounters(): eleId=${eleId} NOT FOUND!`);
            return;
        }
        ele.textContent = parseInt(ele.textContent) + eventTypeCounts[key];
    })
}

function updateExperimentsCounter(count) {
    let ele = window.document.querySelector("#experiments-value");
    ele.textContent = parseInt(ele.textContent) + count;
}

function countEventTypes(events) {

    return events.reduce((acc, curr) => {
        let {
            custom,
            click,
            identify,
            feature
        } = acc;
        let {
            kind
        } = curr;

        switch (kind) {
            case 'identify':
                identify++;
                break;
            case 'custom':
                custom++;
                break;
            case 'click':
                click++;
                break;
            case 'feature':
                feature++;
                break;
            case 'summary':
                feature = Object.keys(curr.features).length;
                break;
        }
        // log (`countEventTypes=${kind}`);
        return {
            identify,
            custom,
            click,
            feature
        };
    }, {
        custom: 0,
        click: 0,
        identify: 0,
        feature: 0
    });
}



function goalsHandler(request) {

    if (!request.request.url.includes("launchdarkly.com")) {
        return
    }
    if (!request.request.url.includes("/goals/") || (request.request.url.includes("/goals") && request.response.content.size == 0)) {
        return;
    }
    request.getContent((body) => {
        let bodyObj = JSON.parse(body);
        let bodyStrfy = JSON.stringify(bodyObj, null, 4);

        if (bodyObj.length == 0) {
            return;
        }

        Promise.allSettled([evalInspectPage('window.location.href'),
                evalInspectPage('window.location.search'),
                evalInspectPage('window.location.hash')
            ])
            .then((results) => {
                let [winHref, winSearch, winHash] = results;
                processGoals(bodyObj, winHref.value[0], winSearch.value[0], winHash.value[0]);
            })
    });

}

function updateConversionMetricsTable(goals) {
    if (!goals || goals && goals.length == 0) {
        return;
    }

    let goalTextArea = document.querySelector('.experiments-details');
    goalTextArea.value = JSON.stringify(goals, null, 4);

    const rowDiv = document.createElement("div");
    rowDiv.className = 'table-row metric';
    let goalsMapped = goals.map(({
        kind = '',
        key = '',
        selector,
        urlMatch = false,
        targetMatch = 'N/A',
        urls
    }) => ({
        enabled: (urlMatch && (targetMatch == 'N/A' ? true : targetMatch)),
        kind,
        key,
        urlMatch,
        targetMatch,
        urls,
        selector
    }));
    goalsMapped.forEach((goal) => {
        for (key in goal) {
            if (key === 'urls' || key === 'selector') {
                continue;
            }

            let cell = document.createElement("div");
            cell.className = "table-cell";

            switch (key) {
                case "enabled":
                    cell.className += (goal[key] == true) ? " metric-enabled" : " metric-disabled";
                    cell.textContent = "";
                    break;
                default:
                    cell.textContent = goal[key];
                    break;
            }
            rowDiv.appendChild(cell);
        }
    })
    let containerHeaderEle = document.querySelector('#conversionMetricsContainer > div.table-row')
    containerHeaderEle.appendChild(rowDiv);
}


function processGoals(goals, locationHref, search, hash) {

    if (goals.length == 0) {
        updateConversionMetricsTable([]);
        return;
    }
    let tasks = [];
    goals.forEach(({
        selector
    }) => {
        let code = `window.document.querySelector("${selector}")`;
        tasks.push(evalInspectPage(code));
    })
    Promise.allSettled(tasks)
        .then(results => {
            let collection = [];
            results.forEach((result, idx) => {
                let {
                    kind,
                    key,
                    selector,
                    urls
                } = goals[idx];
                let matchedUrl = urls.filter(url => doesUrlMatch(url, locationHref, search, hash));
                let urlMatch = (matchedUrl && matchedUrl.length > 0);

                let entry = {
                    kind,
                    key,
                    selector,
                    urlMatch,
                    targetMatch: (result.value[0] && result.value[0] != null) ? true : false,
                    urls

                };
                entry.targetMatch = (entry.kind === 'pageview') ? "N/A" : entry.targetMatch;
                collection.push(entry);
            });
            updateConversionMetricsTable(collection);
            let enabledExperiments = collection.filter(({
                urlMatch,
                targetMatch
            }) => (urlMatch == true && (targetMatch == true || targetMatch == "N/A")));
            updateExperimentsCounter(enabledExperiments.length);

        });
}


function logInspectedWindow(msg) {
    chrome.devtools.inspectedWindow.eval(
        `console.log('${msg}');`
    )
}

function evalInspectPage(code) {
    return new Promise(resolve => {
        chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, {
            code
        }, function (result) {
            // log("executeScript: Result Start----");
            // log(JSON.stringify(code,null,2));
            // log (JSON.stringify(result));
            // log("executeScript: Result End----")

            resolve(result);

        });
    })
}

function logNetwork(request) {
    if (!request.request.url.includes("launchdarkly.com")) {
        return
    }
    if (!request.request.url.includes("/events/bulk/") || !request.request.url.includes("/sdk/eval")) {
        return;
    }
    new Promise(resolve => {
        switch (request.request.method) {
            case "POST":
                let data = (request.request.postData) ? request.request.postData.text : null;
                resolve(data);
                break;
            case "GET":
                request.getContent((body) => {
                    // log(`GET ${request.request.url} ${body}`)
                    if (!body || body && JSON.parse(body).length == 0) {
                        return resolve(null);
                    }
                    resolve(body);
                });
                break;
            default:
                resolve(null);
                break;
        }
    }).then(data => {
        if (!data) {
            return;
        }

        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert("======== EVENT START ========\n");
        extensionGlobals.logEditor.insert(`Method: [${request.request.method}] URL: [${request.request.url}]`);
        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert(JSON.stringify(data, null, 4));
        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert("======== EVENT END   ========\n");

    })
}

function log(msg) {

    let code = {
        code: `console.log('${msg}')`
    };
    //     chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, code, function(result){
    //         log(`log: result=${result}`)
    //     });
    chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, code);
}

function toggle() {

    let container = this.parentElement.querySelector(':scope  div.container');
    if (!container.offsetParent) {
        container.style = "display:block";
    } else {
        container.style = "display:none";
    }


}