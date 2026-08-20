const DEFAULTS = {
  mouseBack: true,
  keyBack: true,
  protectPinned: true,
  keepLastTab: false,
  openerOnly: false,
  instantShortcut: false,
};

const boxes = Object.keys(DEFAULTS).map((key) => [key, document.getElementById(key)]);

chrome.storage.sync.get(DEFAULTS).then((stored) => {
  for (const [key, box] of boxes) box.checked = Boolean(stored[key]);
});

for (const [key, box] of boxes) {
  box.addEventListener("change", () => {
    chrome.storage.sync.set({ [key]: box.checked });
  });
}
