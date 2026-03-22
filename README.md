# LaunchDarkly JavaScript SDK Event Viewer

A Chrome DevTools extension and **bookmarklet** for monitoring and debugging
LaunchDarkly JavaScript SDK activity in real time. Inspect flag evaluations,
context payloads, streaming connections, conversion metrics, and every event
the SDK sends or receives.

## Status

**Maintenance mode.** This fork extends the
[upstream project](https://github.com/tanben/ld-jssdk-event-viewer) with a
fully working bookmarklet implementation served from GitHub Pages. The upstream
repository remains the canonical source for the Chrome extension; periodic
syncs will pull in any upstream improvements.

> Contributions that improve the bookmarklet or keep the fork in sync with
> upstream are welcome. New standalone features should generally be proposed
> upstream first.

## What this fork adds

- **Bookmarklet loader** (`bookmarklet/`) &mdash; intercepts LD SDK traffic via
  monkey-patched `fetch`, `XMLHttpRequest`, and `EventSource`; renders the same
  panel UI as an isolated Shadow DOM overlay on any page.
- **GitHub Pages site** (`docs/`) &mdash; landing page, interactive demo, and
  hosted bookmarklet assets at
  <https://flowgrammer-ld.github.io/ld-jssdk-event-viewer/>.
- **Build script** (`build.sh`) &mdash; copies source into `docs/dist/v1/` for
  distribution.

## Quick start

### Bookmarklet (any browser)

Drag the **Launch Event Viewer** button from the
[landing page](https://flowgrammer-ld.github.io/ld-jssdk-event-viewer/) to
your bookmarks bar, then click it on any page running the LD JS SDK.

### Chrome extension

1. Clone this repository.
2. Open `chrome://extensions/`, enable **Developer mode**.
3. Click **Load unpacked** and select the repo root.
4. Open DevTools on any page &rarr; select the **LaunchPad** tab.

## Features

- Flag evaluations with values, variations, and evaluation reasons
- Full context/user payload inspection
- Filterable event timeline (custom, identify, click, pageview, summary)
- Conversion metric validation (URL and CSS selector matching)
- Real-time SSE stream monitoring
- HAR timing breakdown for SDK requests
- Export all captured data as JSON

## Development

```bash
npm run dev      # build + serve docs on localhost:8080
npm run build    # copy source to docs/dist/v1/
npm run serve    # serve docs/ with CORS headers
```

## Syncing with upstream

```bash
git fetch upstream
git merge upstream/main
# Resolve any conflicts, rebuild, and push.
```

## License

See [LICENSE](LICENSE).
