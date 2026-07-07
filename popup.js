document.addEventListener("DOMContentLoaded", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tabId = tabs?.[0]?.id;
        if (typeof tabId !== "number") {
            window.close();
            return;
        }

        chrome.tabs.sendMessage(tabId, { type: "ensurePanelOpen" }, () => {
            // Clear the error if the message failed (e.g., content script not loaded on this tab)
            if (chrome.runtime.lastError) {
                console.log("Content script not ready on this tab.");
            }
            window.close();
        });
    });
});
