# Design Auditor (Chromium-based browser Extension)

Design Auditor is a extension for auditing UI/UX Designs on live pages. It adds an in-page panel that lets you inspect element styles, find semantic token usage, compare Light vs Dark deltas across two synced tabs, and export audit reports.
<img width="925" height="565" alt="image" src="https://github.com/user-attachments/assets/0ba607d4-b761-457c-8163-63aae8f91731" />

## What It Does

- Opens an in-page auditor panel from the extension popup.
- Tracks the currently hovered element and shows grouped CSS properties.
- Supports Light/Dark theme switching for audit validation.
- Provides a Token Finder to locate CSS token usage on the current page.
- Syncs two highlighted tabs for side-by-side Light vs Dark review.
- Mirrors scroll and element highlighting between synced tabs.
- Detects CSS property differences and marks mismatched elements.
- Exports reports in Excel-compatible `.xls` format:
  - Selection-based CSS audit export with Area/Subarea classification.
  - Delta export for Light vs Dark differences.
- Loads taxonomy/configuration from CSV files so mappings can be updated without JS code changes.

## Project Structure

- `manifest.json` - Extension manifest (MV3).
- `background.js` - Service worker for tab-sync orchestration and relay messaging.
- `popup.html` - Popup shell.
- `popup.js` - Opens/ensures the in-page panel on the active tab.
- `content/content.js` - Main auditor logic, UI, extraction, syncing, exports.
- `content/content.css` - Panel and highlight styling.
- `content/classification-map.csv` - Area/Subarea classification rules.
- `content/css-property-config.csv` - CSS property categories and auditor visibility.

## Permissions

Defined in `manifest.json`:

- `tabs` - read active/highlighted tabs for sync flow.
- `scripting` - extension scripting support.
- `debugger` - reserved for advanced scenarios (not currently required by core flow).
- `host_permissions: <all_urls>` - run content script on all pages.

## Installation (Load Unpacked in Edge)

1. Open Edge and navigate to `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:
   - `wpcoreux-edge-extension`
5. Pin the extension if you want quick access from the toolbar.

## How To Use

1. Open any supported webpage.
2. Click the extension icon.
3. The popup triggers the in-page panel (`WP DESIGN AUDITOR`).
4. Hover elements to inspect styles in the **AUDITOR** tab.
5. Use **TOKEN FINDER** to search CSS token usage.
6. For Light vs Dark delta checks:
   - Open two tabs/pages you want to compare.
   - Ctrl+click both tabs in the same Edge window.
   - Click **Sync** in the panel.
   - Scroll/highlight in one tab to mirror in the other.

## Key Interactions

- `Shift` (hold): freezes hover-driven element switching.
- `Shift + Alt`: adds the current hovered element to export selection list (in Download CSV workflow).
- DOM navigation buttons in panel:
  - `-` parent
  - `+` first child
  - `←` previous sibling
  - `→` next sibling

## View Modes

Current view options in panel:

- `Per Element` - regular inspection and token workflows.
- `Desktop SBS: Light vs Dark (Only delta)` - synced-tab delta-focused comparison.

Notes:

- Mobile mode UI is present but currently disabled in the extension.

## CSV-Driven Configuration

### 1) Classification Map

`content/classification-map.csv` provides classification logic used during exports.

- Rules map nodes to:
  - `Area`
  - `SubArea`
- If rule-based matching cannot classify an element, heuristic fallback is used.

### 2) CSS Property Config

`content/css-property-config.csv` controls:

- `category` grouping (Typography, Colors, Shapes, etc.)
- `property` names included in audit
- `hiddenInAuditor` visibility flags

If this file cannot be loaded or parsed, the extension falls back to built-in defaults.

## Export Outputs

### Selection Export

Triggered from the CSV selection workflow in the panel.

- Produces Excel-compatible `.xls` with:
  - Area/Subarea sheets
  - Property rows per element/state (rest, hover, pressed, focused, disabled when available)
  - Light/Dark token/value columns
  - Basic summary metrics in panel (tokenized vs hardcoded)

### Delta Export

Triggered in synced Light vs Dark delta mode.

- Produces `.xls` with differing properties:
  - Element
  - Selector
  - Property
  - Light token/value
  - Dark token/value

## Known Constraints

- Extension relies on content scripts, so restricted browser pages (for example internal Edge pages) may not be scriptable.
- Theme switching behavior includes Microsoft/Bing URL parameter handling and CSS fallback for other sites.
- Because this runs on live pages, dynamic/virtualized DOM can affect selector stability.

## Development Notes

- Manifest version: `3`
- Main runtime pieces:
  - Background service worker (`background.js`)
  - Content script panel/runtime (`content/content.js`)
- No build step required for local usage; edit files and reload extension from `edge://extensions`.

## Troubleshooting

- Panel does not open:
  - Refresh the page and click extension icon again.
  - Ensure the page is not a restricted internal browser URL.
- Sync says to select exactly 2 tabs:
  - In the same Edge window, Ctrl+click exactly two tabs, then retry.
- CSV/config changes not reflected:
  - Reload extension from `edge://extensions` and refresh target tabs.

## Version

Current manifest version: `1.0`.
