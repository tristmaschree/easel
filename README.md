# Easel

A Chrome extension that makes Canvas (`*.instructure.com`) faster and nicer to use. Canvas support. Literally.

## Features

| Feature | What it does |
| --- | --- |
| **Snappy mode** | Collapses Canvas/InstUI animations and transitions so trays and menus open instantly. |
| **Preload on hover** | Prerenders course sections, dashboard, calendar, grades and inbox when you hover a link, so the click feels instant. Individual assignments, pages, discussions, module items, LTI tools and downloads are never preloaded as Canvas would count that as a view. |
| **Tree sidebar** | Canvas's icon strip and the per-course menu merged into one wide, VS Code-style sidebar: Courses and Groups are folders, each course expands to its sections. The arrow at the bottom collapses it back to the icon strip. |
| **Courses in sidebar** | Dashboard courses, in their colors, always visible in the left nav with a count of items due in the next 48h. Cached, so it shows immediately. |
| **Due panel** | A "Due" nav item listing everything due across all courses — overdue, today, tomorrow, next 7 days, later — with countdowns, status chips and mark-as-done (syncs with Canvas's planner). |
| **Command palette** | <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> to fuzzy-jump to any course, section, assignment, page, module item, file or upcoming due item. |
| **Dashboard card extras** | Current grade and next due item on each course card. |

Each feature can be toggled from the toolbar popup.

> Built and tested on Yale's Canvas (`yale.instructure.com`) as a student. It should work on other `*.instructure.com` schools, but layouts and course-code formats vary. If something looks off, switch that feature off in the popup.

## Install in Chrome (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Reload any open Canvas tabs.

After editing code, click the reload icon on the extension's card, then reload Canvas.

## Install in Safari (macOS, iPhone, iPad)

The Xcode project in `safari/` wraps the same extension files, so there is nothing separate to keep in sync.

1. Open `safari/Easel/Easel.xcodeproj` in Xcode.
2. Pick the **Easel (macOS)** scheme and press Run. To sign it, choose your team under Signing & Capabilities.
3. Unsigned local build only: in Safari, open Settings → Advanced, turn on **Show features for web developers**, then go to Settings → Developer and turn on **Allow unsigned extensions**. You have to do this again each time Safari restarts.
4. Turn on Easel in Safari Settings → Extensions, then allow it on `instructure.com` (click Easel's toolbar icon on a Canvas page and choose **Always Allow on This Website**).

For iPhone or iPad, run the **Easel (iOS)** scheme on a device or simulator. Then turn it on under Settings → Apps → Safari → Extensions.

The project references `src/`, `popup/` and `icons/` as folders, so new files inside them are included automatically. If you add a new top-level file or folder, add it to the extension target's Copy Bundle Resources in Xcode.

## Layout

```
manifest.json
src/boot.js            document_start: applies snappy mode without a flash
src/core/              settings, API client, SWR cache, shared data, nav helpers
src/features/          one file per feature
src/styles/            snappy.css (animations), polish.css (Canvas restyling),
                       tree.css (tree sidebar layout), content.css (injected UI)
popup/                 settings popup
dev/                   mock Canvas harness (python3 dev/serve.py → /dev/harness.html)
```

Data comes from the Canvas REST API using your existing session, cached in `chrome.storage.local` and refreshed in the background (stale-while-revalidate).
