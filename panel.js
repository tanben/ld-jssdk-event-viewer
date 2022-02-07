var extensionGlobals = {};

main();


//------------

function main() {
    

    extensionGlobals.logEditor = initializeAceEditor({
        containerId: "logsContainer",
        foldCssSelector: "#logs-container>span.fold",
        unfoldCssSelector: "#logs-container>span.unfold"
    }, "ace/theme/monokai");


    extensionGlobals.flagVariationEditor = initializeAceEditor({
        containerId: "flagVariationContainer",
        foldCssSelector: "#evals-container>span.fold",
        unfoldCssSelector: "#evals-container>span.unfold"
    });

    extensionGlobals.flagGoalsEditor = initializeAceEditor({
        containerId: "flagGoalsContainer",
        foldCssSelector: "#goals-container>span.fold",
        unfoldCssSelector: "#goals-container>span.unfold"
    });

    extensionGlobals.experimentsEditor = initializeAceEditor({
        containerId: "experimentsContainer",
        foldCssSelector: "#experiments-container>span.fold",
        unfoldCssSelector: "#experiments-container>span.unfold"
    });


    chrome.devtools.network.onRequestFinished.addListener(goalsHandler);
    chrome.devtools.network.onRequestFinished.addListener(eventsHandler);
    chrome.devtools.network.onRequestFinished.addListener(evalxHandler);
    

    
    chrome.devtools.network.onNavigated.addListener(() =>{
        extensionGlobals.logEditor.setValue("");
        extensionGlobals.flagVariationEditor.setValue("");
        extensionGlobals.flagGoalsEditor.setValue("");
        extensionGlobals.experimentsEditor.setValue("");
        
        let typeCounters= window.document.querySelectorAll('.typeCounterValue');
        typeCounters.forEach(counter=>(counter.textContent=0));

        return contentTypes = {};
    });
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
        let bodyStrfy = JSON.stringify(bodyObj, null, 2);

        if (bodyObj.length == 0) {
            extensionGlobals.flagVariationEditor.setValue("No Feature Flags detected.");
            extensionGlobals.flagVariationEditor.getSession().selection.clearSelection();
            return;
        }
        extensionGlobals.flagVariationEditor.setValue(bodyStrfy);
        extensionGlobals.flagVariationEditor.getSession().selection.clearSelection();

        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert("======== RECEIVE EVENT START ========\n");
        extensionGlobals.logEditor.insert(`${request.request.method} url[${request.request.url}]`);
        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert(bodyStrfy);
        extensionGlobals.logEditor.insert("\n");
        extensionGlobals.logEditor.insert("======== RECEIVE EVENT END   ========\n");
        extensionGlobals.logEditor.getSession().selection.clearSelection();
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
    extensionGlobals.logEditor.insert(JSON.stringify(events, null, 2));
    extensionGlobals.logEditor.insert("\n");
    extensionGlobals.logEditor.insert("======== SENT EVENT END   ========\n");
    extensionGlobals.logEditor.getSession().selection.clearSelection();
    
    let eventTypeCounts= countEventTypes(events);
    updateTypeCounters(eventTypeCounts);
}

function updateTypeCounters( eventTypeCounts ){
    Object.keys(eventTypeCounts).forEach( key=>{
        let eleId= `${key}-value`;
        let ele = window.document.querySelector(`#${eleId}`);
        if (!ele){
            log(`updateTypeCounters(): eleId=${eleId} NOT FOUND!`);
            return;
        }
        ele.textContent= parseInt(ele.textContent) + eventTypeCounts[key];
    })
}

function updateExperimentsCounter(count){
    let ele = window.document.querySelector("#experiments-value");
    ele.textContent= parseInt(ele.textContent) + count;
}

function countEventTypes( events ){
    
    return events.reduce ( (acc, curr)=>{
        let {custom, click, identify, feature} = acc;
        let {kind} = curr;
        switch (kind){
            case 'identify': identify++; break;
            case 'custom': custom++; break;
            case 'click': click++; break;
            case 'feature': feature++; break;
        }
        return {identify, custom, click, feature};
    }, {custom:0, click:0, identify:0, feature:0});
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
        let bodyStrfy = JSON.stringify(bodyObj, null, 2);

        if (bodyObj.length == 0) {
            extensionGlobals.flagGoalsEditor.setValue("No Goals detected.");
            extensionGlobals.flagGoalsEditor.getSession().selection.clearSelection();

            extensionGlobals.experimentsEditor.setValue("No metric matching URL and Target Selector");
            extensionGlobals.experimentsEditor.getSession().selection.clearSelection();

            return;
        }
        extensionGlobals.flagGoalsEditor.setValue(bodyStrfy);
        extensionGlobals.flagGoalsEditor.getSession().selection.clearSelection();

        Promise.allSettled([    evalInspectPage('window.location.href'),
                        evalInspectPage('window.location.search'),
                        evalInspectPage('window.location.hash')])
        .then( (results)=>{
            let [winHref, winSearch, winHash] = results;
            processGoals(bodyObj, winHref.value[0], winSearch.value[0], winHash.value[0]);
            
        })
    });
   
}

function initializeAceEditor({
    containerId,
    foldCssSelector,
    unfoldCssSelector
}, theme) {

    let aceEditor = ace.edit(containerId);
    aceEditor.getSession().setMode("ace/mode/json");
    aceEditor.getSession().setUseWrapMode(true);
    aceEditor.getSession().setUseWorker(false);
    aceEditor.setReadOnly(true);
    if (theme) {
        aceEditor.setTheme(theme);
    }

    let foldEle = window.document.querySelector(foldCssSelector);
    let unfoldEle = window.document.querySelector(unfoldCssSelector);

    if (!foldEle.onclick) {
        foldEle.onclick = function () {

            aceEditor.getSession().foldAll();
        }
    }
    if (!unfoldEle.onclick) {
        unfoldEle.onclick = function () {
            aceEditor.getSession().unfold();
        }
    }
    return aceEditor
}





function setExperimentsContainer(kv) {
    if (!kv || kv && kv.length == 0) {
        extensionGlobals.experimentsEditor.setValue("No metric matching URL and Target Selector");
        extensionGlobals.experimentsEditor.getSession().selection.clearSelection();

        return;
    }


    extensionGlobals.experimentsEditor.insert("+---------------+--------------------------+------+--------+\n");
    extensionGlobals.experimentsEditor.insert("|      Goal     |   Goal Key               |  URL | Target |\n");
    extensionGlobals.experimentsEditor.insert("+===============+==========================+======+========+\n");

    (kv || []).forEach(metric => {
        let {
            kind,
            key,
            urlMatch,
            targetMatch
        } = metric;


        extensionGlobals.experimentsEditor.insert(`|${kind.padEnd(15)}|${key.padEnd(26)}|${urlMatch.toString().padEnd(6)}|${targetMatch.toString().padEnd(8)}|\n`)
        extensionGlobals.experimentsEditor.insert("+---------------+--------------------------+------+--------+\n");
    })


    extensionGlobals.experimentsEditor.getSession().selection.clearSelection();
}

function processGoals(goals, locationHref, search, hash) {

    let goalsFiltered = goals.filter(({
        urls
    }) => {
        let matchedUrl = urls.filter(url => doesUrlMatch(url, locationHref, search, hash));
        return (matchedUrl && matchedUrl.length > 0);
    })
    // log(`goalsfiltered=${JSON.stringify(goalsFiltered)}`);
    if(goalsFiltered.length==0){
        setExperimentsContainer([]);
        return;
    }
    let tasks = [];
    let taskKeys=[];
    let taskKinds=[];
    let taskSelectors=[];
    goalsFiltered.forEach( ({kind, key, selector}) =>{
        let code=`window.document.querySelector("${selector}")`;
        taskKinds.push(kind);
        taskKeys.push(key);
        taskSelectors.push(selector);
        tasks.push( evalInspectPage (code));

    })
    Promise.allSettled(tasks)
    .then(results=>{
        
        let matchedList = [];
        results.forEach ((result, idx)=>
        {
            let entry={
                kind: taskKinds[idx],
                key: taskKeys[idx],
                selector: taskSelectors[idx],
                urlMatch: true,
                targetMatch: (result.value[0] && result.value[0] != null)?true:false
            };
            entry.targetMatch = (entry.kind === 'pageview')?"N/A": entry.targetMatch;
            matchedList.push(entry);
            // logJSON(JSON.stringify(entry,null,2));
        });
        setExperimentsContainer(matchedList);
        let enabledExperiments = matchedList.filter( ({urlMatch, targetMatch})=> (urlMatch==true && (targetMatch == true || targetMatch == "N/A")));
        updateExperimentsCounter(enabledExperiments.length);

    });
}


function logInspectedWindow(msg){
     chrome.devtools.inspectedWindow.eval(
        `console.log('${msg}');`
    )
}

function evalInspectPage( code ){
    return new Promise (resolve=>{
        chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, {code}, function(result){
            // log("executeScript: Result Start----");
            // log(JSON.stringify(code,null,2));
            // log (JSON.stringify(result));
            // log("executeScript: Result End----")

            resolve(result);
            
        });
    })
}

function logJSON(jsonObj){

    let code={
        code:`console.log(${jsonObj})`
    };
//     chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, code, function(result){
//         log(`log: result=${result}`)
//     });
    chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, code);
}

function log(msg){

    let code={
        code:`console.log('${msg}')`
    };
//     chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, code, function(result){
//         log(`log: result=${result}`)
//     });
    chrome.tabs.executeScript(chrome.devtools.inspectedWindow.tabId, code);
}

function hideToggle(){

    let container = this.event.target.parentElement.querySelector(':scope  div.container');
    if (!container.offsetParent){
        container.style="display:block";
    }else{
        container.style="display:none";
    }
    

}
