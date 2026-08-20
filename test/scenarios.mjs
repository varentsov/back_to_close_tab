const PORT = process.env.CDP_PORT || 9333;
const EXT_ID = process.env.EXT_ID;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const listTargets = async () => (await fetch(BASE + "/json/list")).json();

class Conn {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws fail " + url)); });
    const c = new Conn(ws);
    ws.onclose = (e) => { if (e.code !== 1000 && e.code !== 1005) console.log("  [ws closed]", url.slice(-12), e.code); };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && c.waiting.has(msg.id)) {
        const { res, rej } = c.waiting.get(msg.id); c.waiting.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (c.onEvent) c.onEvent(msg);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      setTimeout(() => { if (this.waiting.delete(id)) rej(new Error("timeout " + method)); }, 12000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function connectTo(targetId) {
  for (let i = 0; i < 30; i++) {
    const t = (await listTargets()).find((x) => x.id === targetId);
    if (t && t.webSocketDebuggerUrl) return Conn.open(t.webSocketDebuggerUrl);
    await sleep(200);
  }
  throw new Error("target never appeared: " + targetId);
}

async function evalIn(conn, expression) {
  const r = await conn.send("Runtime.evaluate", {
    expression: `(async()=>{ try { return ${expression} } catch(e) { return 'THREW:'+e.message } })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) return "EXC:" + r.exceptionDetails.text;
  return r.result.value;
}

const browserWs = (await (await fetch(BASE + "/json/version")).json()).webSocketDebuggerUrl;
const browser = await Conn.open(browserWs);

// ---- service worker ----
const swInfo = (await listTargets()).find((t) => t.type === "service_worker" && t.url.includes(EXT_ID));
if (!swInfo) { console.log("FATAL: extension service worker not found"); process.exit(1); }
const sw = await Conn.open(swInfo.webSocketDebuggerUrl);
await sw.send("Runtime.enable");
const swLog = [];
sw.onEvent = (m) => {
  if (m.method === "Runtime.exceptionThrown")
    swLog.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
console.log("sw settings:", await evalIn(sw, "JSON.stringify(settings)"));
console.log("sw apis:", await evalIn(sw, "JSON.stringify({tabs:!!chrome.tabs.goBack,webNav:!!chrome.webNavigation,cmds:!!chrome.commands})"));

// Chrome quits when its last tab closes, which would kill the debugging
// connection mid-run. Keep one spare tab alive for the whole suite.
async function ensureSpare() {
  const pages = (await listTargets().catch(() => [])).filter((t) => t.type === "page");
  if (pages.some((t) => t.url === "about:blank")) return;
  await browser.send("Target.createTarget", { url: "about:blank" }).catch(() => {});
  await sleep(300);
}
await ensureSpare();

// ---- helpers ----
async function openTab(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { targetId } = await browser.send("Target.createTarget", { url });
    await sleep(1200);
    try {
      await browser.send("Target.activateTarget", { targetId }).catch(() => {});
      const page = await connectTo(targetId);
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await sleep(800);
      return { targetId, page };
    } catch (e) {
      last = e;
      await browser.send("Target.closeTarget", { targetId }).catch(() => {});
      await sleep(800);
    }
  }
  throw last;
}
async function navigate(page, url) { await page.send("Page.navigate", { url }); await sleep(900); }
async function urlOf(targetId) {
  const t = (await listTargets()).find((x) => x.id === targetId);
  return t ? t.url : "(closed)";
}
async function kill(targetId) { await browser.send("Target.closeTarget", { targetId }).catch(() => {}); }
const fire = (p) => Promise.race([p.catch(() => {}), sleep(1200)]);
async function mouseBack(page) {
  for (const type of ["mousePressed", "mouseReleased"])
    await fire(page.send("Input.dispatchMouseEvent", { type, x: 150, y: 150, button: "back", buttons: 8, clickCount: 1 }));
}
async function cmdLeft(page) {
  const k = { modifiers: 4, key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 123 };
  await fire(page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k }));
  await fire(page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k }));
}

async function cmdBracket(page) {
  const k = { modifiers: 4, key: "[", code: "BracketLeft", windowsVirtualKeyCode: 219, nativeVirtualKeyCode: 33, text: "[" };
  await fire(page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k }));
  await fire(page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k }));
}

const results = [];
async function scenario(name, fn) {
  try { await ensureSpare(); const r = await fn(); results.push(r.pass); console.log(`${r.pass ? "PASS " : "FAIL "} ${name}\n        -> ${r.detail}`); }
  catch (e) {
    results.push(false);
    let health = "browser unreachable";
    try { const v = await (await fetch(BASE + "/json/version")).json(); const ts = (await listTargets()).filter(t => t.type === "page").length;
          health = `browser alive (${v.Browser}), ${ts} page targets`; } catch {}
    console.log(`ERROR  ${name}\n        -> ${e.message} | ${health}`);
  }
}
const hrefOf = (page) => evalIn(page, "location.href");
const setOpts = (o) => evalIn(sw, `await (async()=>{await chrome.storage.sync.set(${JSON.stringify(o)});await new Promise(r=>setTimeout(r,150));return JSON.stringify(settings);})()`);

const RECORD = `localStorage.removeItem('seen');
  const push=(v)=>{const s=JSON.parse(localStorage.getItem('seen')||'[]');s.push(v);localStorage.setItem('seen',JSON.stringify(s));};
  addEventListener('mousedown',e=>push('mousedown:btn'+e.button));
  addEventListener('keydown',e=>push('keydown:'+e.key+',meta='+e.metaKey));`;

// 1. does a back-button mouse event reach the page at all?
await scenario("page receives button-3 mousedown", async () => {
  const tab = await openTab(SITE + "/a.html");
  await navigate(tab.page, SITE + "/b.html");
  await tab.page.send("Runtime.evaluate", { expression: RECORD });
  await mouseBack(tab.page);
  await sleep(1500);
  const seen = await evalIn(tab.page, "localStorage.getItem('seen')");
  await kill(tab.targetId);
  return { pass: /btn3/.test(String(seen)), detail: `recorded=${seen}` };
});

// 2. does Cmd+Left reach the page, or does Vivaldi swallow it?
await scenario("page receives Cmd+Left keydown", async () => {
  const tab = await openTab(SITE + "/a.html");
  await navigate(tab.page, SITE + "/b.html");
  await tab.page.send("Runtime.evaluate", { expression: RECORD });
  await cmdLeft(tab.page);
  await sleep(1500);
  const seen = await evalIn(tab.page, "localStorage.getItem('seen')");
  await kill(tab.targetId);
  return { pass: /ArrowLeft/.test(String(seen)), detail: `recorded=${seen}` };
});

// 3. THE double-back risk: Cmd+Left is bound to both Vivaldi and the extension
await scenario("Cmd+Left with history goes back EXACTLY one page", async () => {
  const tab = await openTab(SITE + "/a.html");
  await navigate(tab.page, SITE + "/b.html");
  await navigate(tab.page, SITE + "/c.html");
  await cmdLeft(tab.page);
  await sleep(2000);
  const url = await hrefOf(tab.page);
  await kill(tab.targetId);
  const two = String(url).endsWith("/a.html");
  return { pass: String(url).endsWith("/b.html"), detail: url + (two ? "   <-- WENT BACK TWO PAGES" : "") };
});

// 4. mouse back with history: exactly one page
await scenario("mouse back with history goes back EXACTLY one page", async () => {
  const tab = await openTab(SITE + "/a.html");
  await navigate(tab.page, SITE + "/b.html");
  await navigate(tab.page, SITE + "/c.html");
  await mouseBack(tab.page);
  await sleep(2000);
  const url = await hrefOf(tab.page);
  await kill(tab.targetId);
  const two = String(url).endsWith("/a.html");
  return { pass: String(url).endsWith("/b.html"), detail: url + (two ? "   <-- WENT BACK TWO PAGES" : "") };
});

// 5. the feature: mouse
await scenario("mouse back, no history -> tab closes", async () => {
  const tab = await openTab(SITE + "/c.html");
  await mouseBack(tab.page);
  await sleep(2000);
  const url = await urlOf(tab.targetId);
  if (url !== "(closed)") await kill(tab.targetId);
  return { pass: url === "(closed)", detail: url };
});

// 6. back to first entry, then once more
await scenario("back to first entry then back again -> tab closes", async () => {
  const tab = await openTab(SITE + "/a.html");
  await navigate(tab.page, SITE + "/b.html");
  await mouseBack(tab.page); await sleep(1500);
  await mouseBack(tab.page); await sleep(2000);
  const url = await urlOf(tab.targetId);
  if (url !== "(closed)") await kill(tab.targetId);
  return { pass: url === "(closed)", detail: url };
});

// 7. SPA pushState must navigate in-document, never close
await scenario("SPA pushState back navigates in-document, no close", async () => {
  const tab = await openTab(SITE + "/a.html");
  await tab.page.send("Runtime.evaluate", { expression: "history.pushState({},'','/a.html?step=2')" });
  await sleep(500);
  await mouseBack(tab.page);
  await sleep(2000);
  const alive = (await urlOf(tab.targetId)) !== "(closed)";
  const url = alive ? await hrefOf(tab.page) : "(closed)";
  if (alive) await kill(tab.targetId);
  return { pass: alive && String(url).endsWith("/a.html"), detail: url };
});

// 8. is the close coming from the content script or from the bound command?
await scenario("with in-page key trigger OFF, Cmd+Left still closes (= command path)", async () => {
  console.log("        opts:", await setOpts({ keyBack: false }));
  const tab = await openTab(SITE + "/c.html");
  await cmdLeft(tab.page);
  await sleep(2000);
  const url = await urlOf(tab.targetId);
  if (url !== "(closed)") await kill(tab.targetId);
  await setOpts({ keyBack: true });
  return { pass: true, detail: url === "(closed)" ? "closed -> command shortcut is doing the work" : "survived -> content script was doing the work" };
});

// 8b. Cmd+[ (what many Mac mouse drivers send for the back button)
await scenario("Cmd+[ with history goes back EXACTLY one page", async () => {
  const tab = await openTab(SITE + "/a.html");
  await navigate(tab.page, SITE + "/b.html");
  await navigate(tab.page, SITE + "/c.html");
  await cmdBracket(tab.page);
  await sleep(2000);
  const url = await hrefOf(tab.page);
  await kill(tab.targetId);
  return { pass: String(url).endsWith("/b.html"), detail: url + (String(url).endsWith("/a.html") ? "   <-- TWO PAGES" : "") };
});

await scenario("Cmd+[ with no history -> tab closes", async () => {
  const tab = await openTab(SITE + "/c.html");
  await cmdBracket(tab.page);
  await sleep(2000);
  const url = await urlOf(tab.targetId);
  if (url !== "(closed)") await kill(tab.targetId);
  return { pass: url === "(closed)", detail: url };
});

// 9. pinned protection
await scenario("pinned tab with no history is NOT closed", async () => {
  const tab = await openTab(SITE + "/c.html");
  await evalIn(sw, `await (async()=>{const t=(await chrome.tabs.query({url:'${SITE}/c.html'}))[0];await chrome.tabs.update(t.id,{pinned:true});return 'ok';})()`);
  await sleep(400);
  await mouseBack(tab.page);
  await sleep(2000);
  const url = await urlOf(tab.targetId);
  if (url !== "(closed)") await kill(tab.targetId);
  return { pass: url !== "(closed)", detail: url };
});

// 10. what shortcut did the extension grab?
await scenario("registered command shortcut", async () => {
  const cmds = JSON.parse(await evalIn(sw, "JSON.stringify(await chrome.commands.getAll())"));
  const c = cmds.find((x) => x.name === "back-or-close");
  return { pass: true, detail: c ? `shortcut=${JSON.stringify(c.shortcut)}` : "not registered" };
});

// 11. Regression: the browser navigates back on mouse UP. Reporting the gesture
// on mouse DOWN meant any press held longer than the watch window ran the
// extension and the browser both, going back two pages.
for (const hold of [50, 300, 700, 1500]) {
  await scenario(`mouse back held ${hold}ms goes back EXACTLY one page`, async () => {
    const tab = await openTab(SITE + "/a.html");
    await navigate(tab.page, SITE + "/b.html");
    await navigate(tab.page, SITE + "/c.html");
    const btn = { x: 150, y: 150, button: "back", buttons: 8, clickCount: 1 };
    await fire(tab.page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...btn }));
    await sleep(hold);
    await fire(tab.page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...btn }));
    await sleep(1800);
    const url = await hrefOf(tab.page);
    await kill(tab.targetId);
    const two = String(url).endsWith("/a.html");
    return { pass: String(url).endsWith("/b.html"), detail: url + (two ? "   <-- TWO PAGES" : "") };
  });
}

// 12. the command path (what an assigned shortcut runs)
await scenario("command path: guarded mode closes a no-history tab", async () => {
  const tab = await openTab(SITE + "/c.html");
  const out = await evalIn(sw, `await (async()=>{const t=(await chrome.tabs.query({url:'${SITE}/c.html'}))[0];await handleBackGesture(t.id);return 'ran';})()`);
  await sleep(1200);
  const url = await urlOf(tab.targetId);
  if (url !== "(closed)") await kill(tab.targetId);
  return { pass: url === "(closed)", detail: `${out} -> ${url}` };
});

await scenario("command path: instant mode goes back one page", async () => {
  const tab = await openTab(SITE + "/a.html");
  await navigate(tab.page, SITE + "/b.html");
  await navigate(tab.page, SITE + "/c.html");
  await evalIn(sw, `await (async()=>{const t=(await chrome.tabs.query({url:'${SITE}/c.html'}))[0];await backOrClose(t.id);return 'ran';})()`);
  await sleep(1200);
  const url = await hrefOf(tab.page);
  await kill(tab.targetId);
  return { pass: String(url).endsWith("/b.html"), detail: url };
});

if (swLog.length) console.log("\nservice worker errors:\n  " + swLog.join("\n  "));
console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios passed`);
process.exit(0);
