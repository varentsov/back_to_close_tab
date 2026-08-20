// Real macOS-level input against the real extension in Vivaldi.
import { execFileSync } from "node:child_process";
const PORT = process.env.CDP_PORT, PID = process.env.BROWSER_PID, POSTER = process.env.POSTER;
const BASE = `http://127.0.0.1:${PORT}`, SITE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = async () => (await fetch(BASE + "/json/list")).json();

class Conn {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws fail")); });
    const c = new Conn(ws);
    ws.onmessage = (m) => { const msg = JSON.parse(m.data);
      if (msg.id && c.waiting.has(msg.id)) { const { res, rej } = c.waiting.get(msg.id); c.waiting.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
    return c;
  }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((res, rej) => { this.waiting.set(id, { res, rej });
      setTimeout(() => { if (this.waiting.delete(id)) rej(new Error("timeout " + m)); }, 8000); }); }
}
const evalIn = async (c, e) => (await c.send("Runtime.evaluate",
  { expression: `(async()=>{try{return ${e}}catch(err){return 'THREW:'+err.message}})()`, awaitPromise: true, returnByValue: true })).result?.value;
const post = (...a) => { try { return execFileSync(POSTER, ["tap", PID, ...a.map(String)]).toString().trim(); }
  catch (e) { return "POST FAILED"; } };

const browser = await Conn.open((await (await fetch(BASE + "/json/version")).json()).webSocketDebuggerUrl);
// keep one spare tab so closing the test tab never closes the window
const spare = (await browser.send("Target.createTarget", { url: "about:blank" })).targetId;
for (const t of await list()) if (t.type === "page" && t.id !== spare) await browser.send("Target.closeTarget", { targetId: t.id }).catch(() => {});
await sleep(500);

// RECORD survives navigation by writing to localStorage
const RECORD = `localStorage.setItem('seen','[]');
  const push=v=>{const s=JSON.parse(localStorage.getItem('seen')||'[]');s.push(v);localStorage.setItem('seen',JSON.stringify(s));};
  addEventListener('mousedown',e=>push('mousedown:btn'+e.button),true);
  addEventListener('keydown',e=>push('keydown:'+e.key+',meta='+e.metaKey),true);`;

async function freshTab(urls) {
  const targetId = (await browser.send("Target.createTarget", { url: urls[0] })).targetId;
  await sleep(1600);
  const info = (await list()).find((t) => t.id === targetId);
  const page = await Conn.open(info.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  for (const u of urls.slice(1)) { await page.send("Page.navigate", { url: u }); await sleep(1000); }
  await browser.send("Target.activateTarget", { targetId });
  // bring this browser instance to the front, or OS events land elsewhere
  try {
    execFileSync("osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${PID}) to true`]);
  } catch { /* reported by the control below */ }
  await sleep(900);
  const win = await browser.send("Browser.getWindowForTarget", { targetId });
  const pt = [win.bounds.left + Math.floor(win.bounds.width / 2), win.bounds.top + Math.floor(win.bounds.height / 2) + 80];
  await page.send("Runtime.evaluate", { expression: RECORD });
  await sleep(300);
  return { targetId, page, pt };
}
const closed = async (id) => !(await list()).some((t) => t.id === id);
const results = [];
function report(name, pass, detail) { results.push(pass); console.log(`${pass ? "PASS " : "FAIL "} ${name}\n        -> ${detail}`); }

// --- CONTROL: prove OS events are actually reaching this browser ---
{
  const t = await freshTab([SITE + "/a.html"]);
  await t.page.send("Runtime.evaluate", { expression: `document.body.innerHTML='<input id=probe style="font-size:30px;width:80%">';document.getElementById('probe').focus();` });
  await sleep(400);
  post("key", 7); // 'x'
  await sleep(900);
  const v = await evalIn(t.page, "document.getElementById('probe')?.value");
  await browser.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  if (v !== "x") {
    console.log(`CONTROL FAILED -> typed 'x' never arrived (got ${JSON.stringify(v)}).`);
    console.log("OS events are not reaching this browser, so the results below would be meaningless.");
    console.log("Grant Accessibility permission to your terminal and keep the browser window frontmost.");
    process.exit(3);
  }
  console.log("CONTROL ok -> OS-level events reach the browser\n");
}

// --- does the PAGE see each real input? (tab has history, so back is harmless) ---
for (const [label, args] of [["mouse button 3", ["mouse", 3]], ["Cmd+[", ["key", 33, "cmd"]], ["Cmd+Left", ["key", 123, "cmd"]]]) {
  const t = await freshTab([SITE + "/a.html", SITE + "/b.html"]);
  post(...(args[0] === "mouse" ? [...args, ...t.pt] : args));
  await sleep(1600);
  const seen = await evalIn(t.page, "localStorage.getItem('seen')");
  const url = await evalIn(t.page, "location.href");
  report(`page receives real ${label}`, /btn3|ArrowLeft|"keydown:\[/.test(String(seen)) || String(seen).includes("keydown"),
    `page saw ${seen} | url=${String(url).split("/").pop()}`);
  await browser.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
}

// --- the real thing: no history, does the tab close? ---
for (const [label, args, hold] of [
    ["mouse button 3 (quick 50ms press)", ["mouse", 3], 50000],
    ["mouse button 3 (held 700ms)", ["mouse", 3], 700000],
    ["mouse button 3 (held 1500ms)", ["mouse", 3], 1500000],
    ["Cmd+[", ["key", 33, "cmd"], null],
    ["Cmd+Left", ["key", 123, "cmd"], null]]) {
  const t = await freshTab([SITE + "/c.html"]);
  post(...(args[0] === "mouse" ? [...args, ...t.pt, hold] : args));
  await sleep(2200);
  const gone = await closed(t.targetId);
  let why = "tab closed";
  if (!gone) {
    const seen = await evalIn(t.page, "localStorage.getItem('seen')").catch(() => "?");
    const url = await evalIn(t.page, "location.href").catch(() => "?");
    why = `tab still open | page recorded ${seen} | url=${String(url).split("/").pop()}`;
  }
  report(`real ${label} on a no-history tab closes it`, gone, why);
  if (!gone) await browser.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(0);
