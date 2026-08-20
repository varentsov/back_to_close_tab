// Back to Close Tab - service worker.
//
// Strategy: we never guess whether a tab has back history. We observe a "back
// gesture", give the browser a moment to handle it natively, and only if the
// browser did nothing do we probe with chrome.tabs.goBack(). That probe is the
// ground truth: it navigates if there is history, and rejects if there is not,
// in which case we close the tab.

const DEFAULTS = {
  mouseBack: true,     // react to the mouse back button (button 3) inside pages
  keyBack: true,       // react to Cmd+[ / Cmd+Left inside pages
  protectPinned: true, // never close a pinned tab
  keepLastTab: false,  // never close the last tab of a window
  openerOnly: false,   // only close tabs that were opened from another tab
  instantShortcut: false, // assigned shortcut acts with no watch window
};

// How long a native navigation is allowed to start after the gesture before we
// conclude the browser had nowhere to go.
const WATCH_MS = 250;
// A navigation that started just *before* the gesture message reached us also
// counts as "the browser handled it" (some gestures navigate on mousedown, and
// the message is asynchronous).
const RECENT_NAV_MS = 500;

let settings = { ...DEFAULTS };

const ready = chrome.storage.sync.get(DEFAULTS).then((stored) => {
  settings = { ...DEFAULTS, ...stored };
}).catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in DEFAULTS) settings[key] = newValue;
  }
});

// --- navigation bookkeeping -------------------------------------------------

/** @type {Map<number, number>} tabId -> timestamp of last top-frame navigation */
const lastNav = new Map();
/** @type {Set<number>} tabs with a gesture already being evaluated */
const pending = new Set();

function noteNav(details) {
  if (details.frameId !== 0) return;
  lastNav.set(details.tabId, Date.now());
}

// onBeforeNavigate fires within a few ms of the gesture, so it is the signal
// that keeps the watch window short. The others cover same-document history
// navigations (SPA back), which never fire onBeforeNavigate.
chrome.webNavigation.onBeforeNavigate.addListener(noteNav);
chrome.webNavigation.onCommitted.addListener(noteNav);
chrome.webNavigation.onHistoryStateUpdated.addListener(noteNav);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(noteNav);

chrome.tabs.onRemoved.addListener((tabId) => {
  lastNav.delete(tabId);
  pending.delete(tabId);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- core -------------------------------------------------------------------

async function handleBackGesture(tabId, since = Date.now()) {
  if (pending.has(tabId)) return;

  const before = lastNav.get(tabId) || 0;
  // Navigated at any point since the gesture began - i.e. during a long button
  // hold - so the browser has already handled it.
  if (before >= since - 100) return;
  if (Date.now() - before < RECENT_NAV_MS) return; // navigated just beforehand

  pending.add(tabId);
  try {
    await sleep(WATCH_MS);
    if ((lastNav.get(tabId) || 0) > before) return; // browser handled it
    await backOrClose(tabId);
  } finally {
    pending.delete(tabId);
  }
}

async function backOrClose(tabId) {
  try {
    await chrome.tabs.goBack(tabId);
    return; // there was history after all; we navigated
  } catch (error) {
    const message = String((error && error.message) || error);
    // Chromium answers "Cannot find a next page in history." when the tab is at
    // the first entry. Anything else (tab gone, restricted page) is not our cue
    // to close something.
    if (!/history|previous page/i.test(message)) return;
  }
  await closeTab(tabId);
}

async function closeTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (settings.protectPinned && tab.pinned) return;
  if (settings.openerOnly && tab.openerTabId === undefined) return;
  if (settings.keepLastTab) {
    const siblings = await chrome.tabs.query({ windowId: tab.windowId });
    if (siblings.length <= 1) return;
  }
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* tab already gone */
  }
}

// --- triggers ---------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "back-gesture") return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId === undefined) return;
  (async () => {
    await ready;
    if (message.source === "mouse" && !settings.mouseBack) return;
    if (message.source === "key" && !settings.keyBack) return;
    await handleBackGesture(tabId, message.since);
  })();
});

// Optional keyboard shortcut, unbound until the user assigns one at
// vivaldi://extensions/shortcuts. It goes through the same watch window as the
// in-page triggers, so assigning a key Vivaldi already uses for Back is safe:
// Vivaldi navigates, the watcher sees it, and the extension stands down.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "back-or-close") return;
  await ready;
  let tabId = tab && tab.id;
  if (tabId === undefined) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = active && active.id;
  }
  if (tabId === undefined) return;
  // A shortcut Vivaldi does not itself use (e.g. one coming from a remapped
  // mouse button) has no native navigation to wait for, so skip the window.
  if (settings.instantShortcut) await backOrClose(tabId);
  else await handleBackGesture(tabId);
});
