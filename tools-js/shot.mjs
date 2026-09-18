// Captura de tela com emulação real de celular (o Chrome headless comum tem largura mínima de janela).
//   node tools-js/shot.mjs <url> <saida.png> [--width 390] [--height 844] [--full] [--wait 5000] [--scroll 0] [--eval "js"]
// Imprime se a página rola na horizontal (largura do documento > largura da tela).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const [url, out] = args;
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const width = Number(opt("--width", "390"));
const height = Number(opt("--height", "844"));
const wait = Number(opt("--wait", "5000"));
const scroll = Number(opt("--scroll", "0"));
const script = opt("--eval", "");
const full = args.includes("--full");
const mobile = width < 768;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
// --fake-camera: câmera sintética do Chrome (testa o fluxo da câmera ao vivo sem aparelho); --cameras 2 simula mais de uma
// --camera-file clip.y4m: a câmera falsa mostra esse vídeo (testa a leitura ao vivo com cartas de verdade)
const cameras = Number(opt("--cameras", "1"));
const cameraFile = opt("--camera-file", "");
// --no-3p-cookies: bloqueia cookies de outro site, como o Safari do iPhone e o Brave fazem
const privacy = args.includes("--no-3p-cookies") ? ["--test-third-party-cookie-phaseout", "--block-third-party-cookies"] : [];
const camera = args.includes("--fake-camera")
  ? [
      `--use-fake-device-for-media-stream=device-count=${cameras}`,
      ...(cameraFile ? [`--use-file-for-fake-video-capture=${path.resolve(cameraFile)}`] : []),
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ]
  : [];
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, ...privacy, ...camera, "about:blank"], { stdio: "ignore" });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === "page");
  } catch {
    await sleep(200);
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") {
    problems.push(`exceção: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  } else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
    problems.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300)}`);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(wait);
if (script) {
  console.log("eval:", JSON.stringify(await evaluate(`(async () => { ${script} })()`)));
  await sleep(1500);
}
if (scroll) {
  await evaluate(`window.scrollTo(0, ${scroll})`);
  await sleep(600);
}
const metrics = JSON.parse(await evaluate("JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight })"));
if (full) await send("Emulation.setDeviceMetricsOverride", { width, height: Math.min(metrics.scrollHeight, 6000), deviceScaleFactor: 1, mobile });
await sleep(300);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
const wide = await evaluate(
  `JSON.stringify([...document.querySelectorAll("body *")].filter(el => { const r = el.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 && r.width > 0; }).slice(0, 8).map(el => el.tagName.toLowerCase() + "." + String(el.className).slice(0, 60)))`,
);
console.log(JSON.stringify({ ...metrics, horizontalOverflow: metrics.scrollWidth > metrics.clientWidth, wide: JSON.parse(wide) }));
if (problems.length) console.log("console:\n  " + problems.slice(0, 15).join("\n  "));
ws.close();
proc.kill();
