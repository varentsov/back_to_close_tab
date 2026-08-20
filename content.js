// Back to Close Tab - in-page trigger detection.
//
// This script only *observes*. It never calls preventDefault(), so a normal
// back gesture keeps its native behaviour and the browser stays in charge of
// navigating. The service worker decides whether anything else needs to happen.

(() => {
  const EDITABLE = /^(?:input|textarea|select)$/i;

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    return EDITABLE.test(target.tagName) || target.isContentEditable === true;
  }

  function report(source, since) {
    try {
      chrome.runtime.sendMessage({ type: "back-gesture", source, since: since || Date.now() });
    } catch {
      /* extension reloaded / context invalidated */
    }
  }

  // Bubble phase on window: page handlers have already run, so a page that
  // handles the gesture itself (defaultPrevented, or stopPropagation) is left
  // alone.
  //
  // The browser navigates back on mouse *up*, not down, so the gesture is
  // reported on release. Reporting on press would start the watch window while
  // the button is still held, and any press longer than the window would run
  // the extension and the browser both, going back two pages. The press time
  // rides along so the worker can also recognise a navigation that happened
  // during the hold.
  let pressedAt = 0;

  window.addEventListener("mousedown", (event) => {
    if (event.button !== 3 || event.defaultPrevented) return; // 3 = back / X1
    pressedAt = Date.now();
  });

  window.addEventListener("mouseup", (event) => {
    if (event.button !== 3 || event.defaultPrevented) return;
    const since = pressedAt || Date.now();
    pressedAt = 0;
    report("mouse", since);
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.defaultPrevented) return;
    if (isTyping(event.target)) return;

    const onlyCmd = event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const onlyAlt = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;

    const isBack =
      (onlyCmd && (event.code === "BracketLeft" || event.key === "ArrowLeft")) ||
      (onlyAlt && event.key === "ArrowLeft");

    if (isBack) report("key", Date.now());
  });
})();
