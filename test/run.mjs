// Launch a Chromium browser with a CDP pipe, load the unpacked extension via
// Extensions.loadUnpacked (the only route left in Chrome/Vivaldi 137+), then
// hand off to the scenario harness over the HTTP/WS debugging port.
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const BROWSER = process.env.BROWSER_BIN;
const PROFILE = process.env.PROFILE_DIR;
const EXT = process.env.EXT_DIR;
const PORT = process.env.CDP_PORT;
const HEADLESS = process.env.HEADLESS === "1";

const args = [
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  "--remote-debugging-pipe",
  "--enable-unsafe-extension-debugging",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "about:blank",
];
if (HEADLESS) args.unshift("--headless=new");

const child = spawn(BROWSER, args, {
  stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
});
child.stderr.on("data", (d) => {
  const s = d.toString();
  if (/extension|Extensions|ERROR:.*extension/i.test(s)) process.stderr.write("[browser] " + s);
});

const wr = child.stdio[3];
const rd = child.stdio[4];
let buf = Buffer.alloc(0);
const waiting = new Map();
let nextId = 0;

rd.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  let i;
  while ((i = buf.indexOf(0)) !== -1) {
    const raw = buf.subarray(0, i).toString();
    buf = buf.subarray(i + 1);
    let msg; try { msg = JSON.parse(raw); } catch { continue; }
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  wr.write(JSON.stringify({ id, method, params }) + "\0");
  return new Promise((res, rej) => {
    waiting.set(id, { res, rej });
    setTimeout(() => { if (waiting.delete(id)) rej(new Error("pipe timeout " + method)); }, 20000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await sleep(3500);
  const info = await send("Browser.getVersion");
  console.log("launched:", info.product);
  const loaded = await send("Extensions.loadUnpacked", { path: EXT });
  console.log("loaded extension id:", loaded.id);
  await sleep(2000);

  const r = spawnSync("node", [process.env.HARNESS], {
    stdio: "inherit",
    env: { ...process.env, CDP_PORT: PORT, EXT_ID: loaded.id, BROWSER_PID: String(child.pid) },
  });
  process.exitCode = r.status ?? 1;
} catch (e) {
  console.error("launch/load failed:", e.message);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
