# Back to Close Tab

A Chromium extension (Chrome, Vivaldi, Edge, Brave): pressing **Back** when the
tab has no back history left closes the tab instead of doing nothing.

## Install

1. Open `vivaldi://extensions` (or `chrome://extensions`)
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder

No further configuration. `⌘←`, `⌘[` and the mouse back button all work as they
are — you do **not** need to rebind anything in Vivaldi.

## What it can and cannot hook

Extensions get no access to the browser's own UI, so:

| Back trigger | Works? |
| --- | --- |
| Mouse back button over a page | Yes |
| `⌘←` while a page has focus | Yes |
| `⌘[` while a page has focus | Yes |
| Extension shortcut you assign yourself | Yes, on every page |
| Toolbar **‹** button | **No** — extensions cannot see clicks on browser UI |
| Two-finger swipe back | **No** — the gesture never reaches the page |

The first three need a page in focus, and cannot work where extensions are not
allowed to run: `vivaldi://…`, the Chrome Web Store, the PDF viewer, the start
page. Assigning a shortcut (below) covers those.

If nothing happens for you, the likely reason is that you are using the toolbar
button or the trackpad swipe. Check with the mouse button or `⌘←` on an ordinary
web page first.

## If your mouse button does nothing

Mouse software often intercepts the thumb buttons and replays something else
instead of passing the raw button through, so the page never sees a back button
at all. Logitech Options+ does this: its **Back** preset for a button is a
*macro playback*, not a passthrough.

Check what your button actually emits — open any page's console and run

```js
addEventListener('mousedown', e => console.log('mousedown button', e.button))
addEventListener('keydown', e => console.log('keydown', e.key, 'meta=' + e.metaKey))
```

then press the button. `button 3`, or a `⌘[` / `⌘←` keydown, are all handled.
If nothing is logged, your mouse software is sending something the page cannot
observe.

### Logitech Options+ (confirmed fix)

Options+ applies a per-application profile, so fix it for Vivaldi only:

1. Open Options+ → add an application profile for **Vivaldi**
2. Assign the back thumb button the keystroke **`⌘[`**

That replaces the opaque *Back* macro with a real keystroke, which the page
receives as a normal `keydown` and the extension handles. Nothing else to
configure — no extension shortcut, no instant mode.

Confirmed working on a Logitech M720 Triathlon.

### Route that always works

If your mouse software has no per-app profiles, or the above is not available:

1. In your mouse software, assign the button a **custom keystroke** that Vivaldi
   does not already use — `⌃⌥⌘B` is a safe choice.
2. In `vivaldi://extensions/shortcuts`, assign that same combo to *Back to Close Tab*.
3. In the extension's options, turn on **Assigned shortcut responds instantly**.

This path does not depend on the page seeing anything, so it also works on
`vivaldi://` pages, the start page and the PDF viewer.

## Optional keyboard shortcut

The extension ships with **no** key bound, on purpose — auto-claiming a key
Vivaldi already uses makes both act, which sends you back two pages. To assign
one, open `vivaldi://extensions/shortcuts` and set a key on *Back to Close Tab*.

Assigning a key Vivaldi already uses for Back is safe: Vivaldi navigates, the
extension notices and stands down. Nothing needs to be unbound.

## Options

Right-click the extension → **Options**:

- **Mouse back button** — on
- **In-page ⌘[ / ⌘←** — on
- **Never close pinned tabs** — on
- **Never close the last tab in a window** — off (so the window closes with it)
- **Only close tabs opened from another tab** — off
- **Assigned shortcut responds instantly** — off. Turn on only when the key you
  assigned is not also a Vivaldi shortcut (see above); it removes a ~0.25s delay.

A closed tab comes back with `⌘⇧T`.

## How it decides

The extension never guesses whether back history exists — a wrong guess closes a
tab that should have navigated. (`history.length` cannot tell "no back history"
from "already went back", and `navigation.canGoBack` reports false for every
cross-origin entry, so both would close tabs constantly.) Instead:

1. A page-level listener notices the back gesture and reports it. It never calls
   `preventDefault()`, so Vivaldi's own back behaviour is untouched.
2. The service worker watches that tab for ~250 ms (`WATCH_MS` in
   `background.js`). If a top-frame navigation starts, Vivaldi handled it and
   the extension stops there. This is what makes double-handling impossible.
3. If nothing navigated, it calls `chrome.tabs.goBack()`. That call is the
   ground truth: it navigates if there was history, and rejects with
   *"Cannot find a next page in history"* if not — the only case that closes
   the tab.

Step 3 also covers the reverse: if Vivaldi did not act on the gesture at all,
the extension performs the back navigation itself.

## Tests

```bash
./test/test.sh
```

Launches Vivaldi with a throwaway profile (your real profile is untouched),
side-loads the extension over the CDP pipe, and drives real input events against
a local test site. `BROWSER_BIN=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome`
switches browsers — though Chrome 137+ blocks the side-load path this uses.

There is a second, optional suite that drives the browser with **real macOS
input events** (CGEvent) rather than CDP injection — the same layer a mouse
driver operates at, and below the browser's own shortcut handling, which CDP
injection bypasses:

```bash
./test/os-input/run.sh
```

It needs Accessibility permission for your terminal. It is what caught the
mouse-hold bug below, so it is worth running after changes to `content.js`.

Verified 18/18 in **both** Vivaldi 8.1.4087.68 (Chromium 150) and Chrome
151.0.7922.138, plus 8/8 real-input in each:

```
PASS  page receives button-3 mousedown
PASS  page receives Cmd+Left keydown
PASS  Cmd+Left with history goes back EXACTLY one page
PASS  mouse back with history goes back EXACTLY one page
PASS  mouse back, no history -> tab closes
PASS  back to first entry then back again -> tab closes
PASS  SPA pushState back navigates in-document, no close
PASS  with in-page key trigger OFF, Cmd+Left still closes (= command path)
PASS  Cmd+[ with history goes back EXACTLY one page
PASS  Cmd+[ with no history -> tab closes
PASS  pinned tab with no history is NOT closed
PASS  registered command shortcut
PASS  mouse back held 50ms goes back EXACTLY one page
PASS  mouse back held 300ms goes back EXACTLY one page
PASS  mouse back held 700ms goes back EXACTLY one page
PASS  mouse back held 1500ms goes back EXACTLY one page
PASS  command path: guarded mode closes a no-history tab
PASS  command path: instant mode goes back one page
```

and with real OS-level input, 8/8 — including `mousedown button=3`, `⌘[` and
`⌘←` all reaching the page, and each closing a no-history tab.

### Why the gesture is timed from mouse-up

The browser navigates back on mouse **up**. Timing the watch window from mouse
**down** meant any press held longer than 250 ms expired the window while the
button was still down, so the extension navigated and then the browser did too:

| hold | result before the fix |
| --- | --- |
| 50 ms | one page back |
| 300 ms | **two pages back** |
| 700 ms | **two pages back** |

A deliberate press easily exceeds 250 ms, so this hit constantly. The gesture is
now reported on release, with the press timestamp sent along so the worker also
recognises a navigation that happened during the hold.

## Publishing

```bash
./build.sh
```

produces `dist/back-to-close-tab-<version>.zip` — runtime files only, no tests or
docs. See [store/STORE.md](store/STORE.md) for the listing copy, the permission
justifications, and the submission checklist.

The extension requests only `tabs`, `webNavigation` and `storage`. It does *not*
declare `host_permissions`: `chrome.tabs.goBack()` works without it (verified by
the suite passing with it removed). Broad host access still appears at install,
because the content script matches `<all_urls>` — that is unavoidable for an
extension that must notice a gesture on any page.

## Files

- `manifest.json` — MV3 manifest, permissions, command
- `background.js` — navigation bookkeeping and the back-or-close decision
- `content.js` — in-page gesture detection (observe only)
- `options.html` / `options.js` — settings
- `test/` — CDP end-to-end harness
- `test/os-input/` — optional real-macOS-input harness
- `build.sh` — produces the Web Store upload zip
- `store/` — listing copy, permission justifications, screenshot
- `PRIVACY.md`, `LICENSE`
