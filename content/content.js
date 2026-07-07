console.log("LDC content script loaded");

// ------------------------------
// Message listener (toggle panel)
// ------------------------------
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "togglePanel") {
        togglePanelVisibility();
        return;
    }

    if (msg.type === "ensurePanelOpen") {
        const panel = getOrCreateDeltaPanel();
        panelVisible = true;
        panel.style.display = "block";
        return;
    }

    if (msg.type === "ldcSyncActivated") {
        syncedPeerTabId = typeof msg.peerTabId === "number" ? msg.peerTabId : null;
        isSyncMirroringActive = true;
        deltaDiffPropsBySelector.clear();
        deltaDiffRowsBySelector.clear();
        peerSnapshotBySelector.clear();
        clearDeltaHighlights();
        updateSyncStatus("Tabs synced. Scroll and highlighting are now mirrored.");
        updateSyncButtonState();
        applyViewMode(getOrCreateDeltaPanel());
        return;
    }

    if (msg.type === "ldcSyncStopped") {
        syncedPeerTabId = null;
        isSyncMirroringActive = false;
        deltaDiffPropsBySelector.clear();
        deltaDiffRowsBySelector.clear();
        peerSnapshotBySelector.clear();
        clearDeltaHighlights();
        updateSyncStatus("Sync stopped. Click Sync Tabs to start again.");
        updateSyncButtonState();
        applyViewMode(getOrCreateDeltaPanel());
        return;
    }

    if (msg.type === "ldcApplySyncEvent") {
        if (msg.eventType === "deltaDiff") {
            const selector = msg.payload?.selector;
            if (!selector) return;
            const diffRows = Array.isArray(msg.payload?.diffRows) ? msg.payload.diffRows : [];
            setDeltaDiffData(selector, diffRows);
            if (msg.payload?.peerStyles && typeof msg.payload.peerStyles === "object") {
                peerSnapshotBySelector.set(selector, msg.payload.peerStyles);
            }
            setDeltaHighlightForSelector(selector, Boolean(msg.payload?.isDifferent));
            if (currentSelector === selector && isDeltaOnlyView() && isSyncMirroringActive) {
                updateAuditorPanel();
            }
            return;
        }

        if (msg.eventType === "scroll") {
            const x = Number(msg.payload?.x) || 0;
            const y = Number(msg.payload?.y) || 0;

            isApplyingSyncedScroll = true;
            window.scrollTo({ left: x, top: y, behavior: "auto" });
            requestAnimationFrame(() => {
                isApplyingSyncedScroll = false;
            });
            return;
        }

        if (msg.eventType === "highlight") {
            const selector = msg.payload?.selector;
            if (!selector) return;

            let target = null;
            try {
                target = document.querySelector(selector);
            } catch {
                target = null;
            }
            if (!target) return;

            isApplyingSyncedHighlight = true;
            selectElement(target, { sendSync: false });
            requestAnimationFrame(() => {
                isApplyingSyncedHighlight = false;
            });

            if (isDeltaOnlyView() && isSyncMirroringActive) {
                const sourceStyles = msg.payload?.sourceStyles || {};
                if (sourceStyles && typeof sourceStyles === "object") {
                    peerSnapshotBySelector.set(selector, sourceStyles);
                }
                const localStyles = getDeltaComparableSnapshot(target);
                const diffRows = getDifferingProperties(sourceStyles, localStyles, selector, target);
                const isDifferent = diffRows.length > 0;

                setDeltaDiffData(selector, diffRows);
                setDeltaHighlightForSelector(selector, isDifferent);
                sendSyncEvent("deltaDiff", { selector, isDifferent, diffRows, peerStyles: localStyles });
            }
        }
    }
});

// ------------------------------
// Device definitions
// ------------------------------
const LDC_DEVICES = {
    iphone15: { width: 393, height: 852, scale: 1 },
    pixel8:   { width: 412, height: 915, scale: 1 },
    galaxyS24:{ width: 412, height: 915, scale: 1 },
    ipadMini: { width: 768, height: 1024, scale: 1 }
};

// ------------------------------
// Apply simulated mobile viewport
// ------------------------------
function applyDeviceViewport() {
    const mode = localStorage.getItem("ldc-mode") || "desktop";
    if (mode === "mobile") {
        // Mobile mode is no longer supported in the panel UI.
        localStorage.setItem("ldc-mode", "desktop");
    }
    return;

    const device = localStorage.getItem("ldc-device") || "iphone15";
    const def = LDC_DEVICES[device];
    if (!def) return;

    const { width, scale } = def;

    let meta = document.querySelector("meta[name=viewport]");
    if (!meta) {
        meta = document.createElement("meta");
        meta.name = "viewport";
        document.head.appendChild(meta);
    }
    meta.content = `width=${width}, initial-scale=${scale}`;

    const style = document.createElement("style");
    style.id = "ldc-device-style";
    style.textContent = `
        html {
            width: ${width}px !important;
            margin: 0 auto !important;
        }
    `;
    document.documentElement.appendChild(style);
}

applyDeviceViewport();

// ------------------------------
// Hybrid Light/Dark Mode
// ------------------------------
let hoverFrozen = false;
let shiftAltSelectionCaptured = false;
document.addEventListener("keydown", (e) => {
    if (e.key === "Shift") {
        hoverFrozen = true;
    }

    if (!isDownloadCsvView()) return;
    if (!e.shiftKey || !e.altKey) return;
    if (shiftAltSelectionCaptured) return;

    addCurrentElementToCsvSelection();
    shiftAltSelectionCaptured = true;
});

document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
        hoverFrozen = false;
    }

    if (e.key === "Shift" || e.key === "Alt") {
        shiftAltSelectionCaptured = false;
    }
});

function applyHybridTheme() {
    const theme = localStorage.getItem("ldc-theme") || "light";
    const url = new URL(window.location.href);

    const isMicrosoftSite =
        url.hostname.includes("bing.com") ||
        url.hostname.includes("microsoft.com") ||
        url.hostname.includes("msn.com");

    if (isMicrosoftSite) {
        if (theme === "dark") {
            url.searchParams.set("webthemedark", "1");
            url.searchParams.delete("lightschemeovr");
        } else {
            url.searchParams.set("lightschemeovr", "1");
            url.searchParams.delete("webthemedark");
        }

        if (url.toString() !== window.location.href) {
            window.location.replace(url.toString());
        }
        return;
    }

    // Fallback: force prefers-color-scheme
    const old = document.getElementById("ldc-forced-color-scheme");
    if (old) old.remove();

    const style = document.createElement("style");
    style.id = "ldc-forced-color-scheme";
    style.textContent = `
        :root {
            color-scheme: ${theme} !important;
        }
    `;
    document.documentElement.appendChild(style);
}

applyHybridTheme();

// ------------------------------
// State
// ------------------------------
let currentSelector = null;
let currentCSS = null;
let panelVisible = false;
let activeTokenMatches = [];
let activeTokenSelection = null;
let syncedPeerTabId = null;
let isSyncMirroringActive = false;
let isApplyingSyncedScroll = false;
let isApplyingSyncedHighlight = false;
let scrollSyncRaf = null;
let isCsvSelectionBodyActive = false;
const deltaDiffPropsBySelector = new Map();
const deltaDiffRowsBySelector = new Map();
const peerSnapshotBySelector = new Map();
const csvSelectedElements = [];
let lastSelectionExportSummary = null;
let isSelectionSummaryCollapsed = false;
const EXPORT_YIELD_EVERY_NODES = 25;
const CLASSIFICATION_MAP_PATH = "content/classification-map.csv";
const CSS_PROPERTY_CONFIG_PATH = "content/css-property-config.csv";
const CLASSIFICATION_STOP_WORDS = new Set([
    "a", "an", "the", "to", "of", "for", "with", "by", "and", "or",
    "b", "id", "class", "container", "card", "cards", "item", "link", "title", "header",
    "content", "main", "root", "list", "grid", "ans", "algo", "news", "video", "image", "map", "local"
]);
let classificationRules = [];
let classificationRulesLoadAttempted = false;
let classificationRulesLoaded = false;
let cssPropertyConfigLoadAttempted = false;
let cssPropertyConfigLoaded = false;

const DEFAULT_CSS_CATEGORIES = {
    "Typography": [
        "font", "font-weight", "text-decoration", "font-family", "font-size", "line-height",
        "text-overflow", "white-space", "word-break", "overflow-wrap",
        "text-align", "letter-spacing", "text-transform",
        "text-decoration-color", "text-decoration-thickness", "text-decoration-offset",
        "direction", "unicode-bidi", "text-wrap", "vertical-align",
        "font-style", "word-spacing"
    ],
    "Foreground Colors": ["color"],
    "Background Colors": ["background-color", "fill"],
    "Shapes": ["border-radius", "corner-shape", "border"],
    "Shadows": ["box-shadow", "text-shadow", "filter"],
    "Density": [
        "padding", "margin", "gap", "row-gap", "column-gap",
        "width", "max-width", "min-width",
        "height", "max-height", "min-height",
        "inline-size", "block-size",
        "grid-template-columns", "grid-template-rows", "grid-template-areas",
        "flex-basis", "flex-grow", "flex-shrink",
        "scroll-padding", "scroll-margin",
        "column-count", "column-gap"
    ],
    "Animation": [
        "animation", "transition", "transition-property", "transition-duration", "transform",
        "backdrop-filter"
    ],
    "Interaction": [
        "pointer-events",
        "user-select", "touch-action", "scroll-behavior",
        "scroll-snap-type", "scroll-snap-align", "accent-color",
        "overscroll-behavior",
        "cursor"
    ]
};
const DEFAULT_HIDDEN_AUDITOR_CATEGORIES = new Set(["Interaction"]);
const DEFAULT_HIDDEN_AUDITOR_PROPERTIES = new Set();

function cloneCssCategories(source) {
    const cloned = {};
    Object.entries(source || {}).forEach(([category, props]) => {
        cloned[category] = Array.from(new Set((props || []).map(prop => String(prop || "").trim()).filter(Boolean)));
    });
    return cloned;
}

let CSS_CATEGORIES = cloneCssCategories(DEFAULT_CSS_CATEGORIES);
let HIDDEN_AUDITOR_CATEGORIES = new Set(Array.from(DEFAULT_HIDDEN_AUDITOR_CATEGORIES));
let HIDDEN_AUDITOR_PROPERTIES = new Set(Array.from(DEFAULT_HIDDEN_AUDITOR_PROPERTIES));

function getCategoryPropertyKey(category, property) {
    return `${String(category || "").trim().toLowerCase()}::${String(property || "").trim().toLowerCase()}`;
}

function isAuditorPropertyHidden(category, property) {
    if (HIDDEN_AUDITOR_CATEGORIES.has(category)) return true;
    return HIDDEN_AUDITOR_PROPERTIES.has(getCategoryPropertyKey(category, property));
}

function tokenizeClassificationText(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return [];

    const clean = text
        .replace(/\"/g, "")
        .replace(/[\[\](){}]/g, " ")
        .replace(/[^a-z0-9_#\-.]+/g, " ");

    const tokens = clean
        .split(/\s+/)
        .map(part => part.replace(/^[#.]+/, "").trim())
        .filter(Boolean)
        .filter(part => part.length >= 3)
        .filter(part => !CLASSIFICATION_STOP_WORDS.has(part));

    return Array.from(new Set(tokens));
}

function parseCsvLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === "," && !inQuotes) {
            values.push(current);
            current = "";
            continue;
        }

        current += ch;
    }

    values.push(current);
    return values.map(v => v.trim());
}

function parseClassificationMap(csvText) {
    const lines = String(csvText || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length <= 1) return [];

    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
    const areaIndex = header.indexOf("area");
    const subAreaIndex = header.indexOf("subarea");
    const selectorIndex = header.indexOf("selector");
    const descriptionIndex = header.indexOf("description");
    const priorityIndex = header.indexOf("priority");
    const scopeSelectorIndex = header.indexOf("scopeselector");
    const nodeSelectorIndex = header.indexOf("nodeselector");
    const labelIncludesIndex = header.indexOf("labelincludes");
    const hintsIncludesIndex = header.indexOf("hintsincludes");

    const hasPrioritySchema = areaIndex >= 0
        && subAreaIndex >= 0
        && priorityIndex >= 0
        && scopeSelectorIndex >= 0
        && nodeSelectorIndex >= 0
        && labelIncludesIndex >= 0
        && hintsIncludesIndex >= 0;

    const hasLegacySelectorSchema = areaIndex >= 0
        && subAreaIndex >= 0
        && selectorIndex >= 0;

    if (!hasPrioritySchema && !hasLegacySelectorSchema) return [];

    const parsedRules = [];

    for (let i = 1; i < lines.length; i += 1) {
        const row = parseCsvLine(lines[i]);
        const area = row[areaIndex] || "";
        const subArea = row[subAreaIndex] || "";
        if (!area || !subArea) continue;

        if (hasPrioritySchema) {
            const rawPriority = row[priorityIndex] || "";
            const priority = Number(rawPriority);
            const scopeSelector = row[scopeSelectorIndex] || "*";
            const nodeSelector = row[nodeSelectorIndex] || "*";
            const labelIncludes = row[labelIncludesIndex] || "";
            const hintsIncludes = row[hintsIncludesIndex] || "";

            parsedRules.push({
                matchType: "priority",
                area,
                subArea,
                priority: Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER,
                hasExplicitPriority: Number.isFinite(priority),
                scopeSelector,
                nodeSelector,
                labelIncludes,
                hintsIncludes,
                csvOrder: i
            });
            continue;
        }

        const selector = row[selectorIndex] || "";
        const description = descriptionIndex >= 0 ? (row[descriptionIndex] || "") : "";
        if (!selector) continue;

        const selectorTokens = tokenizeClassificationText(selector);
        if (selectorTokens.length === 0) continue;

        parsedRules.push({
            matchType: "selector",
            area,
            subArea,
            selector,
            description,
            selectorTokens,
            priority: Number.MAX_SAFE_INTEGER,
            hasExplicitPriority: false,
            csvOrder: i
        });
    }

    parsedRules.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;

        const aTokenCount = Array.isArray(a.selectorTokens) ? a.selectorTokens.length : 0;
        const bTokenCount = Array.isArray(b.selectorTokens) ? b.selectorTokens.length : 0;
        if (bTokenCount !== aTokenCount) return bTokenCount - aTokenCount;

        return a.csvOrder - b.csvOrder;
    });

    return parsedRules;
}

function parseCssPropertyConfig(csvText) {
    const lines = String(csvText || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length <= 1) return null;

    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
    const categoryIndex = header.indexOf("category");
    const propertyIndex = header.indexOf("property");
    const hiddenIndex = header.indexOf("hiddeninauditor");

    if (categoryIndex < 0 || propertyIndex < 0) return null;

    const categories = {};
    const hiddenCategories = new Set();
    const hiddenProperties = new Set();

    for (let i = 1; i < lines.length; i += 1) {
        const row = parseCsvLine(lines[i]);
        const category = String(row[categoryIndex] || "").trim();
        const property = String(row[propertyIndex] || "").trim();
        if (!category || !property) continue;

        if (!categories[category]) categories[category] = [];
        if (!categories[category].includes(property)) categories[category].push(property);

        if (hiddenIndex >= 0) {
            const hiddenValue = String(row[hiddenIndex] || "").trim().toLowerCase();
            if (["1", "true", "yes", "y"].includes(hiddenValue)) {
                if (property === "*" || property === "(all)") {
                    hiddenCategories.add(category);
                } else {
                    hiddenProperties.add(getCategoryPropertyKey(category, property));
                }
            }
        }
    }

    if (Object.keys(categories).length === 0) return null;

    return {
        categories,
        hiddenCategories,
        hiddenProperties
    };
}

function parseIncludesExpression(expression) {
    const text = String(expression || "").trim().toLowerCase();
    if (!text || text === "*") return [];

    return text
        .split("|")
        .map(orGroup => orGroup.trim())
        .filter(Boolean)
        .map(orGroup => orGroup
            .split("&")
            .map(term => term.trim())
            .filter(Boolean)
        )
        .filter(group => group.length > 0);
}

function matchesIncludesExpressionByText(expression, haystackText) {
    const groups = parseIncludesExpression(expression);
    if (groups.length === 0) return true;

    const text = String(haystackText || "").toLowerCase();
    if (!text) return false;
    return groups.some(group => group.every(term => text.includes(term)));
}

function matchesIncludesExpressionByTokens(expression, tokenWeights) {
    const groups = parseIncludesExpression(expression);
    if (groups.length === 0) return true;

    const hasToken = (term) => {
        if (!term) return false;
        if (tokenWeights.has(term)) return true;
        for (const token of tokenWeights.keys()) {
            if (token.includes(term) || term.includes(token)) return true;
        }
        return false;
    };

    return groups.some(group => group.every(hasToken));
}

function selectorMatchesElement(el, selector, allowClosest) {
    const normalized = String(selector || "").trim();
    if (!normalized || normalized === "*") return true;

    try {
        return allowClosest ? Boolean(el.closest(normalized)) : el.matches(normalized);
    } catch {
        // Non-CSS fragments are handled as taxonomy tokens.
        const hintText = getElementAndAncestorHints(el);
        const tokens = tokenizeClassificationText(normalized);
        if (tokens.length === 0) return false;
        return tokens.every(token => hintText.includes(token));
    }
}

function buildWeightedHintTokenMap(el) {
    const weighted = new Map();
    if (!el) return weighted;

    let node = el;
    let depth = 0;
    while (node && depth < 8) {
        const fragment = [
            node.tagName?.toLowerCase() || "",
            node.id || "",
            typeof node.className === "string" ? node.className : "",
            node.getAttribute?.("role") || "",
            node.getAttribute?.("aria-label") || "",
            node.getAttribute?.("data-testid") || "",
            node.getAttribute?.("data-module") || ""
        ].join(" ");

        const depthWeight = Math.max(1, 10 - depth);
        tokenizeClassificationText(fragment).forEach(token => {
            const score = depthWeight * Math.max(3, token.length);
            const prev = weighted.get(token) || 0;
            if (score > prev) weighted.set(token, score);
        });

        node = node.parentElement;
        depth += 1;
    }

    tokenizeClassificationText(getUniqueSelector(el) || "").forEach(token => {
        const score = 12 * Math.max(3, token.length);
        const prev = weighted.get(token) || 0;
        if (score > prev) weighted.set(token, score);
    });

    tokenizeClassificationText(getElementLabel(el) || "").forEach(token => {
        const score = 8 * Math.max(3, token.length);
        const prev = weighted.get(token) || 0;
        if (score > prev) weighted.set(token, score);
    });

    return weighted;
}

function getRuleSpecificityScore(rule, tokenWeights) {
    const tokens = rule.matchType === "selector"
        ? (rule.selectorTokens || [])
        : tokenizeClassificationText(rule.hintsIncludes || "");

    if (tokens.length === 0) return 0;
    return tokens.reduce((sum, token) => sum + (tokenWeights.get(token) || token.length), 0);
}

function evaluateSelectorRuleMatch(rule, tokenWeights) {
    const tokens = rule.selectorTokens || [];
    if (tokens.length === 0) return null;

    const matches = tokens.every(token => tokenWeights.has(token));
    if (!matches) return null;

    return {
        rule,
        score: getRuleSpecificityScore(rule, tokenWeights)
    };
}

function evaluatePriorityRuleMatch(rule, el, tokenWeights, labelText) {
    const scopeMatches = selectorMatchesElement(el, rule.scopeSelector, true);
    if (!scopeMatches) return null;

    const nodeMatches = selectorMatchesElement(el, rule.nodeSelector, false);
    if (!nodeMatches) return null;

    if (!matchesIncludesExpressionByText(rule.labelIncludes, labelText)) return null;
    if (!matchesIncludesExpressionByTokens(rule.hintsIncludes, tokenWeights)) return null;

    return {
        rule,
        score: getRuleSpecificityScore(rule, tokenWeights)
    };
}

async function loadClassificationRules() {
    if (classificationRulesLoadAttempted) return;
    classificationRulesLoadAttempted = true;

    try {
        const url = chrome.runtime.getURL(CLASSIFICATION_MAP_PATH);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load classification map: ${response.status}`);
        }

        const csvText = await response.text();
        const parsedRules = parseClassificationMap(csvText);
        classificationRules = parsedRules;
        classificationRulesLoaded = parsedRules.length > 0;

        if (classificationRulesLoaded) {
            console.log(`LDC classification map loaded (${parsedRules.length} rules)`);
        }
    } catch (error) {
        classificationRules = [];
        classificationRulesLoaded = false;
        console.warn("LDC classification map unavailable; using heuristic fallback.", error);
    }
}

async function loadCssPropertyConfig() {
    if (cssPropertyConfigLoadAttempted) return;
    cssPropertyConfigLoadAttempted = true;

    try {
        const url = chrome.runtime.getURL(CSS_PROPERTY_CONFIG_PATH);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load css property config: ${response.status}`);
        }

        const csvText = await response.text();
        const parsed = parseCssPropertyConfig(csvText);
        if (!parsed) {
            throw new Error("CSS property config is empty or has an invalid schema.");
        }

        CSS_CATEGORIES = cloneCssCategories(parsed.categories);
        HIDDEN_AUDITOR_CATEGORIES = new Set(Array.from(parsed.hiddenCategories || []));
        HIDDEN_AUDITOR_PROPERTIES = new Set(Array.from(parsed.hiddenProperties || []));
        cssPropertyConfigLoaded = true;
        console.log(`LDC css property config loaded (${Object.keys(CSS_CATEGORIES).length} categories)`);
    } catch (error) {
        CSS_CATEGORIES = cloneCssCategories(DEFAULT_CSS_CATEGORIES);
        HIDDEN_AUDITOR_CATEGORIES = new Set(Array.from(DEFAULT_HIDDEN_AUDITOR_CATEGORIES));
        HIDDEN_AUDITOR_PROPERTIES = new Set(Array.from(DEFAULT_HIDDEN_AUDITOR_PROPERTIES));
        cssPropertyConfigLoaded = false;
        console.warn("LDC css property config unavailable; using built-in defaults.", error);
    }
}

function getRuleBasedClassification(el) {
    if (!el || !classificationRulesLoaded || classificationRules.length === 0) return null;

    const tokenWeights = buildWeightedHintTokenMap(el);
    if (tokenWeights.size === 0) return null;

    const labelText = (getElementLabel(el) || "").toLowerCase();
    let bestMatch = null;

    for (const rule of classificationRules) {
        const evaluated = rule.matchType === "priority"
            ? evaluatePriorityRuleMatch(rule, el, tokenWeights, labelText)
            : evaluateSelectorRuleMatch(rule, tokenWeights);

        if (!evaluated) continue;

        if (!bestMatch) {
            bestMatch = evaluated;
            continue;
        }

        const next = evaluated;
        const prev = bestMatch;

        // Prefer the most specific rule first; priority only breaks ties.
        if (next.score > prev.score) {
            bestMatch = next;
            continue;
        }

        if (next.score < prev.score) {
            continue;
        }

        if (next.rule.priority < prev.rule.priority) {
            bestMatch = next;
            continue;
        }

        if (next.rule.priority > prev.rule.priority) {
            continue;
        }

        if (next.rule.csvOrder < prev.rule.csvOrder) {
            bestMatch = next;
        }
    }

    return bestMatch?.rule
        ? { area: bestMatch.rule.area, subArea: bestMatch.rule.subArea }
        : null;
}

loadClassificationRules();
loadCssPropertyConfig();

function setDeltaDiffData(selector, diffRows) {
    if (!selector) return;
    if (!Array.isArray(diffRows)) {
        deltaDiffPropsBySelector.delete(selector);
        deltaDiffRowsBySelector.delete(selector);
        updateDeltaExportButtonState();
        return;
    }

    const normalizedRows = diffRows
        .filter(row => row && row.property)
        .map(row => ({ ...row, selector: row.selector || selector }));

    deltaDiffRowsBySelector.set(selector, normalizedRows);
    deltaDiffPropsBySelector.set(selector, normalizedRows.map(row => row.property));
    updateDeltaExportButtonState();
}

function updateSyncStatus(message) {
    document.querySelectorAll(".ldc-sync-tabs-status").forEach(node => {
        node.textContent = message;
    });
}

function updateSyncButtonState() {
    const syncButton = document.querySelector("#ldc-sync-button");
    if (!syncButton) return;
    
    const viewSelector = document.querySelector("#ldc-view-selector");
    const currentMode = viewSelector?.value || "per-element";
    const isSyncMode = currentMode === "desktop-sbs" || currentMode === "desktop-sbs-delta";
    
    syncButton.disabled = !isSyncMode;
}

function sendSyncEvent(eventType, payload) {
    if (syncedPeerTabId === null) return;
    chrome.runtime.sendMessage({
        type: "ldcSyncEvent",
        eventType,
        payload
    });
}

function getCurrentViewMode() {
    const raw = localStorage.getItem("ldc-view-mode") || "per-element";
    if (raw === "mobile-sbs") return "desktop-sbs-delta";
    if (raw === "desktop-sbs") return "desktop-sbs-delta";
    if (["per-element", "desktop-sbs-delta"].includes(raw)) return raw;
    return "per-element";
}

function canUseCsvSelectionBody(viewMode = getCurrentViewMode()) {
    return viewMode === "per-element" || viewMode === "desktop-sbs-delta";
}

function isSbsModeView() {
    const viewMode = getCurrentViewMode();
    return viewMode === "desktop-sbs" || viewMode === "desktop-sbs-delta";
}

function isDeltaOnlyView() {
    return getCurrentViewMode() === "desktop-sbs-delta";
}

function isDownloadCsvView() {
    return canUseCsvSelectionBody() && isCsvSelectionBodyActive;
}

function isPerElementView() {
    return !isSbsModeView() || isSyncMirroringActive;
}

function refreshAuditorBody() {
    const panel = document.getElementById("ldc-delta-panel");
    if (!panel) return;

    if (isDownloadCsvView()) {
        renderDownloadCsvPanel();
        return;
    }

    updateAuditorPanel();
}

function getTrackedComputedSnapshot(el) {
    if (!el) return {};

    const snapshot = {};
    const computed = window.getComputedStyle(el);

    for (const category in CSS_CATEGORIES) {
        CSS_CATEGORIES[category].forEach(prop => {
            let value = "";
            try {
                value = computed.getPropertyValue(prop).trim();
            } catch {
                value = "";
            }
            snapshot[prop] = value;
        });
    }

    return snapshot;
}

function getEffectiveTheme() {
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("webthemedark") === "1") return "dark";
        if (url.searchParams.get("lightschemeovr") === "1") return "light";
    } catch {}

    try {
        const colorScheme = window.getComputedStyle(document.documentElement).colorScheme || "";
        if (colorScheme.includes("dark")) return "dark";
        if (colorScheme.includes("light")) return "light";
    } catch {}

    const forcedSchemeText = document.getElementById("ldc-forced-color-scheme")?.textContent || "";
    if (forcedSchemeText.includes("dark")) return "dark";
    if (forcedSchemeText.includes("light")) return "light";

    return localStorage.getItem("ldc-theme") === "dark" ? "dark" : "light";
}

function sanitizeFilenamePart(value, fallback = "Value") {
    const text = String(value == null ? "" : value)
        .trim()
        .replace(/[<>:"/\\|?*]+/g, " ")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
    return text || fallback;
}

function getPageSearchQuery() {
    try {
        const url = new URL(window.location.href);
        const candidateKeys = ["q", "query", "p", "search", "text", "term", "keyword", "wd"];
        for (const key of candidateKeys) {
            const value = url.searchParams.get(key);
            if (normalizeStyleValue(value)) return value;
        }
    } catch {}

    const title = String(document.title || "").split(/[-|:]/)[0].trim();
    return title || "SearchQuery";
}

function buildExportFilename(extension = "xls", options = {}) {
    const modePart = (localStorage.getItem("ldc-mode") || "desktop") === "mobile" ? "Mobile" : "Desktop";
    const themePart = isSbsModeView()
        ? "LightDark"
        : (getEffectiveTheme() === "dark" ? "Dark" : "Light");
    const areaPart = sanitizeFilenamePart(options?.area || "Area", "Area");
    const timestampPart = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const safeExtension = String(extension || "xls").replace(/^\.+/, "") || "xls";
    return `${modePart}_${themePart}_${areaPart}_${timestampPart}.${safeExtension}`;
}

function normalizeStyleValue(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeStyleMap(styleMap) {
    const normalized = {};
    Object.entries(styleMap || {}).forEach(([key, value]) => {
        normalized[key] = normalizeStyleValue(value);
    });
    return normalized;
}

function getDeltaComparableSnapshot(el) {
    const extracted = extractCSS(el);
    return {
        theme: getEffectiveTheme(),
        authored: normalizeStyleMap(extracted?.authored),
        computed: normalizeStyleMap(extracted?.computed)
    };
}

function getTrimmedText(value, maxLength = 60) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getElementKind(el) {
    if (!el || !el.tagName) return "element";

    const tagName = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const hints = `${el.id || ""} ${el.className || ""} ${role}`.toLowerCase();
    const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();

    if (/subtitle|subheading/.test(hints)) return "subtitle";
    if (/headline|heading|title/.test(hints) || /^h[1-6]$/.test(tagName) || role === "heading") return "heading";
    if (role === "searchbox" || type === "search" || placeholder.includes("search") || ariaLabel.includes("search")) return "search box";
    if (tagName === "button" || role === "button") return "button";
    if (tagName === "a" || role === "link") return "link";
    if (tagName === "select") return "dropdown";
    if (tagName === "textarea") return "text area";
    if (tagName === "input") return type ? `${type} input` : "input";
    if (tagName === "img" || role === "img") return "image";
    if (/caption|eyebrow|label|badge|chip/.test(hints)) return "label";
    if (/icon/.test(hints) || tagName === "svg") return "icon";

    return tagName;
}

function getElementLabel(el) {
    if (!el) return "";

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
        const labelText = labelledBy
            .split(/\s+/)
            .map(id => document.getElementById(id))
            .map(node => getTrimmedText(node?.textContent, 80))
            .filter(Boolean)
            .join(" ");
        if (labelText) return labelText;
    }

    const candidates = [
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("title"),
        el.getAttribute("alt"),
        el.getAttribute("value"),
        el.innerText,
        el.textContent
    ];

    for (const candidate of candidates) {
        const text = getTrimmedText(candidate, 80);
        if (text) return text;
    }

    return "";
}

function getElementDescription(el) {
    if (!el || !el.tagName) return "element";

    const kind = getElementKind(el);
    const label = getElementLabel(el);
    return label ? `${kind} \"${label}\"` : kind;
}

function getElementAndAncestorHints(el) {
    if (!el) return "";

    const chunks = [];
    let node = el;
    let depth = 0;
    while (node && depth < 7) {
        chunks.push(
            node.tagName?.toLowerCase() || "",
            node.id || "",
            typeof node.className === "string" ? node.className : "",
            node.getAttribute?.("role") || "",
            node.getAttribute?.("aria-label") || "",
            node.getAttribute?.("data-testid") || "",
            node.getAttribute?.("data-module") || ""
        );
        node = node.parentElement;
        depth += 1;
    }

    return chunks.join(" ").toLowerCase();
}

function getHeuristicClassifiedAreaAndSubarea(el) {
    const hints = getElementAndAncestorHints(el);
    const label = getElementLabel(el).toLowerCase();
    const tag = el?.tagName?.toLowerCase() || "";
    const role = (el?.getAttribute?.("role") || "").toLowerCase();

    const hasAny = (text, words) => words.some(word => text.includes(word));

    const isFooter = el?.closest?.("footer, #b_footer, .b_footer, [role='contentinfo']") || hasAny(hints, [" footer ", "b_footer", "contentinfo"]);
    if (isFooter) {
        if (hasAny(label, ["terms", "privacy"])) {
            return { area: "Footer", subArea: "Terms and Privacy links" };
        }
        return { area: "Footer", subArea: "Footer links" };
    }

    const isScopeListItem = el?.matches?.("#b-scopeListItem") || el?.closest?.("#b-scopeListItem");
    if (isScopeListItem) {
        return { area: "Scope", subArea: "Scope tabs" };
    }

    const isPagination = el?.closest?.("#b_paging, .b_pag, .sb_pag, nav[aria-label*='pagination' i], [role='navigation'][aria-label*='pagination' i]")
        || hasAny(hints, ["paging", "pagination", "b_paging", "sb_pag"]);
    if (isPagination) {
        const selected = el?.getAttribute?.("aria-current") || el?.getAttribute?.("aria-selected");
        if (selected) return { area: "Pagination", subArea: "Selected numbered button" };
        return { area: "Pagination", subArea: "Numbered buttons" };
    }

    const isRelated = el?.closest?.("#b_rs, .b_rs, .related, [aria-label*='related' i]")
        || hasAny(hints, ["related", "b_rs", "bop"]);
    if (isRelated) {
        if (tag === "h1" || tag === "h2" || tag === "h3" || role === "heading") {
            return { area: "BOP Related Search", subArea: "Title" };
        }
        if (tag === "a" || tag === "button") {
            return { area: "BOP Related Search", subArea: "Pills" };
        }
        return { area: "BOP Related Search", subArea: "Related search content" };
    }

    const isHeader = el?.closest?.("header, #b_header, .b_header, [role='banner']")
        || hasAny(hints, ["b_header", "role banner", " header "]);
    if (isHeader) {
        if (hasAny(hints + " " + label, ["logo", "brand"])) {
            return { area: "Header", subArea: "Logo" };
        }
        const isSearch = role === "searchbox"
            || tag === "input"
            || hasAny(hints + " " + label, ["search", "magnifier", "mic", "camera", "icon"]);
        if (isSearch) {
            return { area: "Header", subArea: "Searchbox with icons" };
        }
        if (hasAny(hints + " " + label, ["profile", "account", "reward", "rewards", "ms rewards", "signin", "avatar"])) {
            return { area: "Header", subArea: "RightIcons (Profile/MSRewards)" };
        }
        return { area: "Header", subArea: "Header controls" };
    }

    const isScope = el?.closest?.("#b_scopebar, .b_scopebar, nav[role='navigation'], .scope, [aria-label*='scope' i]")
        || hasAny(hints, ["scope", "b_scopebar"]);
    if (isScope) {
        const scopeTabs = ["all", "search", "images", "videos", "maps", "news", "shopping", "copilot", "more"];
        const matchedScope = scopeTabs.find(tab => label === tab || label.includes(`${tab} `) || label.includes(` ${tab}`) || label.includes(tab));
        return {
            area: "Scope",
            subArea: matchedScope ? `Tab: ${matchedScope.charAt(0).toUpperCase()}${matchedScope.slice(1)}` : "Scope tabs"
        };
    }

    const isTween = el?.closest?.("#b_tween, .b_tween, .tween") || hasAny(hints, ["b_tween", "tween"]);
    if (isTween) {
        if (hasAny(hints + " " + label, ["result", "results", "count", "about"])) {
            return { area: "Tween", subArea: "Search results count" };
        }
        if (hasAny(hints, ["icon", "siteicon", "favicon"])) {
            return { area: "Tween", subArea: "Site icons" };
        }
        return { area: "Tween", subArea: "Tween content" };
    }

    const isWpTabs = el?.closest?.("#wptabs, .wptabs, .wp-tabs, .pivot, [data-module*='tabs' i]")
        || hasAny(hints, ["wptabs", "wp-tabs", "pivot", "tabs"]);
    if (isWpTabs) {
        if (tag === "h1" || tag === "h2" || role === "heading") return { area: "WPTabs", subArea: "Title" };
        if (hasAny(hints + " " + label, ["subtitle", "subheading"])) return { area: "WPTabs", subArea: "Subtitle" };
        if (tag === "button" || tag === "a" || role === "tab") return { area: "WPTabs", subArea: "Button tabs" };
        return { area: "WPTabs", subArea: "WPTabs content" };
    }

    const isMagazine = el?.closest?.(".magazine, #magazine, .card-grid, .b_rich, .rich-card")
        || hasAny(hints, ["magazine", "card-grid", "card", "collage", "carousel"]);
    if (isMagazine) {
        if (hasAny(hints + " " + label, ["map", "maps"])) return { area: "Magazine", subArea: "Maps card" };
        if (hasAny(hints + " " + label, ["local", "nearby", "places"])) return { area: "Magazine", subArea: "Local card" };
        if (hasAny(hints + " " + label, ["image", "collage", "gallery"])) return { area: "Magazine", subArea: "Image collage card" };
        if (hasAny(hints + " " + label, ["video", "play"])) return { area: "Magazine", subArea: "Video card" };
        if (hasAny(hints + " " + label, ["fact", "did you know"])) return { area: "Magazine", subArea: "Fact card" };
        if (hasAny(hints, ["subdiv", "split", "two-column"])) return { area: "Magazine", subArea: "Subdivided card" };
        if (hasAny(hints + " " + label, ["text", "article"])) return { area: "Magazine", subArea: "Text card" };
        return { area: "Magazine", subArea: "Card grid" };
    }

    const isAlgo = el?.closest?.("#b_results, .b_results, .b_algo, main")
        || hasAny(hints, ["b_algo", "results", "search result", "algo"]);
    if (isAlgo) {
        if (hasAny(hints, ["favicon", "siteicon"])) return { area: "Algo", subArea: "Favicon" };
        if (hasAny(hints + " " + label, ["sitename", "site name", "source"])) return { area: "Algo", subArea: "SiteName" };
        if (tag === "cite" || hasAny(hints, ["url", "cite"])) return { area: "Algo", subArea: "URL" };
        if ((tag === "h2" || role === "heading") && (el?.closest?.(".b_algo, #b_results") || hasAny(hints, ["b_algo"]))) {
            return { area: "Algo", subArea: "Site Title" };
        }
        if (hasAny(hints + " " + label, ["caption", "snippet", "summary"])) return { area: "Algo", subArea: "Caption" };
        if (hasAny(hints + " " + label, ["image", "images", "attachment", "thumbnail"])) return { area: "Algo", subArea: "Attachments" };
        if (hasAny(hints + " " + label, ["video", "news", "shopping", "people also ask", "paa"])) {
            return { area: "Algo", subArea: "Specialized answer" };
        }
        return { area: "Algo", subArea: "Search result content" };
    }

    return { area: "Algo", subArea: "Search result content" };
}

function getClassifiedAreaAndSubarea(el) {
    if (!classificationRulesLoadAttempted) {
        loadClassificationRules();
    }

    const ruleBased = getRuleBasedClassification(el);
    if (ruleBased) return ruleBased;

    return getHeuristicClassifiedAreaAndSubarea(el);
}

function findNearestAncestorClassification(el, nodeClassificationMap) {
    if (!el || !nodeClassificationMap) return null;

    let node = el.parentElement;
    while (node) {
        const existing = nodeClassificationMap.get(node);
        if (existing && existing.area && existing.subArea) {
            return existing;
        }
        node = node.parentElement;
    }

    return null;
}

function isGenericClassification(classification) {
    if (!classification) return true;

    const area = String(classification.area || "");
    const subArea = String(classification.subArea || "");
    return area === "Algo" && subArea === "Search result content";
}

function isGenericSubAreaLabel(subArea) {
    const text = String(subArea || "").trim().toLowerCase();
    if (!text) return true;

    const genericLabels = new Set([
        "container",
        "content",
        "result",
        "results",
        "card",
        "card-cell",
        "card grid",
        "grid",
        "item",
        "tabs",
        "scope tabs",
        "header controls",
        "search result content"
    ]);

    if (genericLabels.has(text)) return true;
    if (text.startsWith("tab:")) return true;
    if (text.endsWith(" content")) return true;
    return false;
}

function stabilizeClassificationWithAncestor(classification, ancestorClassification) {
    if (!ancestorClassification) return classification;
    if (!classification) return ancestorClassification;

    if (isGenericClassification(classification)
        && ancestorClassification.area
        && ancestorClassification.subArea) {
        return {
            area: ancestorClassification.area,
            subArea: ancestorClassification.subArea
        };
    }

    const sameArea = String(classification.area || "") === String(ancestorClassification.area || "");
    if (sameArea
        && isGenericSubAreaLabel(classification.subArea)
        && !isGenericSubAreaLabel(ancestorClassification.subArea)) {
        return {
            area: classification.area,
            subArea: ancestorClassification.subArea
        };
    }

    return classification;
}

function buildCsvRowFromSelection(item) {
    if (!item) {
        return {
            area: "",
            subArea: "",
            element: "",
            selector: ""
        };
    }

    return {
        area: item.area || "",
        subArea: item.subArea || "",
        element: item.description || item.tagName || "",
        selector: item.selector || ""
    };
}

function isVisualElementForCsv(el) {
    if (!el || isExtensionPanelElement(el)) return false;

    const tagName = (el.tagName || "").toLowerCase();
    if (["script", "style", "link", "meta", "noscript", "template"].includes(tagName)) {
        return false;
    }

    let style;
    try {
        style = window.getComputedStyle(el);
    } catch {
        return false;
    }

    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity || "1") === 0) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    return true;
}

function getVisualElementsForCsv(root) {
    if (!root || isExtensionPanelElement(root)) return [];

    const nodes = [];
    if (isVisualElementForCsv(root)) {
        nodes.push(root);
    }

    root.querySelectorAll("*").forEach(child => {
        if (isVisualElementForCsv(child)) {
            nodes.push(child);
        }
    });

    return nodes;
}

function getCsvRowsFromSelectedElements() {
    const rows = [];
    const seen = new Set();

    csvSelectedElements.forEach(item => {
        let roots = [];
        try {
            roots = Array.from(document.querySelectorAll(item.selector));
        } catch {
            roots = [];
        }

        if (roots.length === 0) {
            const fallbackKey = `${item.area || ""}|${item.subArea || ""}|${item.description || item.tagName || ""}|${item.selector || ""}`;
            if (!seen.has(fallbackKey)) {
                seen.add(fallbackKey);
                rows.push(buildCsvRowFromSelection(item));
            }
            return;
        }

        roots.forEach(root => {
            const visualNodes = getVisualElementsForCsv(root);
            const classifiedNodes = new WeakMap();

            visualNodes.forEach(node => {
                const rawClassification = getClassifiedAreaAndSubarea(node);
                const ancestorClassification = findNearestAncestorClassification(node, classifiedNodes);
                const classification = stabilizeClassificationWithAncestor(rawClassification, ancestorClassification);

                classifiedNodes.set(node, classification);

                const selector = getUniqueSelector(node) || item.selector || "";
                const element = getElementDescription(node) || node.tagName?.toLowerCase() || "element";
                const key = `${classification.area}|${classification.subArea}|${element}|${selector}`;
                if (seen.has(key)) return;
                seen.add(key);
                rows.push({
                    area: classification.area,
                    subArea: classification.subArea,
                    element,
                    selector
                });
            });
        });
    });

    return rows;
}

function getPropertyCategory(prop) {
    for (const category in CSS_CATEGORIES) {
        if (HIDDEN_AUDITOR_CATEGORIES.has(category)) continue;
        if (isAuditorPropertyHidden(category, prop)) continue;
        if (CSS_CATEGORIES[category].includes(prop)) return category;
    }
    return "Other";
}

function resolveCssValueChainForExport(el, value, interactionState = "rest", depth = 0, chain = [], seenTokens = new Set()) {
    const normalized = normalizeStyleValue(value);
    if (!normalized || depth > 10) return chain;

    chain.push(normalized);

    const match = normalized.match(/var\(\s*(--[^,\s)]+)\s*(?:,\s*([^)]*))?\)/);
    if (!match) return chain;

    const token = match[1];
    const fallback = normalizeStyleValue(match[2] || "");

    if (seenTokens.has(token)) return chain;
    seenTokens.add(token);

    const authoredTokenValue = findAuthoredCSS(el, token, { state: interactionState });
    let nextValue = normalizeStyleValue(authoredTokenValue);

    if (!nextValue) {
        try {
            nextValue = normalizeStyleValue(getComputedStyle(el).getPropertyValue(token));
        } catch {
            nextValue = "";
        }
    }

    if (!nextValue) {
        nextValue = fallback;
    }

    if (!nextValue) return chain;
    return resolveCssValueChainForExport(el, nextValue, interactionState, depth + 1, chain, seenTokens);
}

function getTerminalValueFromChainForExport(chain, fallbackValue = "") {
    const terminal = normalizeStyleValue(chain?.[chain.length - 1] || "");
    return terminal || normalizeStyleValue(fallbackValue);
}

function getLmColumnsFromChain(chain, fallbackValue = "") {
    const normalizedChain = (Array.isArray(chain) ? chain : [])
        .map(item => normalizeStyleValue(item))
        .filter(Boolean);

    if (normalizedChain.length === 0) {
        const fallback = normalizeStyleValue(fallbackValue);
        return {
            token: "",
            value1: fallback,
            value2: ""
        };
    }

    const first = normalizedChain[0];
    const hasVarToken = /var\(\s*--/i.test(first);
    if (!hasVarToken) {
        return {
            token: "",
            value1: first,
            value2: normalizedChain.length > 1 ? normalizedChain[1] : ""
        };
    }

    const value1 = normalizedChain[1] || "";
    let value2 = "";
    if (normalizedChain.length >= 3) {
        value2 = normalizedChain.length === 3
            ? normalizedChain[2]
            : normalizedChain[normalizedChain.length - 1];
    }

    return {
        token: first,
        value1,
        value2
    };
}

function getColumnsFromSnapshotProperty(snapshot, prop) {
    const authored = normalizeStyleValue(snapshot?.authored?.[prop] || "");
    const computed = normalizeStyleValue(snapshot?.computed?.[prop] || "");
    const source = authored || computed;

    if (!source) {
        return { token: "", value1: "", value2: "" };
    }

    const hasVarToken = /var\(\s*--/i.test(source);
    if (!hasVarToken) {
        return { token: "", value1: source, value2: "" };
    }

    return {
        token: source,
        value1: computed || "",
        value2: ""
    };
}

function getLightDarkColumns(localColumns, prop, selector, options = {}) {
    const currentTheme = getEffectiveTheme();
    const peerSnapshot = options.peerSnapshot || peerSnapshotBySelector.get(selector);
    const peerColumnsCache = options.peerColumnsCache instanceof Map ? options.peerColumnsCache : null;

    let peerColumns = null;
    if (peerColumnsCache && peerColumnsCache.has(prop)) {
        peerColumns = peerColumnsCache.get(prop);
    } else {
        peerColumns = getColumnsFromSnapshotProperty(peerSnapshot, prop);
        if (peerColumnsCache) {
            peerColumnsCache.set(prop, peerColumns);
        }
    }

    const lightColumns = currentTheme === "light" ? localColumns : peerColumns;
    const darkColumns = currentTheme === "dark" ? localColumns : peerColumns;

    const convertValue2ToHex = (val) => {
        if (!val) return val;
        const hex = rgbToHex(val);
        return hex || val;
    };

    return {
        lmCssToken: lightColumns?.token || "",
        lmCssValue1: lightColumns?.value1 || "",
        lmCssValue2: convertValue2ToHex(lightColumns?.value2 || ""),
        dmCssToken: darkColumns?.token || "",
        dmCssValue1: darkColumns?.value1 || "",
        dmCssValue2: convertValue2ToHex(darkColumns?.value2 || "")
    };
}

function buildPropertyExportRowsForNode(node, classification, selector, elementLabel) {
    const rows = [];
    if (!node) return rows;

    const nodeCss = extractCSS(node);
    const computedCss = nodeCss?.computed || {};
    const authoredCss = nodeCss?.authored || {};
    const computedKeys = new Set(Object.keys(computedCss));
    const interactionStateKeys = ["hover", "active", "focus", "disabled"];
    const peerSnapshot = peerSnapshotBySelector.get(selector);
    const peerColumnsCache = new Map();
    let transitionComponentsCache = null;
    let transitionDisplayCache = "";

    for (const category in CSS_CATEGORIES) {
        if (HIDDEN_AUDITOR_CATEGORIES.has(category)) continue;

        const props = (CSS_CATEGORIES[category] || []).filter(prop => !isAuditorPropertyHidden(category, prop));
        if (props.length === 0) continue;
        const presentProps = props.filter(p => {
            if (!computedKeys.has(p)) return false;
            const authoredValue = authoredCss[p];
            const computedValue = computedCss[p];
            if (p === "fill" && !isFillApplicableForElement(node, authoredValue, computedValue)) {
                return false;
            }
            return true;
        });

        const meaningfulProps = presentProps.filter(p => {
            const computedValue = computedCss[p];
            const authoredValue = authoredCss[p];
            return hasMeaningfulValue(computedValue) || hasMeaningfulValue(authoredValue);
        });

        let finalProps = category === "Animation" ? meaningfulProps : presentProps;

        if (category === "Shadows") {
            finalProps = meaningfulProps;
        }

        if (category === "Animation") {
            const animationName = normalizeStyleValue(authoredCss["animation"] || computedCss["animation"] || "").toLowerCase();
            const animationDuration = normalizeStyleValue(authoredCss["animation-duration"] || computedCss["animation-duration"] || "");
            const transitionDuration = normalizeStyleValue(authoredCss["transition-duration"] || computedCss["transition-duration"] || "");

            const shouldIncludeAnimation = animationName && animationName !== "none" && !isZeroDurationValue(animationDuration);
            const shouldIncludeTransition = !isZeroDurationValue(transitionDuration);

            if (!shouldIncludeAnimation) {
                finalProps = finalProps.filter(prop => !prop.startsWith("animation"));
            }
            if (!shouldIncludeTransition) {
                finalProps = finalProps.filter(prop => !prop.startsWith("transition"));
            }
        }

        if (category === "Density") {
            finalProps = finalProps.filter(p => p === "gap" || p === "padding" || p === "margin");
        }

        if (category === "Typography") {
            const hasFontProp = finalProps.includes("font");
            if (hasFontProp) {
                const fontAuthored = authoredCss["font"];
                const fontComputed = computedCss["font"];
                const fontSource = normalizeStyleValue(fontAuthored || fontComputed || "");
                const fontChain = resolveCssValueChainForExport(node, fontSource, "rest");
                const fontLmColumns = getLmColumnsFromChain(fontChain, fontSource);

                if (fontLmColumns.token) {
                    finalProps = ["font"];
                }
            }
        }

        if (finalProps.length === 0) continue;

        for (const prop of finalProps) {
            const authored = authoredCss[prop];
            const computed = computedCss[prop];
            const authoredRaw = normalizeStyleValue(authored || "");
            const computedRaw = normalizeStyleValue(computed || "");

            if (prop === "text-decoration" && computedRaw.toLowerCase() === "none") {
                continue;
            }

            const isTransitionProperty = prop === "transition" || prop.startsWith("transition-");

            if (isTransitionProperty && !transitionComponentsCache) {
                transitionComponentsCache = resolveTransitionComponentsFromCascade(node, "rest");
                transitionDisplayCache = buildTransitionDisplayFromComponents(transitionComponentsCache);
            }

            const strictStateAuthoredValues = Object.fromEntries(
                interactionStateKeys.map(stateKey => [
                    stateKey,
                    prop === "transition"
                        ? resolveAuthoredTransitionValue(node, stateKey)
                        : findAuthoredCSS(node, prop, { state: stateKey, strictState: true })
                ])
            );

            let restAuthored = authored || findAuthoredCSS(node, prop, { state: "rest" }) || "";

            if (prop === "transition-property" && transitionComponentsCache?.["transition-property"]) {
                restAuthored = transitionComponentsCache["transition-property"];
            }
            if (prop === "transition-duration" && transitionComponentsCache?.["transition-duration"]) {
                restAuthored = transitionComponentsCache["transition-duration"];
            }
            if (prop === "transition-timing-function" && transitionComponentsCache?.["transition-timing-function"]) {
                restAuthored = transitionComponentsCache["transition-timing-function"];
            }
            if (prop === "transition-delay" && transitionComponentsCache?.["transition-delay"]) {
                restAuthored = transitionComponentsCache["transition-delay"];
            }

            if (prop === "transition") {
                if (transitionDisplayCache) {
                    restAuthored = transitionDisplayCache;
                }
            }

            if (prop === "background-color" && !authoredRaw && isTransparentColorValue(computedRaw)) {
                restAuthored = "transparent";
            }

            const hasStrictInteractionState = Object.values(strictStateAuthoredValues).some(value => normalizeStyleValue(value));
            if (!normalizeStyleValue(restAuthored) && hasStrictInteractionState) {
                const defaultRestValue = getDefaultAuditValue(prop);
                if (defaultRestValue) {
                    restAuthored = defaultRestValue;
                }
            }

            const restSourceValue = normalizeStyleValue(restAuthored || computed || "");
            const restChain = resolveCssValueChainForExport(node, restSourceValue, "rest");
            const restTerminal = getTerminalValueFromChainForExport(restChain, computed || restAuthored);
            const restLmColumns = getLmColumnsFromChain(restChain, isTransitionProperty ? restSourceValue : restTerminal);
            const restThemeColumns = getLightDarkColumns(restLmColumns, prop, selector, {
                peerSnapshot,
                peerColumnsCache
            });

            rows.push({
                area: classification.area || "",
                subArea: classification.subArea || "",
                element: elementLabel || "",
                selector: selector || "",
                propertyType: category || getPropertyCategory(prop),
                property: prop,
                state: "rest",
                lmCssToken: restThemeColumns.lmCssToken,
                lmCssValue1: restThemeColumns.lmCssValue1,
                lmCssValue2: restThemeColumns.lmCssValue2,
                dmCssToken: restThemeColumns.dmCssToken,
                dmCssValue1: restThemeColumns.dmCssValue1,
                dmCssValue2: restThemeColumns.dmCssValue2
            });

            const seenStateVariantValues = new Set();
            interactionStateKeys.forEach(stateKey => {
                const stateAuthored = strictStateAuthoredValues[stateKey];
                if (!stateAuthored) return;

                const stateChain = isTransitionProperty ? [] : resolveCssValueChainForExport(node, stateAuthored, stateKey);
                const stateResolvedValue = isTransitionProperty
                    ? normalizeStyleValue(stateAuthored)
                    : getTerminalValueFromChainForExport(stateChain, stateAuthored);
                const normalizedStateSource = normalizeStyleValue(stateAuthored);
                const normalizedStateChain = isTransitionProperty
                    ? [normalizedStateSource]
                    : stateChain;
                const stateLmColumns = getLmColumnsFromChain(normalizedStateChain, stateResolvedValue);
                const stateThemeColumns = getLightDarkColumns(stateLmColumns, prop, selector, {
                    peerSnapshot,
                    peerColumnsCache
                });
                const comparable = `${stateLmColumns.token}|${stateLmColumns.value1}|${stateLmColumns.value2}`;
                if (!comparable) return;
                if (seenStateVariantValues.has(comparable)) return;

                seenStateVariantValues.add(comparable);

                rows.push({
                    area: classification.area || "",
                    subArea: classification.subArea || "",
                    element: elementLabel || "",
                    selector: selector || "",
                    propertyType: category || getPropertyCategory(prop),
                    property: prop,
                    state: getInteractionStateDisplayName(stateKey),
                    lmCssToken: stateThemeColumns.lmCssToken,
                    lmCssValue1: stateThemeColumns.lmCssValue1,
                    lmCssValue2: stateThemeColumns.lmCssValue2,
                    dmCssToken: stateThemeColumns.dmCssToken,
                    dmCssValue1: stateThemeColumns.dmCssValue1,
                    dmCssValue2: stateThemeColumns.dmCssValue2
                });
            });
        }
    }

    return rows;
}

async function getPropertyExportRowsFromSelectedElements() {
    const rows = [];
    const processedNodes = new WeakSet();
    let processedNodeCount = 0;

    for (const item of csvSelectedElements) {
        let roots = [];
        try {
            roots = Array.from(document.querySelectorAll(item.selector));
        } catch {
            roots = [];
        }

        if (roots.length === 0) continue;

        for (const root of roots) {
            const visualNodes = getVisualElementsForCsv(root);
            const classifiedNodes = new WeakMap();

            for (const node of visualNodes) {
                if (processedNodes.has(node)) continue;
                processedNodes.add(node);

                const rawClassification = getClassifiedAreaAndSubarea(node);
                const ancestorClassification = findNearestAncestorClassification(node, classifiedNodes);
                const classification = stabilizeClassificationWithAncestor(rawClassification, ancestorClassification);
                classifiedNodes.set(node, classification);

                const selector = getUniqueSelector(node) || item.selector || "";
                const element = getElementDescription(node) || node.tagName?.toLowerCase() || "element";
                const propertyRows = buildPropertyExportRowsForNode(node, classification, selector, element);
                rows.push(...propertyRows);

                processedNodeCount += 1;
                if (processedNodeCount % EXPORT_YIELD_EVERY_NODES === 0) {
                    await yieldToMainThread();
                }
            }
        }
    }

    return rows;
}

function buildMetricSummaryRow(label, rows) {
    const total = (rows || []).length;
    const tokenized = (rows || []).filter(row => Boolean(normalizeStyleValue(row?.lmCssToken || ""))).length;
    const hardcoded = total - tokenized;
    const pct = (part) => total ? `${((part / total) * 100).toFixed(1)}%` : "0.0%";
    return {
        label,
        total,
        tokenized,
        tokenizedPct: pct(tokenized),
        hardcoded,
        hardcodedPct: pct(hardcoded)
    };
}

function buildSelectionExportSummary(selectedRows) {
    const rows = Array.isArray(selectedRows) ? selectedRows : [];

    const areaMap = new Map();
    rows.forEach(row => {
        const areaName = normalizeStyleValue(row.area) || "Unclassifed";
        if (!areaMap.has(areaName)) areaMap.set(areaName, []);
        areaMap.get(areaName).push(row);
    });
    const areaRows = Array.from(areaMap.keys())
        .sort((a, b) => a.localeCompare(b))
        .map(name => buildMetricSummaryRow(name, areaMap.get(name)));

    const propertyTypeMap = new Map();
    rows.forEach(row => {
        const typeName = normalizeStyleValue(row.propertyType) || "Other";
        if (!propertyTypeMap.has(typeName)) propertyTypeMap.set(typeName, []);
        propertyTypeMap.get(typeName).push(row);
    });
    const propertyTypeRows = Array.from(propertyTypeMap.keys())
        .sort((a, b) => a.localeCompare(b))
        .map(name => buildMetricSummaryRow(name, propertyTypeMap.get(name)));

    const byPropertyType = Array.from(propertyTypeMap.keys())
        .sort((a, b) => a.localeCompare(b))
        .map(typeName => {
            const forType = propertyTypeMap.get(typeName) || [];
            const byProperty = new Map();
            forType.forEach(row => {
                const propName = normalizeStyleValue(row.property) || "(unknown)";
                if (!byProperty.has(propName)) byProperty.set(propName, []);
                byProperty.get(propName).push(row);
            });

            const propertyRows = Array.from(byProperty.keys())
                .sort((a, b) => a.localeCompare(b))
                .map(propName => buildMetricSummaryRow(propName, byProperty.get(propName)));

            return {
                typeName,
                rows: propertyRows,
                total: buildMetricSummaryRow("TOTAL", forType)
            };
        });

    return {
        generatedAt: new Date().toISOString(),
        overall: buildMetricSummaryRow("Total", rows),
        byArea: [...areaRows, buildMetricSummaryRow("Total", rows)],
        byPropertyType: [...propertyTypeRows, buildMetricSummaryRow("Total", rows)],
        byPropertyWithinType: byPropertyType
    };
}

async function downloadSelectionExcel() {
    if (csvSelectedElements.length === 0) return;

    const getAreaSegmentFromRows = (rows) => {
        const areas = Array.from(new Set(
            (rows || [])
                .map(row => normalizeStyleValue(row?.area || ""))
                .filter(Boolean)
        ));

        if (areas.length === 1) return areas[0];
        if (areas.length > 1) return "MultiArea";
        return "Area";
    };

    const isValidForDmDelta = (propertyType, property) => {
        const typeText = String(propertyType || "").toLowerCase();
        const propText = String(property || "").toLowerCase();

        if (typeText.includes("color") || typeText.includes("shadow")) return true;
        if (propText.includes("color") || propText.includes("shadow")) return true;
        if (propText === "border" || propText.startsWith("border-")) return true;
        if (propText === "fill" || propText === "stroke") return true;
        if (propText.startsWith("text-decoration")) return true;
        return false;
    };

    const getLightDarkDeltaFlag = (lmValue1, dmValue1) => {
        const lm = normalizeStyleValue(lmValue1);
        const dm = normalizeStyleValue(dmValue1);
        return lm !== dm ? "Yes" : "No";
    };

    const header = [
        "Area",
        "Subarea",
        "Element",
        "Selector",
        "Property Type",
        "Property",
        "State",
        "LM CSS Token",
        "LM CSS Value1",
        "LM CSS Value2",
        "DM CSS Token",
        "DM CSS Value1",
        "DM CSS Value2",
        "Valid for DM delta?",
        "Light-Dark Value Delta"
    ];
    const selectedRows = await getPropertyExportRowsFromSelectedElements();
    const panelSummary = buildSelectionExportSummary(selectedRows);

    const areaBuckets = new Map();

    selectedRows.forEach(row => {
        const area = String(row.area || "").trim();
        const subArea = String(row.subArea || "").trim();
        const validForDmDelta = isValidForDmDelta(row.propertyType, row.property) ? "Yes" : "No";
        const lightDarkDelta = validForDmDelta === "Yes"
            ? getLightDarkDeltaFlag(row.lmCssValue1, row.dmCssValue1)
            : "";

        const rowCells = [
            row.area,
            row.subArea,
            row.element,
            row.selector,
            row.propertyType || "",
            row.property || "",
            row.state || "",
            row.lmCssToken || "",
            row.lmCssValue1 || "",
            row.lmCssValue2 || "",
            row.dmCssToken || "",
            row.dmCssValue1 || "",
            row.dmCssValue2 || "",
            validForDmDelta,
            lightDarkDelta
        ];

        const rowData = {
            cells: rowCells,
            cellStyleIds: lightDarkDelta === "Yes"
                ? { 14: "dmDeltaYesCell" }
                : {}
        };

        const isUnclassified = !area
            || (area === "Algo" && subArea.toLowerCase() === "search result content");

        if (isUnclassified) return;

        if (!areaBuckets.has(area)) {
            areaBuckets.set(area, []);
        }
        areaBuckets.get(area).push(rowData);
    });

    const sheets = [];

    areaBuckets.forEach((rows, area) => {
        sheets.push({ name: area, rows: [header, ...rows] });
    });

    const fileAreaSegment = getAreaSegmentFromRows(selectedRows);
    await triggerExcelDownload(buildExportFilename("xls", { area: fileAreaSegment }), sheets);
    return panelSummary;
}

function addElementToCsvSelection(el) {
    if (!el || isExtensionPanelElement(el)) return;

    const selector = getUniqueSelector(el);
    if (!selector) return;

    const classification = getClassifiedAreaAndSubarea(el);

    csvSelectedElements.push({
        selector,
        area: classification.area,
        subArea: classification.subArea,
        description: getElementDescription(el),
        tagName: el.tagName?.toLowerCase() || "element",
        count: 1
    });

    if (isDownloadCsvView()) {
        renderDownloadCsvPanel({ stickToBottom: true });
    }
}

function addCurrentElementToCsvSelection() {
    addElementToCsvSelection(currentElement);
}

function buildSummaryTableHtml(title, rows) {
    const metricRows = Array.isArray(rows) ? rows : [];
    if (metricRows.length === 0) return "";

    return `
        <div class="ldc-export-summary-section">
            <div class="ldc-export-summary-title">${escapeHtml(title)}</div>
            <table class="ldc-export-summary-table">
                <thead>
                    <tr>
                        <th>Label</th>
                        <th>Total</th>
                        <th>Tokenized</th>
                        <th>Tokenized %</th>
                        <th>Hardcoded</th>
                        <th>Hardcoded %</th>
                    </tr>
                </thead>
                <tbody>
                    ${metricRows.map(row => `
                        <tr>
                            <td>${escapeHtml(row?.label || "")}</td>
                            <td>${escapeHtml(String(row?.total ?? ""))}</td>
                            <td>${escapeHtml(String(row?.tokenized ?? ""))}</td>
                            <td>${escapeHtml(row?.tokenizedPct || "")}</td>
                            <td>${escapeHtml(String(row?.hardcoded ?? ""))}</td>
                            <td>${escapeHtml(row?.hardcodedPct || "")}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function buildSelectionSummaryHtml(summary) {
    if (!summary) return "";

    return `
        <div class="ldc-export-summary${isSelectionSummaryCollapsed ? " ldc-export-summary-collapsed" : ""}">
            <div class="ldc-export-summary-header">
                <div class="ldc-export-summary-heading">Export Summary</div>
                <button type="button" class="ldc-export-summary-toggle-all">${isSelectionSummaryCollapsed ? "Expand All" : "Collapse All"}</button>
            </div>
            <div class="ldc-export-summary-body">
                <div class="ldc-export-summary-meta">Generated: ${escapeHtml(summary.generatedAt || "")}</div>
                ${buildSummaryTableHtml("By Area", summary.byArea || [])}
            </div>
        </div>
    `;
}

function renderDownloadCsvPanel(options = {}) {
    const stickToBottom = Boolean(options?.stickToBottom);
    const panel = getOrCreateDeltaPanel();
    const auditorPanel = panel.querySelector('.ldc-tab-panel[data-tab="auditor"]');
    const selectorNode = auditorPanel?.querySelector("#ldc-selector-text");
    const sectionsNode = auditorPanel?.querySelector("#ldc-auditor-sections");
    if (!selectorNode || !sectionsNode) return;

    const previousListNode = sectionsNode.querySelector(".ldc-csv-list");
    const previousScrollTop = previousListNode ? previousListNode.scrollTop : 0;

    selectorNode.textContent = currentSelector || "—";

    const itemsHtml = csvSelectedElements.length > 0
        ? `
            <div class="ldc-csv-list">
                ${csvSelectedElements.map((item, index) => `
                    <div class="ldc-csv-item">
                        <div class="ldc-csv-item-index">${index + 1}.</div>
                        <div class="ldc-csv-item-body">
                            <div class="ldc-csv-item-description">${escapeHtml(item.area || "")}${item.subArea ? ` > ${escapeHtml(item.subArea)}` : ""}</div>
                            <div class="ldc-csv-item-description">${escapeHtml(item.description || item.tagName || item.selector)}</div>
                            <div class="ldc-csv-item-selector">${escapeHtml(item.selector)}</div>
                        </div>
                        <button class="ldc-csv-remove" data-index="${index}" type="button" aria-label="Remove item">x</button>
                    </div>
                `).join("")}
            </div>
        `
        : `<div class="ldc-csv-empty">Hover an element and press Shift+Alt to add it to the CSV list.</div>`;

    const summaryHtml = buildSelectionSummaryHtml(lastSelectionExportSummary);

    sectionsNode.innerHTML = `
        <div class="ldc-csv-shell">
            <div class="ldc-csv-helper">Use Shift+Alt while hovering to collect elements into this list.</div>
            ${itemsHtml}
            <button id="ldc-download-csv" type="button" ${csvSelectedElements.length === 0 ? "disabled" : ""}>Download CSV</button>
            ${summaryHtml}
        </div>
    `;

    sectionsNode.style.display = "flex";
    sectionsNode.style.flexDirection = "column";
    sectionsNode.style.minHeight = "0";
    sectionsNode.style.overflow = "hidden";

    const downloadButton = sectionsNode.querySelector("#ldc-download-csv");
    if (downloadButton) {
        downloadButton.addEventListener("click", handleSelectionExcelDownloadClick);
    }

    const summaryToggleButton = sectionsNode.querySelector(".ldc-export-summary-toggle-all");
    if (summaryToggleButton) {
        summaryToggleButton.addEventListener("click", () => {
            isSelectionSummaryCollapsed = !isSelectionSummaryCollapsed;
            renderDownloadCsvPanel();
        });
    }

    const csvShell = sectionsNode.querySelector(".ldc-csv-shell");
    if (csvShell) {
        const panelRect = panel.getBoundingClientRect();
        const shellRect = csvShell.getBoundingClientRect();
        const availableHeight = Math.max(180, Math.floor(panelRect.bottom - shellRect.top - 16));
        csvShell.style.height = `${availableHeight}px`;
        csvShell.style.maxHeight = `${availableHeight}px`;
    }

    const currentListNode = sectionsNode.querySelector(".ldc-csv-list");
    if (currentListNode) {
        if (stickToBottom) {
            currentListNode.scrollTop = currentListNode.scrollHeight;
        } else if (previousScrollTop > 0) {
            currentListNode.scrollTop = previousScrollTop;
        }
    }

    sectionsNode.querySelectorAll(".ldc-csv-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            const index = Number(btn.getAttribute("data-index"));
            if (Number.isNaN(index) || index < 0 || index >= csvSelectedElements.length) return;
            csvSelectedElements.splice(index, 1);
            renderDownloadCsvPanel();
        });
    });
}

function resolveSnapshotTheme(snapshot, fallbackTheme) {
    if (snapshot?.theme === "dark") return "dark";
    if (snapshot?.theme === "light") return "light";
    return fallbackTheme === "dark" ? "dark" : "light";
}

function getDifferingProperties(sourceSnapshot, localSnapshot, selector, el) {
    const sourceComputed = normalizeStyleMap(sourceSnapshot?.computed || sourceSnapshot || {});
    const localComputed = normalizeStyleMap(localSnapshot?.computed || localSnapshot || {});
    const sourceAuthored = normalizeStyleMap(sourceSnapshot?.authored || {});
    const localAuthored = normalizeStyleMap(localSnapshot?.authored || {});
    const sourceTheme = resolveSnapshotTheme(sourceSnapshot, "light");
    const localTheme = resolveSnapshotTheme(localSnapshot, getEffectiveTheme());
    const keys = new Set([...Object.keys(sourceComputed), ...Object.keys(localComputed)]);
    const diffRows = [];
    const elementDescription = getElementDescription(el);

    for (const key of keys) {
        const sourceValue = sourceComputed[key] || "";
        const localValue = localComputed[key] || "";

        if (sourceValue !== localValue) {
            const row = {
                element: elementDescription,
                selector: selector || getUniqueSelector(el) || "",
                property: key,
                lightTokenValue: "",
                lightValue: "",
                darkTokenValue: "",
                darkValue: ""
            };

            if (sourceTheme === "dark") {
                row.darkTokenValue = sourceAuthored[key] || "";
                row.darkValue = sourceValue;
            } else {
                row.lightTokenValue = sourceAuthored[key] || "";
                row.lightValue = sourceValue;
            }

            if (localTheme === "dark") {
                row.darkTokenValue = localAuthored[key] || row.darkTokenValue;
                row.darkValue = localValue || row.darkValue;
            } else {
                row.lightTokenValue = localAuthored[key] || row.lightTokenValue;
                row.lightValue = localValue || row.lightValue;
            }

            diffRows.push(row);
        }
    }

    return diffRows;
}

function setDeltaHighlightForSelector(selector, isDifferent) {
    if (!selector) return;

    let el = null;
    try {
        el = document.querySelector(selector);
    } catch {
        el = null;
    }
    if (!el) return;

    if (isDifferent) {
        el.classList.add("ldc-delta-diff");
        return;
    }

    el.classList.remove("ldc-delta-diff");
}

function clearDeltaHighlights() {
    document.querySelectorAll(".ldc-delta-diff").forEach(el => {
        el.classList.remove("ldc-delta-diff");
    });
}

function getDeltaExportRows() {
    return Array.from(deltaDiffRowsBySelector.values()).flat().filter(row => row && row.property);
}

function getXmlSafeValue(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function normalizeExcelSheetName(sheetName, usedNames) {
    const base = String(sheetName || "Sheet")
        .replace(/[\\/:?*\[\]]/g, " ")
        .trim()
        .slice(0, 31) || "Sheet";

    let candidate = base;
    let suffix = 2;

    while (usedNames.has(candidate.toLowerCase())) {
        const next = `${base.slice(0, Math.max(0, 31 - (` (${suffix})`.length)))} (${suffix})`;
        candidate = next;
        suffix += 1;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
}

async function yieldToMainThread() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function buildWorksheetXml(sheetName, rows) {
    const safeSheet = getXmlSafeValue(sheetName);
    const rowXmlParts = [];
    const rowList = rows || [];

    for (let rowIndex = 0; rowIndex < rowList.length; rowIndex += 1) {
        const row = rowList[rowIndex];
        const rowCells = Array.isArray(row) ? row : (row?.cells || []);
        const rowStyle = row?.styleId ? ` ss:StyleID="${getXmlSafeValue(row.styleId)}"` : "";
        const cellStyleIds = row?.cellStyleIds || {};
        const cells = rowCells.map((cell, index) => {
            const cellStyle = cellStyleIds[index] ? ` ss:StyleID="${getXmlSafeValue(cellStyleIds[index])}"` : "";
            return `<Cell${cellStyle}><Data ss:Type="String">${getXmlSafeValue(cell)}</Data></Cell>`;
        }).join("");
        rowXmlParts.push(`<Row${rowStyle}>${cells}</Row>`);

        if ((rowIndex + 1) % 200 === 0) {
            await yieldToMainThread();
        }
    }

    const rowXml = rowXmlParts.join("");

    return [
        `<Worksheet ss:Name="${safeSheet}">`,
        "<Table>",
        rowXml,
        "</Table>",
        "</Worksheet>"
    ].join("");
}

function interpolateHexColor(startHex, endHex, ratio) {
    const clamp = Math.max(0, Math.min(1, Number(ratio) || 0));
    const parseChannel = (hex, startIndex) => parseInt(hex.slice(startIndex, startIndex + 2), 16);
    const start = String(startHex || "#000000").replace("#", "");
    const end = String(endHex || "#000000").replace("#", "");
    const channels = [0, 2, 4].map(index => {
        const startValue = parseChannel(start, index);
        const endValue = parseChannel(end, index);
        const mixed = Math.round(startValue + ((endValue - startValue) * clamp));
        return mixed.toString(16).padStart(2, "0").toUpperCase();
    });
    return `#${channels.join("")}`;
}

async function buildExcelXml(sheets) {
    const usedNames = new Set();
    const worksheetParts = [];
    const sheetList = sheets || [];

    for (let sheetIndex = 0; sheetIndex < sheetList.length; sheetIndex += 1) {
        const sheet = sheetList[sheetIndex];
        const uniqueName = normalizeExcelSheetName(sheet?.name || "Sheet", usedNames);
        worksheetParts.push(await buildWorksheetXml(uniqueName, sheet?.rows || []));
        await yieldToMainThread();
    }

    const worksheetXml = worksheetParts.join("");

    return [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<?mso-application progid=\"Excel.Sheet\"?>",
        "<Workbook xmlns=\"urn:schemas-microsoft-com:office:spreadsheet\"",
        " xmlns:o=\"urn:schemas-microsoft-com:office:office\"",
        " xmlns:x=\"urn:schemas-microsoft-com:office:excel\"",
        " xmlns:ss=\"urn:schemas-microsoft-com:office:spreadsheet\"",
        " xmlns:html=\"http://www.w3.org/TR/REC-html40\">",
        "<Styles>",
        "<Style ss:ID=\"dmDeltaYesCell\"><Interior ss:Color=\"#F9D5D3\" ss:Pattern=\"Solid\"/></Style>",
        "</Styles>",
        worksheetXml,
        "</Workbook>"
    ].join("");
}

async function triggerExcelDownload(filename, sheetOrSheets, rows) {
    const sheets = Array.isArray(sheetOrSheets)
        ? sheetOrSheets
        : [{ name: sheetOrSheets || "Sheet1", rows: rows || [] }];

    const xml = await buildExcelXml(sheets);
    const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function runWithButtonSpinner(button, loadingText, work) {
    if (typeof work !== "function") return;
    if (!button) {
        await work();
        return;
    }

    const wasDisabled = button.disabled;
    const originalText = button.dataset.originalText || button.textContent || "";
    button.dataset.originalText = originalText;
    button.disabled = true;
    button.classList.add("ldc-btn-loading");
    button.textContent = loadingText;

    // Yield one frame so the loading state can paint before heavy work starts.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));

    try {
        await work();
    } finally {
        button.classList.remove("ldc-btn-loading");
        button.textContent = originalText;
        button.disabled = wasDisabled;
    }
}

async function handleSelectionExcelDownloadClick(event) {
    const button = event?.currentTarget || document.querySelector("#ldc-download-csv");
    await runWithButtonSpinner(button, "Generating Report....", async () => {
        const summary = await downloadSelectionExcel();
        if (summary) {
            lastSelectionExportSummary = summary;
            renderDownloadCsvPanel();
        }
    });
}

async function handleDeltaExcelDownloadClick(event) {
    const button = event?.currentTarget || document.querySelector("#ldc-download-deltas");
    await runWithButtonSpinner(button, "Generating...", async () => {
        await downloadDeltaExcel();
    });
}

function buildCsvRowFromDelta(row) {
    if (!row) {
        return {
            element: "",
            selector: "",
            property: "",
            lightTokenValue: "",
            lightValue: "",
            darkTokenValue: "",
            darkValue: ""
        };
    }

    return {
        element: row.element || "",
        selector: row.selector || "",
        property: row.property || "",
        lightTokenValue: row.lightTokenValue || "",
        lightValue: row.lightValue || "",
        darkTokenValue: row.darkTokenValue || "",
        darkValue: row.darkValue || ""
    };
}

async function downloadDeltaExcel() {
    const rows = getDeltaExportRows();
    if (rows.length === 0) return;

    const header = [
        "Element",
        "selector",
        "property",
        "light mode token/value",
        "light mode value",
        "dark mode token/value",
        "dark mode value"
    ];

    const exportRows = [header];
    rows.forEach(row => {
        const csvRow = buildCsvRowFromDelta(row);
        exportRows.push([
            csvRow.element,
            csvRow.selector,
            csvRow.property,
            csvRow.lightTokenValue,
            csvRow.lightValue,
            csvRow.darkTokenValue,
            csvRow.darkValue
        ]);
    });

    await triggerExcelDownload(buildExportFilename("xls", { area: "Delta" }), "DeltaExport", exportRows);
}

function updateDeltaExportButtonState() {
    const button = document.querySelector("#ldc-download-deltas");
    if (!button) return;

    const shouldShow = isDeltaOnlyView() && isSyncMirroringActive;
    button.style.display = shouldShow ? "" : "none";
    button.disabled = !shouldShow || getDeltaExportRows().length === 0;
}

function hasMeaningfulValue(value) {
    const text = normalizeStyleValue(value);
    return Boolean(text && text !== "initial" && text !== "inherit" && text !== "unset" && text !== "none" && text !== "normal");
}

function isZeroDurationValue(value) {
    const text = normalizeStyleValue(value).toLowerCase();
    if (!text) return true;

    const parts = text
        .split(",")
        .map(part => normalizeStyleValue(part).toLowerCase())
        .filter(Boolean);

    if (parts.length === 0) return true;

    return parts.every(part => /^0*(?:\.0+)?(?:ms|s)$/.test(part));
}

const INHERITABLE_AUDIT_PROPERTIES = new Set([
    "color", "cursor", "direction", "font", "font-family", "font-size", "font-style", "font-weight",
    "letter-spacing", "line-height", "text-align", "text-transform", "visibility", "word-spacing", "fill"
]);

function isTransparentColorValue(value) {
    const text = normalizeStyleValue(value).toLowerCase();
    if (!text) return false;
    if (text === "transparent") return true;
    if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*\)/i.test(text)) return true;
    if (/rgb\(\s*0\s+0\s+0\s*\/\s*0(?:\.0+)?%?\s*\)/i.test(text)) return true;
    return false;
}

function isFillApplicableForElement(el, authoredValue, computedValue) {
    if (!el) return false;

    const authoredText = normalizeStyleValue(authoredValue);
    const computedText = normalizeStyleValue(computedValue).toLowerCase();
    const isSvgElement = el instanceof SVGElement;

    if (!isSvgElement) {
        // Non-SVG nodes should not surface fill unless explicitly authored.
        return Boolean(authoredText);
    }

    // For SVG nodes, avoid noisy default UA fill when nothing was authored.
    const isDefaultSvgFill = computedText === "rgb(0, 0, 0)" || computedText === "currentcolor";
    return Boolean(authoredText) || !isDefaultSvgFill;
}

function getPropertyStateBadges(el, prop, authoredValue, computedValue) {
    const badges = [];
    const authoredText = normalizeStyleValue(authoredValue);
    const computedText = normalizeStyleValue(computedValue);
    const authoredKeyword = authoredText.toLowerCase();

    if (["inherit", "unset", "initial", "revert", "revert-layer"].includes(authoredKeyword)) {
        badges.push(authoredKeyword);
    }

    if (prop === "background-color" && isTransparentColorValue(computedText)) {
        badges.push("transparent");
    }

    if (!authoredText && INHERITABLE_AUDIT_PROPERTIES.has(prop) && el?.parentElement) {
        let parentValue = "";
        try {
            parentValue = normalizeStyleValue(window.getComputedStyle(el.parentElement).getPropertyValue(prop));
        } catch {
            parentValue = "";
        }

        if (parentValue && parentValue === computedText) {
            badges.push("inherited");
        }
    }

    return badges;
}

function getDefaultAuditValue(prop) {
    const defaults = {
        "background-color": "transparent",
        "box-shadow": "none",
        "text-shadow": "none",
        "filter": "none"
    };

    return defaults[prop] || "";
}

// ------------------------------
// Hover detection
// ------------------------------

let hoverRaf = null;
let currentElement = null;
let isPointerInsidePanel = false;

document.addEventListener("mouseover", e => {
    if (hoverFrozen || e.shiftKey || isPointerInsidePanel) return;

  let el = e.target;

  // Convert text node to parent element
  if (el && el.nodeType !== Node.ELEMENT_NODE) {
    el = el.parentElement;
  }

  if (!el) return;

  // Ignore hovering inside the panel itself
  if (el.closest("#ldc-delta-panel")) return;

  // Avoid redundant updates on the same element
  if (el === currentElement) return;

  if (hoverRaf) {
    cancelAnimationFrame(hoverRaf);
  }

  hoverRaf = requestAnimationFrame(() => {
        selectElement(el);
  });
});

window.addEventListener("scroll", () => {
        if (syncedPeerTabId === null || isApplyingSyncedScroll) return;

        if (scrollSyncRaf) {
                cancelAnimationFrame(scrollSyncRaf);
        }

        scrollSyncRaf = requestAnimationFrame(() => {
                sendSyncEvent("scroll", { x: window.scrollX, y: window.scrollY });
        });
}, { passive: true });

document.addEventListener("pointerover", e => {
    isPointerInsidePanel = isExtensionPanelElement(e.target);
}, true);

document.addEventListener("pointerout", e => {
    if (!isExtensionPanelElement(e.target)) return;
    isPointerInsidePanel = isExtensionPanelElement(e.relatedTarget);
}, true);



// ------------------------------
// Panel visibility
// ------------------------------
function togglePanelVisibility() {
    const panel = getOrCreateDeltaPanel();
    applyViewMode(panel);
    panelVisible = !panelVisible;
    panel.style.display = panelVisible ? "block" : "none";
}

function setVisible(node, visible) {
    if (!node) return;
    node.style.display = visible ? "" : "none";
}

function ensureSbsInstructions(tabPanel) {
    if (!tabPanel) return null;

    let box = tabPanel.querySelector(".ldc-sbs-instructions");
    if (box) return box;

    box = document.createElement("div");
    box.className = "ldc-sbs-instructions";
    box.innerHTML = `
        <p class="ldc-sbs-text">
            Open two tabs in split panels, then Ctrl+click both tabs and click <b>Sync Tabs</b>.
        </p>
        <button class="ldc-sync-tabs-btn">Sync Tabs</button>
        <div class="ldc-sync-tabs-status">Waiting for tab selection.</div>
    `;

    const syncBtn = box.querySelector(".ldc-sync-tabs-btn");
    const status = box.querySelector(".ldc-sync-tabs-status");

    syncBtn.addEventListener("click", () => {
        status.textContent = "Checking highlighted tabs...";
        chrome.runtime.sendMessage({ type: "ldcSyncTabs" }, (resp) => {
            if (chrome.runtime.lastError) {
                status.textContent = "Unable to sync tabs right now.";
                return;
            }
            status.textContent = resp?.message || "Sync complete.";
        });
    });

    tabPanel.appendChild(box);
    return box;
}

function applyViewMode(panel) {
    if (!panel) return;

    const viewMode = getCurrentViewMode();
    if (!canUseCsvSelectionBody(viewMode)) {
        isCsvSelectionBodyActive = false;
    }
    const isDesktopSbs = isSbsModeView();
    const isDownloadMode = isDownloadCsvView();
    const showSbsInstructions = isDesktopSbs && !isSyncMirroringActive;

    const auditorPanel = panel.querySelector('.ldc-tab-panel[data-tab="auditor"]');
    const tokensPanel = panel.querySelector('.ldc-tab-panel[data-tab="tokens"]');

    const auditorHeader = panel.querySelector("#ldc-auditor-header");
    const selectorText = panel.querySelector("#ldc-selector-text");
    const auditorSections = panel.querySelector("#ldc-auditor-sections");
    const tokenInput = panel.querySelector("#ldc-token-input");
    const tokenFind = panel.querySelector("#ldc-token-find");
    const tokenResults = panel.querySelector("#ldc-token-results");
    const downloadDeltasButton = panel.querySelector("#ldc-download-deltas");

    setVisible(auditorHeader, !showSbsInstructions);
    setVisible(selectorText, !showSbsInstructions);
    setVisible(auditorSections, !showSbsInstructions);
    setVisible(tokenInput, !showSbsInstructions && !isDownloadMode);
    setVisible(tokenFind, !showSbsInstructions && !isDownloadMode);
    setVisible(tokenResults, !showSbsInstructions && !isDownloadMode);
    setVisible(downloadDeltasButton, !showSbsInstructions && isDeltaOnlyView() && isSyncMirroringActive && !isDownloadMode);

    const auditorInstructions = ensureSbsInstructions(auditorPanel);
    const tokenInstructions = ensureSbsInstructions(tokensPanel);
    setVisible(auditorInstructions, showSbsInstructions);
    setVisible(tokenInstructions, showSbsInstructions);

    if (!showSbsInstructions) {
        refreshAuditorBody();
    }

    if (!isDeltaOnlyView()) {
        clearDeltaHighlights();
    }

    updateDeltaExportButtonState();
}

// ------------------------------
// Selector generator
// ------------------------------
function escapeCssIdentifier(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(raw);
    }

    return raw.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getSelectorSegment(el) {
    if (!el || !el.tagName) return "";

    const tagName = el.tagName.toLowerCase();
    const id = (el.id || "").trim();
    if (id) return `#${escapeCssIdentifier(id)}`;

    const classes = [...(el.classList || [])]
        .filter(cls => cls && !cls.toLowerCase().startsWith("ldc-"))
        .slice(0, 3)
        .map(escapeCssIdentifier);

    let segment = tagName;
    if (classes.length > 0) {
        segment += `.${classes.join(".")}`;
    }

    if (classes.length === 0) {
        const role = (el.getAttribute("role") || "").trim();
        if (role) {
            const escapedRole = role.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
            segment += `[role="${escapedRole}"]`;
        }

        const parent = el.parentElement;
        if (parent) {
            const siblings = [...parent.children].filter(node => node.tagName === el.tagName);
            if (siblings.length > 1) {
                const index = siblings.indexOf(el) + 1;
                if (index > 0) {
                    segment += `:nth-of-type(${index})`;
                }
            }
        }
    }

    return segment;
}

function getUniqueSelector(el) {
    if (!el || !el.tagName) return null;

    const segments = [];
    let node = el;
    let depth = 0;

    while (node && node.nodeType === Node.ELEMENT_NODE && depth < 3) {
        const segment = getSelectorSegment(node);
        if (!segment) break;

        segments.unshift(segment);

        if (segment.startsWith("#")) break;

        node = node.parentElement;
        if (!node || node === document.documentElement || node === document.body) {
            break;
        }
        depth += 1;
    }

    if (segments.length === 0) return null;
    return segments.join(" > ");
}

// ------------------------------
// CSS extraction
// ------------------------------
function extractCSS(el) {
    const computed = window.getComputedStyle(el);
    const authored = {};
    const computedValues = {};

    for (const category in CSS_CATEGORIES) {
        CSS_CATEGORIES[category].forEach(prop => {
            let comp = "";
            try { comp = computed.getPropertyValue(prop); } catch {}

            
            if (comp !== undefined && comp !== null) {
            computedValues[prop] = comp;
            }


            let authoredValue = "";
            try { authoredValue = el.style.getPropertyValue(prop); } catch {}

            if (!authoredValue) authoredValue = findAuthoredCSS(el, prop);

            if (authoredValue)
                authored[prop] = authoredValue;
        });
    }
    
    
    return { authored, computed: computedValues };
}

function getSelectorSpecificity(selector) {
    if (!selector || typeof selector !== "string") return [0, 0, 0];

    let text = selector
        .replace(/:where\(([^()]|\([^()]*\))*\)/g, "");

    const idCount = (text.match(/#[\w-]+/g) || []).length;
    const classCount = (text.match(/\.[\w-]+/g) || []).length
        + (text.match(/\[[^\]]+\]/g) || []).length
        + (text.match(/:(?!:)[a-zA-Z-]+(\([^)]*\))?/g) || []).length;

    const stripped = text
        .replace(/#[\w-]+/g, " ")
        .replace(/\.[\w-]+/g, " ")
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, " ")
        .replace(/\*/g, " ");

    const typeCount = (stripped.match(/\b[a-zA-Z][\w-]*\b/g) || []).length;
    return [idCount, classCount, typeCount];
}

function compareSpecificity(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

function compareCascadeCandidates(next, prev) {
    if (!prev) return 1;

    if (Boolean(next.important) !== Boolean(prev.important)) {
        return next.important ? 1 : -1;
    }

    if (Boolean(next.inline) !== Boolean(prev.inline)) {
        return next.inline ? 1 : -1;
    }

    const specificityDiff = compareSpecificity(next.specificity, prev.specificity);
    if (specificityDiff !== 0) return specificityDiff;

    return next.order - prev.order;
}

const INTERACTION_STATES = {
    hover: [":hover"],
    active: [":active", ":hover"],
    focus: [":focus", ":focus-visible", ":focus-within"],
    disabled: [":disabled"]
};

function getInteractionStateDisplayName(state) {
    if (state === "active") return "pressed";
    if (state === "focus") return "focused";
    return state;
}

function normalizeSelectorForState(selector, state) {
    if (!selector) return null;

    const lowered = selector.toLowerCase();
    if (/:not\(([^)]*):(hover|active|focus|focus-visible|focus-within|disabled)/i.test(lowered)) {
        return null;
    }

    let normalized = selector;
    const allStatePseudos = Object.values(INTERACTION_STATES).flat();

    for (const pseudo of allStatePseudos) {
        const escapedPseudo = pseudo.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const regex = new RegExp(escapedPseudo, "gi");
        const hasPseudo = regex.test(normalized);
        if (!hasPseudo) continue;

        const allowedForState = state ? INTERACTION_STATES[state] || [] : [];
        const shouldAllow = allowedForState.includes(pseudo);

        if (!state || !shouldAllow) {
            return null;
        }
        // Treat the requested interaction state as virtual so hover/focus/active rules
        // can be inspected even when the pointer/focus is currently elsewhere.
        normalized = normalized.replace(regex, "");
    }

    return normalized.trim();
}

function getMatchingSelectorSpecificity(el, selectorText, state = null) {
    if (!selectorText) return null;

    let best = null;
    const selectors = selectorText.split(",");

    for (const rawSelector of selectors) {
        const selector = rawSelector.trim();
        if (!selector) continue;

        const normalizedSelector = normalizeSelectorForState(selector, state);
        if (!normalizedSelector) continue;

        try {
            if (!el.matches(normalizedSelector)) continue;
        } catch {
            continue;
        }

        const specificity = getSelectorSpecificity(selector);
        if (!best || compareSpecificity(specificity, best) > 0) {
            best = specificity;
        }
    }

    return best;
}

function collectCascadeCandidates(el, prop, rules, cascadeState, interactionState = null) {
    if (!rules) return;

    for (const rule of rules) {
        if (!rule) continue;

        if (rule.type === CSSRule.STYLE_RULE) {
            const value = rule.style?.getPropertyValue(prop);
            if (!value) {
                cascadeState.order += 1;
                continue;
            }

            const specificity = getMatchingSelectorSpecificity(el, rule.selectorText, interactionState);
            if (!specificity) {
                cascadeState.order += 1;
                continue;
            }

            const candidate = {
                value: value.trim(),
                important: rule.style.getPropertyPriority(prop) === "important",
                inline: false,
                specificity,
                order: cascadeState.order
            };

            if (compareCascadeCandidates(candidate, cascadeState.best) > 0) {
                cascadeState.best = candidate;
            }

            cascadeState.order += 1;
            continue;
        }

        if ("cssRules" in rule && rule.cssRules) {
            collectCascadeCandidates(el, prop, rule.cssRules, cascadeState, interactionState);
        }
    }
}

function selectorHasInteractionPseudo(selectorText, interactionState) {
    if (!selectorText || !interactionState) return false;

    const allowedPseudos = INTERACTION_STATES[interactionState] || [];
    if (allowedPseudos.length === 0) return false;

    const selectors = selectorText.split(",");
    for (const rawSelector of selectors) {
        const selector = rawSelector.trim();
        if (!selector) continue;

        for (const pseudo of allowedPseudos) {
            const escapedPseudo = pseudo.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const pseudoRegex = new RegExp(`${escapedPseudo}(?![\\w-])`, "i");
            if (pseudoRegex.test(selector)) return true;
        }
    }

    return false;
}

function isExtensionStylesheet(sheet) {
    if (!sheet) return false;

    const extensionBase = chrome?.runtime?.getURL?.("") || "";
    const href = sheet.href || "";
    if (extensionBase && href && href.startsWith(extensionBase)) return true;

    const ownerNode = sheet.ownerNode;
    if (!ownerNode) return false;

    if (ownerNode.id === "ldc-device-style" || ownerNode.id === "ldc-forced-color-scheme") {
        return true;
    }

    return false;
}

function findBestCascadeValue(el, prop, interactionState, options = {}) {
    const includeInline = options.includeInline !== false;
    const requireStateSpecific = Boolean(options.requireStateSpecific);

    const inlineValue = includeInline ? el.style?.getPropertyValue(prop) : "";
    const inlineCandidate = inlineValue
        ? {
            value: inlineValue.trim(),
            important: el.style.getPropertyPriority(prop) === "important",
            inline: true,
            specificity: [Infinity, Infinity, Infinity],
            order: Number.MAX_SAFE_INTEGER
        }
        : null;

    const state = {
        best: inlineCandidate,
        order: 0
    };

    for (const sheet of document.styleSheets) {
        if (isExtensionStylesheet(sheet)) continue;

        let rules;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }

        if (!rules) continue;

        if (requireStateSpecific && interactionState) {
            const filteredRules = Array.from(rules).filter(rule => {
                if (rule?.type !== CSSRule.STYLE_RULE) return true;
                return selectorHasInteractionPseudo(rule.selectorText, interactionState);
            });
            collectCascadeCandidates(el, prop, filteredRules, state, interactionState);
        } else {
            collectCascadeCandidates(el, prop, rules, state, interactionState);
        }
    }

    return state.best?.value || null;
}

function findAuthoredCSS(el, prop, options = {}) {
    if (!el || !prop) return null;

    const interactionState = options?.state || null;
    const strictState = Boolean(options?.strictState);

    if (interactionState && INTERACTION_STATES[interactionState]) {
        const stateSpecificValue = findBestCascadeValue(el, prop, interactionState, {
            includeInline: false,
            requireStateSpecific: true
        });
        if (stateSpecificValue) return stateSpecificValue;
        if (strictState) return null;
    }

    return findBestCascadeValue(el, prop, interactionState, {
        includeInline: true,
        requireStateSpecific: false
    });
}

function splitCssListByTopLevelComma(value) {
    const text = String(value || "");
    const result = [];
    let current = "";
    let depth = 0;

    for (const ch of text) {
        if (ch === "(") {
            depth += 1;
            current += ch;
            continue;
        }
        if (ch === ")") {
            depth = Math.max(0, depth - 1);
            current += ch;
            continue;
        }
        if (ch === "," && depth === 0) {
            const item = normalizeStyleValue(current);
            if (item) result.push(item);
            current = "";
            continue;
        }
        current += ch;
    }

    const tail = normalizeStyleValue(current);
    if (tail) result.push(tail);
    return result;
}

function parseTransitionShorthand(value) {
    const entries = splitCssListByTopLevelComma(value);
    if (entries.length === 0) {
        return {
            "transition-property": "",
            "transition-duration": "",
            "transition-timing-function": "",
            "transition-delay": ""
        };
    }

    const properties = [];
    const durations = [];
    const timings = [];
    const delays = [];

    const easingKeywords = new Set([
        "ease", "linear", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"
    ]);

    const tokenize = (text) => {
        const valueText = String(text || "").trim();
        if (!valueText) return [];

        const tokens = [];
        let current = "";
        let depth = 0;

        for (const ch of valueText) {
            if (ch === "(") {
                depth += 1;
                current += ch;
                continue;
            }
            if (ch === ")") {
                depth = Math.max(0, depth - 1);
                current += ch;
                continue;
            }
            if (/\s/.test(ch) && depth === 0) {
                if (current) {
                    tokens.push(current);
                    current = "";
                }
                continue;
            }
            current += ch;
        }

        if (current) tokens.push(current);
        return tokens;
    };

    const isTimeToken = (token) => {
        if (!token) return false;
        if (/^-?\d*\.?\d+m?s$/i.test(token)) return true;
        if (/^var\(/i.test(token) && /duration|delay/i.test(token)) return true;
        return false;
    };

    const isTimingToken = (token) => {
        if (!token) return false;
        const lower = token.toLowerCase();
        if (easingKeywords.has(lower)) return true;
        if (lower.startsWith("cubic-bezier(") || lower.startsWith("steps(") || lower.startsWith("linear(")) return true;
        if (/^var\(/i.test(token) && /ease|easing|timing/i.test(token)) return true;
        return false;
    };

    for (const entry of entries) {
        const tokens = tokenize(entry);

        let property = "";
        let duration = "";
        let timing = "";
        let delay = "";

        for (const token of tokens) {
            if (!duration && isTimeToken(token)) {
                duration = token;
                continue;
            }

            if (!timing && isTimingToken(token)) {
                timing = token;
                continue;
            }

            if (duration && !delay && isTimeToken(token)) {
                delay = token;
                continue;
            }

            if (token.toLowerCase() === "allow-discrete") {
                continue;
            }

            if (!property) {
                property = token;
            }
        }

        properties.push(property || "all");
        durations.push(duration || "0s");
        timings.push(timing || "ease");
        delays.push(delay || "0s");
    }

    return {
        "transition-property": properties.join(", "),
        "transition-duration": durations.join(", "),
        "transition-timing-function": timings.join(", "),
        "transition-delay": delays.join(", ")
    };
}

function buildTransitionDisplayFromComponents(components) {
    const propertyValue = normalizeStyleValue(components?.["transition-property"] || "");
    const durationValue = normalizeStyleValue(components?.["transition-duration"] || "");
    const timingValue = normalizeStyleValue(components?.["transition-timing-function"] || "");
    const delayValue = normalizeStyleValue(components?.["transition-delay"] || "");

    if (!propertyValue && !durationValue && !timingValue && !delayValue) return "";
    if (propertyValue === "none") return "none";

    const properties = splitCssListByTopLevelComma(propertyValue || "all");
    const durations = splitCssListByTopLevelComma(durationValue || "0s");
    const timings = splitCssListByTopLevelComma(timingValue || "ease");
    const delays = splitCssListByTopLevelComma(delayValue || "0s");

    const pickAt = (arr, index, fallback) => {
        if (!Array.isArray(arr) || arr.length === 0) return fallback;
        return arr[Math.min(index, arr.length - 1)] || fallback;
    };

    let index = 0;
    const preferredIndex = properties.findIndex(item => /(^|\s)box-shadow(\s|$)/i.test(item));
    if (preferredIndex >= 0) index = preferredIndex;

    const p = pickAt(properties, index, "all");
    const d = pickAt(durations, index, "0s");
    const t = pickAt(timings, index, "ease");
    const de = pickAt(delays, index, "0s");

    return normalizeStyleValue(`${p} ${d} ${t}${de !== "0s" ? ` ${de}` : ""}`);
}

function resolveTransitionComponentsFromCascade(el, interactionState = "rest") {
    const targets = [
        "transition-property",
        "transition-duration",
        "transition-timing-function",
        "transition-delay"
    ];

    const winners = {
        "transition-property": null,
        "transition-duration": null,
        "transition-timing-function": null,
        "transition-delay": null
    };

    let order = 0;
    const applyCandidate = (targetProp, value, candidateBase) => {
        if (!targets.includes(targetProp)) return;
        const candidate = {
            ...candidateBase,
            value: normalizeStyleValue(value)
        };
        if (!candidate.value) return;

        if (compareCascadeCandidates(candidate, winners[targetProp]) > 0) {
            winners[targetProp] = candidate;
        }
    };

    const consumeStyleDeclarations = (styleDecl, candidateBase, allowTransitionShorthand = true) => {
        if (!styleDecl) return;

        for (let i = 0; i < styleDecl.length; i++) {
            const declProp = styleDecl.item(i);
            if (!declProp) continue;

            if (declProp === "transition" && allowTransitionShorthand) {
                const shorthandValue = styleDecl.getPropertyValue(declProp);
                if (!normalizeStyleValue(shorthandValue)) {
                    order += 1;
                    continue;
                }

                const parsed = parseTransitionShorthand(shorthandValue);
                const important = styleDecl.getPropertyPriority(declProp) === "important";
                const base = { ...candidateBase, important, order: order };
                targets.forEach(target => applyCandidate(target, parsed[target], base));
                order += 1;
                continue;
            }

            if (!targets.includes(declProp)) continue;

            const rawValue = styleDecl.getPropertyValue(declProp);
            const important = styleDecl.getPropertyPriority(declProp) === "important";
            applyCandidate(declProp, rawValue, { ...candidateBase, important, order: order });
            order += 1;
        }
    };

    const consumeRules = (rules) => {
        if (!rules) return;

        for (const rule of rules) {
            if (!rule) continue;

            if (rule.type === CSSRule.STYLE_RULE) {
                const specificity = getMatchingSelectorSpecificity(el, rule.selectorText, interactionState);
                if (!specificity) continue;

                consumeStyleDeclarations(rule.style, {
                    inline: false,
                    specificity
                });
                continue;
            }

            if ("cssRules" in rule && rule.cssRules) {
                consumeRules(rule.cssRules);
            }
        }
    };

    for (const sheet of document.styleSheets) {
        if (isExtensionStylesheet(sheet)) continue;

        let rules;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }

        consumeRules(rules);
    }

    // Inline styles are highest precedence among author styles when not !important conflicts.
    consumeStyleDeclarations(el.style, {
        inline: true,
        specificity: [Infinity, Infinity, Infinity]
    });

    return {
        "transition-property": winners["transition-property"]?.value || "",
        "transition-duration": winners["transition-duration"]?.value || "",
        "transition-timing-function": winners["transition-timing-function"]?.value || "",
        "transition-delay": winners["transition-delay"]?.value || ""
    };
}

function resolveAuthoredTransitionValue(el, interactionState = "rest") {
    const authoredShorthand = normalizeStyleValue(findAuthoredCSS(el, "transition", { state: interactionState }) || "");
    if (authoredShorthand) return authoredShorthand;

    const components = resolveTransitionComponentsFromCascade(el, interactionState);
    const merged = buildTransitionDisplayFromComponents(components);
    if (merged) return merged;

    return "";
}


// ------------------------------
// Highlighting
// ------------------------------
function highlightElement(el) {
    document.querySelectorAll(".ldc-highlight").forEach(x => x.classList.remove("ldc-highlight"));
    el.classList.add("ldc-highlight");
}

// ------------------------------
// Panel creation
// ------------------------------
function getOrCreateDeltaPanel() {
    
    let panels = document.querySelectorAll("#ldc-delta-panel");

    if (panels.length > 1) {
    // Remove duplicates (keep first)
    panels.forEach((p, i) => {
        if (i !== 0) p.remove();
    });
    }

    let panel = document.getElementById("ldc-delta-panel");
    if (panel) return panel;


    panel = document.createElement("div");
    panel.id = "ldc-delta-panel";

    panel.innerHTML = `
        <div id="ldc-topbar">
            <div id="ldc-mode-toggle" style="font-weight: bold; font-size: 14px;">WP DESIGN AUDITOR</div>
            <div id="ldc-mode-toggle">
                <div class="ldc-toggle-option" data-mode="desktop">🖥️</div>
                <div class="ldc-toggle-option ldc-toggle-option-disabled" data-mode="mobile" aria-disabled="true" title="Mobile mode is temporarily disabled">📱</div>
            </div>

            <div id="ldc-theme-toggle">
                <div class="ldc-theme-icon" data-theme="light">☀︎</div>
                <div class="ldc-theme-icon" data-theme="dark">⏾</div>
            </div>
        </div>

        <div id="ldc-view-selector-wrap">
            <select id="ldc-view-selector">
                <option value="per-element">1. Per Element</option>
                <option value="desktop-sbs-delta">3. Desktop SBS: Light vs Dark (Only delta).</option>
            </select>
            <button id="ldc-sync-button" class="ldc-sync-button-icon" disabled>🔗 Sync</button>
        </div>

        <!--<select id="ldc-device-dropdown">
            <option value="iphone15">iPhone 15 (393×852)</option>
            <option value="pixel8">Pixel 8 (412×915)</option>
            <option value="galaxyS24">Galaxy S24 (412×915)</option>
            <option value="ipadMini">iPad Mini (768×1024)</option>
        </select> 
        -->


        <div id="ldc-tab-bar">
            <div class="ldc-tab ldc-tab-active" data-tab="auditor">AUDITOR</div>
            <div class="ldc-tab" data-tab="tokens">TOKEN FINDER</div>
        </div>

        <div id="ldc-tab-content">
          <div class="ldc-tab-panel ldc-tab-panel-active" data-tab="auditor">
            <div id="ldc-auditor-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
                <div id="ldc-auditor-controls">
                <strong>SELECTED ELEMENT:</strong>
                <button id="ldc-dom-up">−</button>
                <button id="ldc-dom-down">+</button>
                <button id="ldc-dom-left">←</button>
                <button id="ldc-dom-right">→</button>
                <button id="ldc-collapse-all" type="button">Collapse All</button>
                </div>
            </div>

            <div id="ldc-selector-text">—</div>
            <div id="ldc-auditor-sections">
                Hover an element to audit its CSS.
            </div>
            </div>

            <div class="ldc-tab-panel" data-tab="tokens">
                <input id="ldc-token-input" placeholder="Enter CSS token e.g. --smtc-ctrl-body3" style="width:95%; padding:6px; margin-bottom:6px; border-radius:999px; border:1px solid #b0a89a;">
                <button id="ldc-token-find" style="width:100%; padding:6px; border-radius:999px; background:#d9d1b8; border:1px solid #b0a89a; cursor:pointer;">Find on Page</button>
                <div id="ldc-token-results" style="margin-top:10px; font-size:12px;"></div>
            </div>
        </div>
    `;


    document.documentElement.appendChild(panel);

    panel.addEventListener("wheel", e => {
        e.stopPropagation();
    }, { passive: true });

    // Restore mode/theme/device
    const savedMode = "desktop";
    localStorage.setItem("ldc-mode", "desktop");
    const savedTheme = localStorage.getItem("ldc-theme") || "light";
    const savedDevice = localStorage.getItem("ldc-device") || "iphone15";
    const savedView = localStorage.getItem("ldc-view-mode") || "per-element";

    panel.querySelectorAll("#ldc-theme-toggle .ldc-theme-icon").forEach(icon => {
        if (icon.getAttribute("data-theme") === savedTheme)
            icon.classList.add("ldc-toggle-active");
    });

    panel.querySelectorAll("#ldc-mode-toggle .ldc-toggle-option").forEach(opt => {
        if (opt.getAttribute("data-mode") === savedMode)
            opt.classList.add("ldc-toggle-active");
    });

    const viewSelector = panel.querySelector("#ldc-view-selector");
    const syncButton = panel.querySelector("#ldc-sync-button");
    
    // Function to update sync button state based on view mode
    const updateSyncButtonState = (viewMode) => {
        if (syncButton) {
            const isSyncMode = viewMode === "desktop-sbs-delta";
            syncButton.disabled = !isSyncMode;
        }
    };
    
    if (viewSelector) {
        const initialViewMode = ["per-element", "desktop-sbs-delta"].includes(savedView)
            ? savedView
            : (savedView === "desktop-sbs" ? "desktop-sbs-delta" : "per-element");
        if (savedView !== initialViewMode) {
            localStorage.setItem("ldc-view-mode", initialViewMode);
        }
        viewSelector.value = initialViewMode;
        updateSyncButtonState(initialViewMode);
        
        viewSelector.addEventListener("change", () => {
            const newMode = viewSelector.value;
            localStorage.setItem("ldc-view-mode", newMode);
            isCsvSelectionBodyActive = false;
            updateSyncButtonState(newMode);
            applyViewMode(panel);
        });
    }
    
    // Sync button click handler
    if (syncButton) {
        syncButton.addEventListener("click", () => {
            chrome.runtime.sendMessage({ type: "ldcSyncTabs" }, (resp) => {
                if (chrome.runtime.lastError) {
                    console.log("Unable to sync tabs right now.");
                    return;
                }
                console.log("Sync result:", resp?.message || "Sync complete.");
            });
        });
    }

    applyViewMode(panel);
    updateDeltaExportButtonState();

    //panel.querySelector("#ldc-device-dropdown").value = savedDevice;
    

    // Theme toggle
    panel.querySelectorAll("#ldc-theme-toggle .ldc-theme-icon").forEach(icon => {
        icon.addEventListener("click", () => {
            panel.querySelectorAll("#ldc-theme-toggle .ldc-theme-icon")
                .forEach(i => i.classList.remove("ldc-toggle-active"));

            icon.classList.add("ldc-toggle-active");

            const theme = icon.getAttribute("data-theme");
            localStorage.setItem("ldc-theme", theme);

            location.reload();
        });
    });

    // Desktop/Mobile toggle
    panel.querySelectorAll("#ldc-mode-toggle .ldc-toggle-option").forEach(opt => {
        opt.addEventListener("click", () => {
            const mode = opt.getAttribute("data-mode") || "desktop";
            if (mode === "mobile") return;

            panel.querySelectorAll("#ldc-mode-toggle .ldc-toggle-option")
                .forEach(o => o.classList.remove("ldc-toggle-active"));
            opt.classList.add("ldc-toggle-active");

            localStorage.setItem("ldc-mode", "desktop");

            location.reload();
        });
    });

    // Device dropdown
    /*panel.querySelector("#ldc-device-dropdown").addEventListener("change", e => {
        localStorage.setItem("ldc-device", e.target.value);
        if (localStorage.getItem("ldc-mode") === "mobile")
            location.reload();
    });*/

    // Tabs
    panel.querySelectorAll(".ldc-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            const tabName = tab.getAttribute("data-tab");

            panel.querySelectorAll(".ldc-tab").forEach(t => t.classList.remove("ldc-tab-active"));
            tab.classList.add("ldc-tab-active");

            panel.querySelectorAll(".ldc-tab-panel").forEach(p => {
                p.classList.remove("ldc-tab-panel-active");
                if (p.getAttribute("data-tab") === tabName)
                    p.classList.add("ldc-tab-panel-active");
            });

            if (tabName === "auditor" && isPerElementView())
                refreshAuditorBody();
        });
    });

    // Collapse all (top control)
    panel.querySelector("#ldc-collapse-all").addEventListener("click", () => {
        panel.querySelectorAll(".ldc-section").forEach(sec => {
            sec.classList.add("collapsed");
            const toggle = sec.querySelector(".ldc-section-toggle");
            if (toggle) toggle.textContent = "▲";
        });
    });

    const downloadDeltasButton = panel.querySelector("#ldc-download-deltas");
    if (downloadDeltasButton) {
        downloadDeltasButton.addEventListener("click", handleDeltaExcelDownloadClick);
    }

    const navigateFromCurrentSelection = (resolver) => {
        if (!currentSelector) return;

        let selected = null;
        try {
            selected = document.querySelector(currentSelector);
        } catch {
            selected = null;
        }
        if (!selected) return;

        const next = resolver(selected);
        if (!next) return;
        selectElement(next);
    };

    panel.querySelector("#ldc-dom-up")?.addEventListener("click", (e) => {
        e.stopPropagation();
        navigateFromCurrentSelection((el) => {
            if (!el.parentElement || el.parentElement === document.documentElement) return null;
            return el.parentElement;
        });
    });

    panel.querySelector("#ldc-dom-down")?.addEventListener("click", (e) => {
        e.stopPropagation();
        navigateFromCurrentSelection((el) => {
            if (!el.children || el.children.length === 0) return null;
            return el.children[0];
        });
    });

    panel.querySelector("#ldc-dom-left")?.addEventListener("click", (e) => {
        e.stopPropagation();
        navigateFromCurrentSelection((el) => el.previousElementSibling || null);
    });

    panel.querySelector("#ldc-dom-right")?.addEventListener("click", (e) => {
        e.stopPropagation();
        navigateFromCurrentSelection((el) => el.nextElementSibling || null);
    });

    // Token Finder
    const findBtn = panel.querySelector("#ldc-token-find");
    const input = panel.querySelector("#ldc-token-input");
    const results = panel.querySelector("#ldc-token-results");

    findBtn.addEventListener("click", () => {
        clearTokenHighlights();

        const token = input.value.trim();
        if (!token) {
            results.innerHTML = "Enter a token.";
            return;
        }

        const elements = findElementsUsingToken(token);

        if (elements.length === 0) {
            results.innerHTML = "No matches found.";
            return;
        }

        highlightTokenMatches(elements);

        results.innerHTML = `
            <strong>Elements using this token: (${elements.length})</strong>
            <ul style="padding-left:16px; margin-top:6px;">
                ${elements.map((el, i) => {
                    const id = el.id ? "#" + el.id : "";
                    const classList = typeof el.className === "string"
                        ? el.className.trim().split(/\s+/).filter(Boolean)
                        : [];
                    const cleanClassList = classList.filter(cls => cls !== "ldc-highlight" && cls !== "ldc-token-match");
                    const cls = cleanClassList.length > 0
                        ? "." + cleanClassList.join(".")
                        : "";
                    const label = el.tagName.toLowerCase() + id + cls;
                    return `
                        <li class="ldc-token-item" data-index="${i}" style="cursor:pointer; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                            ${isElementVisible(el) ? `<span style="opacity:0.7;">👁️</span>` : `<span style="opacity:0.2;">○</span>`}                            <span>${label}</span>
                        </li>
                    `;                
                }).join("")}
            </ul>
        `;

        // Click to inspect and focus an item.
        results.querySelectorAll(".ldc-token-item").forEach(item => {
            item.addEventListener("click", () => {
                const index = Number(item.getAttribute("data-index"));
                const el = elements[index];
                if (!el) return;

                el.scrollIntoView({ behavior: "smooth", block: "center" });
                setActiveTokenSelection(el);
                selectElement(el);
            });
        });
    });

    return panel;
}
function isElementVisible(el) {
    if (!el) return false;

    const style = window.getComputedStyle(el);

    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // Off-screen check
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;

    return true;
}

// ------------------------------
// Auditor tab update
// ------------------------------
function updateAuditorPanel() {
  const panel = getOrCreateDeltaPanel();
  const auditorPanel = panel.querySelector('.ldc-tab-panel[data-tab="auditor"]');
  const selectorNode = auditorPanel.querySelector("#ldc-selector-text");
  const sectionsNode = auditorPanel.querySelector("#ldc-auditor-sections");

  if (!selectorNode || !sectionsNode) {
    console.warn("Auditor shell nodes not found");
    return;
  }

  if (!currentCSS) {
    selectorNode.textContent = "—";
        sectionsNode.innerHTML = `
            <div style="margin-top:12px; font-size:12px; opacity:0.7;">Hover an element to audit its CSS.</div>
            ${canUseCsvSelectionBody() ? `<div class="ldc-auditor-download-entry"><button id="ldc-open-csv-selection" type="button" class="ldc-open-csv-selection-btn">Download CSV</button></div>` : ""}
        `;
        const openCsvButton = sectionsNode.querySelector("#ldc-open-csv-selection");
        if (openCsvButton) {
            openCsvButton.addEventListener("click", () => {
                isCsvSelectionBodyActive = true;
                renderDownloadCsvPanel();
            });
        }
    return;
  }

  selectorNode.textContent = currentSelector || "—";

    const isDeltaRender = isDeltaOnlyView() && isSyncMirroringActive;
    const deltaPropsForSelector = isDeltaRender
        ? deltaDiffPropsBySelector.get(currentSelector)
        : null;

    if (isDeltaRender && currentSelector && !Array.isArray(deltaPropsForSelector)) {
        sectionsNode.innerHTML = `
            <div style="margin-top:12px; font-size:12px; opacity:0.7;">
                Comparing with synced tab...
            </div>
        `;
        return;
    }

  let html = "";
  let sectionCount = 0;

  for (const category in CSS_CATEGORIES) {
    if (HIDDEN_AUDITOR_CATEGORIES.has(category)) continue;

        const props = (CSS_CATEGORIES[category] || []).filter(prop => !isAuditorPropertyHidden(category, prop));
        if (props.length === 0) continue;

        const presentProps = Object.keys(currentCSS.computed || {}).filter(p => {
            if (!props.includes(p)) return false;
            const authoredValue = currentCSS?.authored?.[p];
            const computedValue = currentCSS?.computed?.[p];
            if (p === "fill" && !isFillApplicableForElement(currentElement, authoredValue, computedValue)) {
                return false;
            }
            if (!isDeltaRender) return true;
            return deltaPropsForSelector.includes(p);
        });

    const meaningfulProps = presentProps.filter(p => {
        if (isDeltaRender) return true;
        const computedValue = currentCSS?.computed?.[p];
        const authoredValue = currentCSS?.authored?.[p];
        return hasMeaningfulValue(computedValue) || hasMeaningfulValue(authoredValue);
    });

    const finalProps = category === "Animation"
        ? meaningfulProps
        : presentProps;

    console.log("Category:", category, "presentProps:", finalProps);

    if (finalProps.length === 0) continue;

    sectionCount++;

    const top3 = finalProps.slice(0, 3);
    const rest = finalProps.slice(3);

    html += `
      <div class="ldc-section">
        <div class="ldc-section-header">
          <span>${category}</span>
          <span class="ldc-section-toggle">▼</span>
        </div>
        <div class="ldc-section-body">
    `;

    top3.forEach(prop => {
      html += renderAuditorProperty(prop);
    });

    if (rest.length > 0) {
      html += `
        <div class="ldc-see-more">
          <span class="ldc-see-more-toggle">See more…</span>
          <div class="ldc-see-more-body">
      `;

      rest.forEach(prop => {
        html += renderAuditorProperty(prop);
      });

      html += `
          </div>
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;
  }

  if (sectionCount === 0) {
        const emptyMessage = isDeltaRender
            ? "No CSS differences found for this element."
            : "No CSS properties found for this element.";

    html = `
      <div style="margin-top:12px; font-size:12px; opacity:0.7;">
                ${emptyMessage}
      </div>
    `;
  }

    if (canUseCsvSelectionBody()) {
        html += `
            <div class="ldc-auditor-download-entry">
                <button id="ldc-open-csv-selection" type="button" class="ldc-open-csv-selection-btn">Download CSV</button>
            </div>
        `;
    }

  console.log("sectionCount:", sectionCount);
  console.log("html has ldc-section?", html.includes('class="ldc-section"'));
  console.log("html preview:", html.slice(0, 1200));

  sectionsNode.innerHTML = html;

    const openCsvButton = sectionsNode.querySelector("#ldc-open-csv-selection");
    if (openCsvButton) {
        openCsvButton.addEventListener("click", () => {
            isCsvSelectionBodyActive = true;
            renderDownloadCsvPanel();
        });
    }

  // Remote sync tooltip (fixed-position, JS-driven to avoid overflow clipping)
  const tooltip = getOrCreateRemoteTooltip();
  sectionsNode.querySelectorAll(".ldc-prop-has-remote").forEach(propEl => {
    propEl.addEventListener("mouseenter", () => {
      const text = propEl.getAttribute("data-remote-tooltip");
      if (!text) return;
      tooltip.querySelector(".ldc-remote-tooltip-value").textContent = text;
      const rect = propEl.getBoundingClientRect();
      tooltip.style.display = "block";
      // Position below the row, aligned to its left edge
      let top = rect.bottom + 6;
      let left = rect.left;
      // Keep within viewport
      const tipW = tooltip.offsetWidth || 260;
      if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
      if (left < 8) left = 8;
      if (top + 60 > window.innerHeight) top = rect.top - tooltip.offsetHeight - 6;
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    });
    propEl.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });

  // Section collapse toggles
  sectionsNode.querySelectorAll(".ldc-section-toggle").forEach(toggle => {
    toggle.addEventListener("click", () => {
      const section = toggle.closest(".ldc-section");
      section.classList.toggle("collapsed");
      toggle.textContent = section.classList.contains("collapsed") ? "▲" : "▼";
    });
  });

  // See more toggles
  sectionsNode.querySelectorAll(".ldc-see-more-toggle").forEach(toggle => {
    toggle.addEventListener("click", () => {
      const wrapper = toggle.closest(".ldc-see-more");
      wrapper.classList.toggle("expanded");
      toggle.textContent = wrapper.classList.contains("expanded")
        ? "See less…"
        : "See more…";
    });
  });

  // Collapse all
  const collapseAll = auditorPanel.querySelector("#ldc-collapse-all");
  if (collapseAll) {
    collapseAll.onclick = () => {
      sectionsNode.querySelectorAll(".ldc-section").forEach(sec => {
        sec.classList.add("collapsed");
        const toggle = sec.querySelector(".ldc-section-toggle");
        if (toggle) toggle.textContent = "▲";
      });
    };
  }

}
function selectElement(el, options = {}) {
  if (!el) return;

    const sendSync = options.sendSync !== false;
  currentElement = el;
  currentSelector = getUniqueSelector(el);

        if (isDeltaOnlyView() && isSyncMirroringActive && sendSync && currentSelector) {
            setDeltaDiffData(currentSelector, null);
        }

  currentCSS = extractCSS(el);
  highlightElement(el);
    if (isPerElementView()) {
        refreshAuditorBody();
    }

    if (sendSync && syncedPeerTabId !== null && !isApplyingSyncedHighlight && currentSelector) {
        const syncPayload = { selector: currentSelector };
        if (isDeltaOnlyView() && isSyncMirroringActive) {
            syncPayload.sourceStyles = getDeltaComparableSnapshot(el);
        }
        sendSyncEvent("highlight", syncPayload);
    }
}

function renderAuditorProperty(prop) {
  const authored = currentCSS?.authored?.[prop];
  const computed = currentCSS?.computed?.[prop];

  if (authored === undefined && computed === undefined) return "";

    const el = currentElement;
console.log("AUTHORED RAW:", prop, authored);
  
    function formatColorWithHex(value) {
        if (!value) return value;
    
        // Check if value contains rgb/rgba
        if (value.match(/rgba?\(/i)) {
            const hex = rgbToHex(value);
            if (hex) {
                return `${value} → ${hex}`;
            }
        }
        return value;
    }
  
    function resolveValueChain(value, interactionState = "rest", depth = 0, chain = [], seenTokens = new Set()) {
        const normalized = normalizeStyleValue(value);
        if (!normalized || depth > 10) return chain;

        chain.push(normalized);

        const match = normalized.match(/var\(\s*(--[^,\s)]+)\s*(?:,\s*([^)]*))?\)/);
        if (!match) return chain;

        const token = match[1];
        const fallback = normalizeStyleValue(match[2] || "");

        if (seenTokens.has(token)) return chain;
        seenTokens.add(token);

        const authoredTokenValue = findAuthoredCSS(el, token, { state: interactionState });
        let nextValue = normalizeStyleValue(authoredTokenValue);

        if (!nextValue) {
            try {
                nextValue = normalizeStyleValue(getComputedStyle(el).getPropertyValue(token));
            } catch {
                nextValue = "";
            }
        }

        if (!nextValue) {
            nextValue = fallback;
        }

        if (!nextValue) return chain;
        return resolveValueChain(nextValue, interactionState, depth + 1, chain, seenTokens);
    }

    function getTerminalValueFromChain(chain, fallbackValue = "") {
        const terminal = normalizeStyleValue(chain?.[chain.length - 1] || "");
        return terminal || normalizeStyleValue(fallbackValue);
    }

    function formatChainDisplay(chain, fallbackTerminalValue = "") {
        const values = Array.isArray(chain) ? [...chain] : [];
        const terminal = normalizeStyleValue(fallbackTerminalValue);
        const last = normalizeStyleValue(values[values.length - 1] || "");

        if (terminal && terminal !== last) {
            values.push(terminal);
        }

        if (values.length === 0) return "—";
        return values.map(v => formatColorWithHex(v)).join(" -> ");
    }

    function splitTransitionList(value) {
        return String(value || "")
            .split(",")
            .map(v => normalizeStyleValue(v))
            .filter(Boolean);
    }

    function splitCssListPreservingFunctions(value) {
        const text = String(value || "");
        const parts = [];
        let depth = 0;
        let start = 0;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === "(") depth += 1;
            else if (ch === ")") depth = Math.max(0, depth - 1);
            else if (ch === "," && depth === 0) {
                parts.push(text.slice(start, i));
                start = i + 1;
            }
        }

        parts.push(text.slice(start));
        return parts.map(v => normalizeStyleValue(v)).filter(Boolean);
    }

    function tokenizeCssValuePreservingFunctions(value) {
        const text = String(value || "").trim();
        if (!text) return [];

        const tokens = [];
        let depth = 0;
        let token = "";

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === "(") {
                depth += 1;
                token += ch;
                continue;
            }
            if (ch === ")") {
                depth = Math.max(0, depth - 1);
                token += ch;
                continue;
            }
            if (/\s/.test(ch) && depth === 0) {
                if (token) {
                    tokens.push(token);
                    token = "";
                }
                continue;
            }
            token += ch;
        }

        if (token) tokens.push(token);
        return tokens;
    }

    function parseTransitionEntry(entry) {
        const tokens = tokenizeCssValuePreservingFunctions(entry);
        const easingKeywords = new Set([
            "ease", "linear", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"
        ]);

        const parsed = {
            property: "",
            duration: "",
            timingFunction: "",
            delay: "",
            behavior: ""
        };

        function isTimeToken(token) {
            if (!token) return false;
            if (/^-?\d*\.?\d+m?s$/i.test(token)) return true;
            if (/^var\(/i.test(token) && /duration|delay/i.test(token)) return true;
            return false;
        }

        function isTimingToken(token) {
            if (!token) return false;
            const lower = token.toLowerCase();
            if (easingKeywords.has(lower)) return true;
            if (lower.startsWith("cubic-bezier(") || lower.startsWith("steps(") || lower.startsWith("linear(")) return true;
            if (/^var\(/i.test(token) && /ease|easing|timing/i.test(token)) return true;
            return false;
        }

        for (const token of tokens) {
            if (!parsed.duration && isTimeToken(token)) {
                parsed.duration = token;
                continue;
            }
            if (!parsed.timingFunction && isTimingToken(token)) {
                parsed.timingFunction = token;
                continue;
            }
            if (parsed.duration && !parsed.delay && isTimeToken(token)) {
                parsed.delay = token;
                continue;
            }
            if (!parsed.behavior && token.toLowerCase() === "allow-discrete") {
                parsed.behavior = token;
                continue;
            }
            if (!parsed.property) {
                parsed.property = token;
            }
        }

        parsed.property = parsed.property || "all";
        parsed.duration = parsed.duration || "0s";
        parsed.timingFunction = parsed.timingFunction || "ease";
        parsed.delay = parsed.delay || "0s";
        return parsed;
    }

    function parseTransitionShorthand(value) {
        const entries = splitCssListPreservingFunctions(value);
        if (entries.length === 0) return null;
        return entries.map(parseTransitionEntry);
    }

    function pickTransitionEntry(list, index) {
        if (!Array.isArray(list) || list.length === 0) return "";
        return list[Math.min(index, list.length - 1)] || "";
    }

    function buildTransitionFromLonghands() {
        const propertyValue = normalizeStyleValue(currentCSS?.computed?.["transition-property"] || "");
        const durationValue = normalizeStyleValue(currentCSS?.computed?.["transition-duration"] || "");
        const timingValue = normalizeStyleValue(currentCSS?.computed?.["transition-timing-function"] || "");
        const delayValue = normalizeStyleValue(currentCSS?.computed?.["transition-delay"] || "");

        if (!propertyValue && !durationValue && !timingValue && !delayValue) return "";

        const properties = splitTransitionList(propertyValue || "all");
        const durations = splitTransitionList(durationValue || "0s");
        const timings = splitTransitionList(timingValue || "ease");
        const delays = splitTransitionList(delayValue || "0s");

        let index = 0;
        const boxShadowIndex = properties.findIndex(item => /(^|\s)box-shadow(\s|$)/i.test(item));
        if (boxShadowIndex >= 0) index = boxShadowIndex;

        const p = pickTransitionEntry(properties, index) || "all";
        const d = pickTransitionEntry(durations, index) || "0s";
        const t = pickTransitionEntry(timings, index) || "ease";
        const de = pickTransitionEntry(delays, index) || "0s";

        return normalizeStyleValue(`${p} ${d} ${t}${de !== "0s" ? ` ${de}` : ""}`);
    }

    const resolvedTransitionComponents = resolveTransitionComponentsFromCascade(el, "rest");
    const resolvedTransitionDisplay = buildTransitionDisplayFromComponents(resolvedTransitionComponents);
    const interactionStateKeys = ["hover", "active", "focus", "disabled"];
    const strictStateAuthoredValues = Object.fromEntries(
        interactionStateKeys.map(stateKey => [
            stateKey,
            prop === "transition"
                ? resolveAuthoredTransitionValue(el, stateKey)
                : findAuthoredCSS(el, prop, { state: stateKey, strictState: true })
        ])
    );

    // Main row should represent only the at-rest value captured at selection time.
    let restAuthored = authored || findAuthoredCSS(el, prop, { state: "rest" }) || "";

    if (prop === "transition-property" && resolvedTransitionComponents["transition-property"]) {
        restAuthored = resolvedTransitionComponents["transition-property"];
    }
    if (prop === "transition-duration" && resolvedTransitionComponents["transition-duration"]) {
        restAuthored = resolvedTransitionComponents["transition-duration"];
    }
    if (prop === "transition-timing-function" && resolvedTransitionComponents["transition-timing-function"]) {
        restAuthored = resolvedTransitionComponents["transition-timing-function"];
    }
    if (prop === "transition-delay" && resolvedTransitionComponents["transition-delay"]) {
        restAuthored = resolvedTransitionComponents["transition-delay"];
    }

    if (prop === "transition") {
        if (resolvedTransitionDisplay) {
            restAuthored = resolvedTransitionDisplay;
        } else {
            const transitionFromLonghands = buildTransitionFromLonghands();
            if (transitionFromLonghands) {
                restAuthored = transitionFromLonghands;
            }
        }
    }

    const authoredRaw = normalizeStyleValue(authored || "");
    const computedRaw = normalizeStyleValue(computed || "");
    if (prop === "background-color" && !authoredRaw && isTransparentColorValue(computedRaw)) {
        restAuthored = "transparent";
    }

    const hasStrictInteractionState = Object.values(strictStateAuthoredValues).some(value => normalizeStyleValue(value));
    if (!normalizeStyleValue(restAuthored) && hasStrictInteractionState) {
        const defaultRestValue = getDefaultAuditValue(prop);
        if (defaultRestValue) {
            restAuthored = defaultRestValue;
        }
    }

    const stateBadges = getPropertyStateBadges(el, prop, authoredRaw || restAuthored, computedRaw);
    const badgesHtml = stateBadges.length > 0
        ? `<span class="ldc-prop-badges">${stateBadges.map(tag => {
            if (tag === "inherited") {
                return `<span class="ldc-prop-badge ldc-prop-badge-inherited" title="Inherited from parent">i</span>`;
            }
            return `<span class="ldc-prop-badge">${escapeHtml(tag)}</span>`;
        }).join("")}</span>`
        : "";
    const isTransitionProperty = prop === "transition" || prop.startsWith("transition-");
    const restChain = isTransitionProperty
        ? []
        : resolveValueChain(restAuthored || computed || "", "rest");
    const restTerminal = isTransitionProperty
        ? normalizeStyleValue(restAuthored || computed || "")
        : getTerminalValueFromChain(restChain, computed || restAuthored);
    const display = isTransitionProperty
        ? (restTerminal || "—")
        : formatChainDisplay(restChain, restTerminal);

  // Build remote tooltip for SBS modes (dropdown 2 and 3) when sync is active
  let remoteTooltipHtml = "";
  if (isSbsModeView() && isSyncMirroringActive) {
    const diffRows = deltaDiffRowsBySelector.get(currentSelector) || [];
    const diffRow = diffRows.find(r => r.property === prop);

    if (diffRow) {
      const currentTheme = getEffectiveTheme();
      // The remote tab has the opposite theme in SBS layout
      const remoteComputedValue = currentTheme === "light" ? diffRow.darkValue : diffRow.lightValue;
      const remoteTokenValue = currentTheme === "light" ? diffRow.darkTokenValue : diffRow.lightTokenValue;

      if (remoteComputedValue) {
        let remoteDisplay = remoteComputedValue;
        if (remoteTokenValue) {
                    // Resolve intermediate var() token names from chain (up to 3 levels),
                    // then anchor to the actual remote computed value for accuracy.
                    const chain = resolveValueChain(remoteTokenValue, "rest");
                    const varParts = chain.filter(v => v.includes("var(")).slice(0, 3);
                    const parts = [
                        ...varParts.map(v => formatColorWithHex(v)),
                        formatColorWithHex(remoteComputedValue)
                    ];
                    remoteDisplay = parts.join(" -> ");
                } else {
                    remoteDisplay = formatColorWithHex(remoteComputedValue);
                }
                remoteTooltipHtml = remoteDisplay;
      }
    }
  }

    const stateVariants = [];
    const seenStateVariantValues = new Set();
    interactionStateKeys.forEach(stateKey => {
        const stateAuthored = strictStateAuthoredValues[stateKey];
        if (!stateAuthored) return;

        const stateChain = isTransitionProperty ? [] : resolveValueChain(stateAuthored, stateKey);
        const stateResolvedValue = isTransitionProperty
            ? normalizeStyleValue(stateAuthored)
            : getTerminalValueFromChain(stateChain, stateAuthored);
        const comparable = `${normalizeStyleValue(stateAuthored)}|${normalizeStyleValue(stateResolvedValue)}`;
        if (!comparable) return;
        if (seenStateVariantValues.has(comparable)) return;

        seenStateVariantValues.add(comparable);

        const stateDisplay = isTransitionProperty
            ? (stateResolvedValue || "—")
            : formatChainDisplay(stateChain, stateResolvedValue);
        stateVariants.push(`(${getInteractionStateDisplayName(stateKey)}) ${stateDisplay}`);
    });

    const stateVariantsHtml = stateVariants.length > 0
        ? `<ul class="ldc-state-variants">${stateVariants.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : "";

  const hasSyncTooltip = remoteTooltipHtml !== "";

  return `
    <div class="ldc-prop${hasSyncTooltip ? " ldc-prop-has-remote" : ""}" ${hasSyncTooltip ? `data-remote-tooltip="${escapeHtml(remoteTooltipHtml)}"` : ""}>
      <b>${prop}:</b><br>
                        <span>${display}${badgesHtml}${stateVariantsHtml}</span>
    </div>
  `;
}

// ------------------------------
// Token Finder helpers
// ------------------------------
function findElementsUsingToken(token) {
    const matches = [];

    document.querySelectorAll("body *").forEach(el => {
        if (isExtensionPanelElement(el)) return;

        if (hasDirectTokenUsage(el, token)) {
            matches.push(el);
        }
    });

    return matches;
}

function isExtensionPanelElement(el) {
    return Boolean(el?.closest?.("#ldc-delta-panel"));
}

function hasDirectTokenUsage(el, token) {
    if (!el || !token) return false;

    // Inline style on element itself.
    const inlineStyle = el.getAttribute("style") || "";
    if (inlineStyle.includes(token)) return true;

    // Rules that directly match this element.
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;

        for (const rule of rules) {
            if (!rule.selectorText || !rule.style) continue;
            if (!rule.style.cssText || !rule.style.cssText.includes(token)) continue;

            try {
                if (el.matches(rule.selectorText)) {
                    return true;
                }
            } catch {
                // Skip selectors unsupported by matches() in current context.
            }
        }
    }

    return false;
}


function highlightTokenMatches(elements) {
    clearTokenSelection();
    activeTokenMatches = elements.slice();
    activeTokenMatches.forEach(el => el.classList.add("ldc-token-match"));
}

function clearTokenHighlights() {
    clearTokenSelection();
    activeTokenMatches.forEach(el => el.classList.remove("ldc-token-match"));
    activeTokenMatches = [];
}

function setActiveTokenSelection(el) {
    if (!el) return;
    if (activeTokenSelection && activeTokenSelection !== el) {
        activeTokenSelection.classList.remove("ldc-token-match-active");
    }
    activeTokenSelection = el;
    activeTokenSelection.classList.add("ldc-token-match-active");
}

function clearTokenSelection() {
    if (!activeTokenSelection) return;
    activeTokenSelection.classList.remove("ldc-token-match-active");
    activeTokenSelection = null;
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getOrCreateRemoteTooltip() {
    let tip = document.getElementById("ldc-remote-tooltip");
    if (tip) return tip;

    tip = document.createElement("div");
    tip.id = "ldc-remote-tooltip";
    tip.innerHTML = `<span class="ldc-remote-tooltip-label">Synced tab:</span><span class="ldc-remote-tooltip-value"></span>`;
    tip.style.display = "none";
    document.documentElement.appendChild(tip);
    return tip;
}

function rgbToHex(rgb) {
  if (!rgb || typeof rgb !== "string") return null;

  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;

  const r = parseInt(match[1], 10).toString(16).padStart(2, "0");
  const g = parseInt(match[2], 10).toString(16).padStart(2, "0");
  const b = parseInt(match[3], 10).toString(16).padStart(2, "0");

  return `#${r}${g}${b}`.toUpperCase();
}
