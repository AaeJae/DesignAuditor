const syncedTabPeers = new Map();

function clearSyncPair(tabId) {
    const peerId = syncedTabPeers.get(tabId);
    syncedTabPeers.delete(tabId);

    if (typeof peerId === "number") {
        syncedTabPeers.delete(peerId);
        chrome.tabs.sendMessage(peerId, { type: "ldcSyncStopped" }, () => {
            // Ignore delivery errors when peer tab is unavailable.
            chrome.runtime.lastError; // Suppress unchecked error warning
        });
    }
}

chrome.tabs.onRemoved.addListener((tabId) => {
    clearSyncPair(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "togglePanel") {
        chrome.tabs.sendMessage(sender.tab.id, { type: "togglePanel" });
        return;
    }

    if (msg.type === "ldcSyncTabs") {
        chrome.tabs.query({ currentWindow: true, highlighted: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, message: "Unable to read selected tabs." });
                return;
            }

            if (!tabs || tabs.length !== 2) {
                const count = tabs ? tabs.length : 0;
                sendResponse({
                    ok: false,
                    message: `Select exactly 2 tabs using Ctrl+click (currently ${count}).`
                });
                return;
            }

            const firstTabId = tabs[0]?.id;
            const secondTabId = tabs[1]?.id;

            if (typeof firstTabId !== "number" || typeof secondTabId !== "number") {
                sendResponse({ ok: false, message: "Unable to determine selected tab IDs." });
                return;
            }

            clearSyncPair(firstTabId);
            clearSyncPair(secondTabId);

            syncedTabPeers.set(firstTabId, secondTabId);
            syncedTabPeers.set(secondTabId, firstTabId);

            chrome.tabs.sendMessage(firstTabId, { type: "ldcSyncActivated", peerTabId: secondTabId }, () => {
                // Ignore delivery errors for non-scriptable pages.
                chrome.runtime.lastError; // Suppress unchecked error warning
            });

            chrome.tabs.sendMessage(secondTabId, { type: "ldcSyncActivated", peerTabId: firstTabId }, () => {
                // Ignore delivery errors for non-scriptable pages.
                chrome.runtime.lastError; // Suppress unchecked error warning
            });

            sendResponse({
                ok: true,
                message: "Tabs synced. Scroll and highlighting are now mirrored."
            });
        });

        return true;
    }

    if (msg.type === "ldcSyncEvent") {
        const sourceTabId = sender?.tab?.id;
        if (typeof sourceTabId !== "number") return;

        const peerTabId = syncedTabPeers.get(sourceTabId);
        if (typeof peerTabId !== "number") return;

        chrome.tabs.sendMessage(peerTabId, {
            type: "ldcApplySyncEvent",
            eventType: msg.eventType,
            payload: msg.payload || {}
        }, () => {
            // Ignore delivery errors if target tab is not scriptable.
            chrome.runtime.lastError; // Suppress unchecked error warning
        });
    }
});
