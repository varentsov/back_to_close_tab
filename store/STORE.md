# Chrome Web Store submission

Build the upload: `./build.sh` → `dist/back-to-close-tab-<version>.zip`

## Listing

**Name:** Back to Close Tab

**Short description** (132 char max — this is 79):
> Pressing Back with no back history left closes the tab instead of doing nothing.

**Category:** Workflow & Planning · **Language:** English

**Detailed description:**
> Open a link in a new tab, read it, press Back — and nothing happens, because
> there is nowhere to go back to. Back to Close Tab closes the tab instead.
>
> It works with the mouse back button and with ⌘[ / ⌘← (Alt+← on Windows and
> Linux). You can also assign your own shortcut.
>
> It never closes a tab that still has history. Rather than guessing, it lets the
> browser navigate first and only steps in when the browser had nowhere to go, so
> a normal Back keeps working exactly as before.
>
> • Pinned tabs are protected by default
> • Optionally keep the last tab in a window, or only close tabs opened from another tab
> • Closed a tab by accident? ⌘⇧T / Ctrl+Shift+T brings it back
> • No data collected, no network requests, no third-party code
>
> Note: browser extensions cannot see clicks on the toolbar Back button or the
> trackpad swipe-back gesture — no extension can. Use the mouse button, the
> keyboard shortcut, or one you assign.

## Single purpose

> Close the current tab when the user triggers Back and the tab has no back
> history remaining.

## Permission justifications

**tabs**
> Required to act on the tab the user pressed Back in: chrome.tabs.goBack() to
> perform the back navigation, and chrome.tabs.remove() to close the tab when
> there is no back history. Also reads the tab's pinned state and window so the
> user's "never close pinned tabs" and "never close the last tab" options work.

**webNavigation**
> Used to detect whether the browser has itself started a back navigation in that
> tab. This is what prevents double navigation: if the browser handled the Back
> gesture, the extension does nothing. Only a single timestamp per tab is kept in
> memory, and it is discarded when the tab closes. No URLs are stored or sent.

**storage**
> Stores the user's five on/off preferences from the options page. Nothing else
> is stored, and nothing leaves the browser.

**Host access (content script on all sites)**
> A content script must run on pages to notice a back gesture — a mouse back
> button press or ⌘[ / ⌘← / Alt+←. It inspects only the button number and key of
> those events. It reads no page content, no form data and no URLs, and makes no
> network requests. Back gestures can happen on any site, so the script cannot be
> limited to a fixed list of hosts.

**Remote code:** No. All code is in the package; no third-party libraries.

## Privacy disclosures

Tick **no** for every data-collection category. The extension collects nothing.
`PRIVACY.md` in the repo is publishable as the privacy policy URL if you host it
(a policy URL is only required if you declare data collection, but having one
does no harm).

## Assets

- [x] Icon 128×128 — `icons/icon128.png` (in the package)
- [x] Screenshot 1280×800 — `store/screenshot-1280x800.png`
- [ ] Small promo tile 440×280 — optional, only needed for featuring

## Before you submit

- [ ] One-time $5 developer registration at the Developer Dashboard
- [ ] `./build.sh` and upload `dist/back-to-close-tab-<version>.zip`
- [ ] Bump `version` in `manifest.json` for every subsequent upload — the store
      rejects a re-used version number

## Review expectations

Broad host access ("on all sites") puts the submission into slower, stricter
review, and the justification above is the part that gets read. First review of
a new extension commonly takes several days; it can run longer. Nothing here
uses remote code or collects data, which are the usual rejection triggers.
