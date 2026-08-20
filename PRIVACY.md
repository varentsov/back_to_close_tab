# Privacy Policy — Back to Close Tab

_Last updated: 2026-08-20_

**Back to Close Tab does not collect, transmit, or sell any data.**

## What the extension stores

Your five on/off preferences (which triggers are active, whether pinned tabs and
the last tab are protected, and so on). They are stored with `chrome.storage.sync`,
which keeps them in your own browser profile and, if you have Chrome Sync enabled,
syncs them across your own signed-in browsers. The developer has no access to them.

## What the extension reads

A content script runs on pages to watch for a back gesture — a mouse back button
press, or `⌘[` / `⌘←` / `Alt+←`. It inspects only the button number and key of
those events. It does not read page content, form fields, passwords, or browsing
history, and it sends nothing anywhere.

The extension uses the `webNavigation` permission to notice when a tab starts
navigating, which is how it tells "the browser already went back" from "there was
nowhere to go". Navigation events are held in memory only, as a single timestamp
per tab, and are discarded when the tab closes.

## Network

The extension makes no network requests. It contains no analytics, no tracking,
no remote code, and no third-party libraries.

## Contact

Questions: open an issue on the project repository.
