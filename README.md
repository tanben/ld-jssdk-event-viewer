# LaunchDarkly Javascript SDK Event Viewer

The LaunchDarkly JavaScript SDK Event Viewer is a Chrome extension designed to capture, display, and validate various events and data related to the LaunchDarkly JavaScript Client SDK. This tool is particularly useful for developers and QA teams who want to monitor and debug their LaunchDarkly implementations.

### Features
1. Capture the following events
    *  flag evaluations
    *  identity events
    *  custom events
    *  click and pageview events
    *  stream updates
 2. Display and validate Conversion Metrics
    *  show conversion metrics that matches URL and element on the page using the CSS selector specified
3.  Log payload/details of the following SENT and RECEIVED events:
    *  flag evaluations
    *  identity events
    *  custom events
    *  click and pageview events
    *  stream updates
4. Display Feature flags loaded by the JS client SDK.

## Installation
1. Clone this repository to your local machine:
```
git clone https://github.com/tanben/ld-jssdk-event-viewer.git

```

2. Open Google Chrome and navigate to chrome://extensions/.
3. Enable "Developer mode" using the toggle in the top right corner.
4. Click on "Load unpacked" and select the directory where you cloned the repository.
5. The LaunchDarkly JavaScript SDK Event Viewer extension should now be loaded and visible in your Chrome extensions list.

 
## Usage

1. Navigate to the web page where you want to monitor LaunchDarkly events.
2. Open the Chrome Developer Tools (right-click anywhere on the page, select "Inspect" or use the keyboard shortcut `Ctrl+Shift+I` on Windows/Linux or `Cmd+Option+I` on Mac).
3. Select the **"Launchpad"** tab in the Developer Tools.
4. Reload your web page to start capturing events.
5. Interact with your web page as needed, and the Launchpad tab will display the captured events, Conversion Metrics, Feature Flags, and other relevant data.


![img](img/screen2.jpg)
*View Experimentation metrics and events*

![img](img/screen3.jpg)
*View feature flags, context and SDK events*