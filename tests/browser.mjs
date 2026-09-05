// Runs in a disposable browser context: the user's archive is never modified.
// Start the app on port 8000 and Chromium with --remote-debugging-port=9222.
// Run: node tests/browser.mjs (Node.js 22 or later; no npm dependencies).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:8000";
const endpoint = process.env.TEST_BROWSER_URL || "http://127.0.0.1:9222";
const version = await (await fetch(endpoint + "/json/version")).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0, sessionId, contextId;
let completedDownloads = 0;
const downloadPath = await mkdtemp(join(tmpdir(), "cartografia-download-test-"));
const requests = new Map(), exceptions = [];
socket.addEventListener("message", ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const pending = requests.get(event.id);
    if (!pending) return;
    requests.delete(event.id);
    clearTimeout(pending.timer);
    if (event.error) pending.reject(new Error(event.error.message));
    else pending.resolve(event.result);
  } else if (event.method === "Runtime.exceptionThrown") {
    exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
  } else if (event.method === "Browser.downloadProgress" && event.params.state === "completed") {
    completedDownloads++;
  }
});
function command(method, params = {}, browser = false) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error("Timed out: " + method)); }, 15000);
    requests.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(!browser && sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(fn, ...args) {
  const expression = "(" + fn.toString() + ")(" + args.map((arg) => JSON.stringify(arg)).join(",") + ")";
  const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function until(fn) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await evaluate(fn)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Condition not met: " + fn.toString());
}
async function click(selector) {
  const point = await evaluate((selector) => {
    const node = document.querySelector(selector);
    node.scrollIntoView({ block: "center" });
    const box = node.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, selector);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  await evaluate(() => new Promise(requestAnimationFrame));
}
async function key(key) {
  const windowsVirtualKeyCode = { Escape: 27, Tab: 9, ArrowLeft: 37, ArrowRight: 39, Enter: 13, " ": 32 }[key];
  const code = key === " " ? "Space" : key;
  await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  await evaluate(() => new Promise(requestAnimationFrame));
}
async function field(selector, value, event = "input") {
  await evaluate((selector, value, event) => {
    const control = document.querySelector(selector);
    control.value = value;
    control.dispatchEvent(new Event(event, { bubbles: true }));
  }, selector, value, event);
}
async function check(name, fn) { await fn(); console.log("✓ " + name); }
async function screenshot(name) {
  const directory = process.env.TEST_SCREENSHOTS || process.argv[2];
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const { data } = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(directory + "/" + name + ".png", Buffer.from(data, "base64"));
}

try {
  ({ browserContextId: contextId } = await command("Target.createBrowserContext", {}, true));
  await command("Browser.setDownloadBehavior", {behavior:"allow", browserContextId:contextId, downloadPath, eventsEnabled:true}, true);
  const { targetId } = await command("Target.createTarget", { url: "about:blank", browserContextId: contextId }, true);
  ({ sessionId } = await command("Target.attachToTarget", { targetId, flatten: true }, true));
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: baseURL });
  await until(() => typeof state !== "undefined" && state.ready);
  await check("All nodes show uncropped thumbnails and fit in the canvas", async () => {
    assert.equal(await evaluate(() => document.querySelectorAll('.node image[preserveAspectRatio="xMidYMid meet"]').length), 12);
    assert.equal(await evaluate(() => document.querySelectorAll(".node circle").length), 0);
    assert.ok(await evaluate(() => {
      const c = $("graph").getBoundingClientRect();
      return [...document.querySelectorAll(".node image")].every((node) => {
        const r = node.getBoundingClientRect();
        return r.left >= c.left && r.right <= c.right && r.top >= c.top + 125 && r.bottom <= c.bottom - 40;
      });
    }));
    await screenshot("desktop-graph");
  });
  await check("Click opens the original; arrows navigate; Escape closes", async () => {
    await click('.node[data-id="1"] image');
    assert.equal(await evaluate(() => $("image-modal").open), true);
    assert.equal(await evaluate(() => $("modal-title").textContent), "Little Nemo in Slumberland");
    await key("ArrowRight");
    assert.equal(await evaluate(() => $("modal-title").textContent), "Winsor McCay");
    await key("Tab");
    assert.equal(await evaluate(() => $("image-modal").contains(document.activeElement)), true);
    await key("Escape");
    assert.equal(await evaluate(() => $("image-modal").open), false);
  });
  await check("Connection focus, legend and search filters combine correctly", async () => {
    await click("#focus-related");
    assert.deepEqual(await evaluate(() => state.filteredNodes.map((n) => n.id).sort()), ["1", "2", "3"]);
    await click("#clear-filters");
    await click('.legend-item[data-type="obra"]');
    assert.equal(await evaluate(() => state.filteredNodes.length), 6);
    await field("#search", "xyz-no-match");
    assert.equal(await evaluate(() => $("no-results").hidden), false);
    await click("#empty-clear");
    assert.equal(await evaluate(() => state.filteredNodes.length), 12);
  });
  await check("Keyboard opens a profile without a modal and Enter opens the original", async () => {
    await evaluate(() => document.querySelector('.node[data-id="3"]').focus());
    await key(" ");
    assert.equal(await evaluate(() => state.selectedId), "3");
    assert.equal(await evaluate(() => $("image-modal").open), false);
    await evaluate(() => document.querySelector('.node[data-id="3"]').focus());
    await key("Enter");
    assert.equal(await evaluate(() => $("image-modal").open), true);
    await key("Escape");
    await click("#clear-selection");
  });
  await check("Zoom survives rerender; fit, pause and drag work", async () => {
    await click("#zoom-in");
    await until(() => d3.zoomTransform(svg.node()).k > 1.15);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const before = await evaluate(() => d3.zoomTransform(svg.node()).k);
    await evaluate(() => render());
    assert.equal(await evaluate(() => d3.zoomTransform(svg.node()).k), before);
    await click("#reset-view");
    await until(() => d3.zoomTransform(svg.node()).k <= 1.15);
    await new Promise((resolve) => setTimeout(resolve, 320));
    await click("#pause-layout");
    assert.equal(await evaluate(() => state.paused), true);
    const start = await evaluate(() => state.byId.get("1").x);
    const point = await evaluate(() => {
      const r = document.querySelector('.node[data-id="1"] image').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: point.x + 30, y: point.y + 20 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x + 30, y: point.y + 20 });
    assert.notEqual(await evaluate(() => state.byId.get("1").x), start);
    assert.equal(await evaluate(() => $("image-modal").open), false);
  });
  await check("Gallery hides the graph and provides document access", async () => {
    await evaluate(() => new Promise(requestAnimationFrame));
    await click('[data-view="gallery"]');
    assert.equal(await evaluate(() => getComputedStyle($("graph")).display), "none");
    assert.equal(await evaluate(() => document.querySelectorAll(".gallery-card").length), 12);
    assert.ok(await evaluate(() => [...document.querySelectorAll(".gallery-card")].every((card) =>
      card.querySelector(".text-button").getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom)));
    await screenshot("desktop-gallery");
    await click(".gallery-card .text-button");
    assert.equal(await evaluate(() => state.selectedId), "1");
  });
  await check("Edit documentation and relations; cancel leaves data unchanged", async () => {
    await click("#edit-image");
    await field('[name="description"]', "discarded text");
    await click("#cancel-editor");
    assert.notEqual(await evaluate(() => state.byId.get("1").description), "discarded text");
    await click("#edit-image");
    await field('[name="description"]', 'Notes de recerca <img src=x onerror="window.injected=1">');
    await field('[name="author"]', "Autoria de prova");
    await field('[name="exhibition"]', "Exposició de prova");
    await field('[name="location"]', "Barcelona");
    await field("#relation-target", "12", "change");
    await field("#relation-type", "Mateixa exposició");
    await click("#add-relation");
    await click("#save-image");
    await until(() => !$("editor-dialog").open);
    assert.equal(await evaluate(() => state.links.length), 21);
    assert.equal(await evaluate(() => state.byId.get("1").exhibition), "Exposició de prova");
    assert.equal(await evaluate(() => $("panel-description").children.length), 0);
    assert.equal(await evaluate(() => Boolean(window.injected)), false);
    assert.equal(await evaluate(async () => (await readRepository()).links.length), 21);
    await screenshot("desktop-profile");
  });
  await check("Reload restores edits; search finds exhibition metadata", async () => {
    await command("Page.reload");
    await until(() => typeof state !== "undefined" && state.ready && state.links.length === 21);
    assert.equal(await evaluate(() => state.byId.get("1").author), "Autoria de prova");
    await field("#search", "exposicio de prova");
    assert.equal(await evaluate(() => state.filteredNodes.length), 1);
    await click("#clear-filters");
  });
  await check("A failed save preserves data and keeps the draft available", async () => {
    await evaluate(() => { selectNode(state.byId.get("1")); window.actualSaveRepository = saveRepository;
      saveRepository = async () => { throw new DOMException("Full", "QuotaExceededError"); }; });
    await click("#edit-image");
    await field('[name="description"]', "Unsaved draft");
    await click("#save-image");
    assert.equal(await evaluate(() => $("editor-dialog").open && !$("editor-error").hidden), true);
    assert.notEqual(await evaluate(() => state.byId.get("1").description), "Unsaved draft");
    assert.notEqual(await evaluate(async () => (await readRepository()).nodes[0].description), "Unsaved draft");
    await evaluate(() => { saveRepository = window.actualSaveRepository; });
    await click("#cancel-editor");
  });
  await check("Upload an original, create a record and preserve its bytes", async () => {
    await click("#add-image");
    await evaluate(async () => {
      const blob = await (await fetch("img/here.svg")).blob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "nova-imatge.svg", { type: "image/svg+xml" }));
      $("image-file").files = transfer.files;
      $("image-file").dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => !$("save-image").disabled && draft.image_url.startsWith("data:"));
    await field('[name="label"]', "Nova imatge");
    await field('[name="category"]', "exposicions");
    await field('[name="type"]', "exposicio", "change");
    await field("#relation-target", "1", "change");
    await field("#relation-type", "Mateixa exposició");
    await click("#add-relation");
    await click("#save-image");
    await until(() => !$("editor-dialog").open);
    assert.equal(await evaluate(() => state.nodes.length), 13);
    assert.equal(await evaluate(() => state.links.length), 22);
    assert.ok(await evaluate(() => state.byId.get(state.selectedId).image_url.startsWith("data:image/svg+xml;base64,")));
    assert.ok(await evaluate(async () => {
      const uploaded = Uint8Array.from(atob(state.byId.get(state.selectedId).image_url.split(",")[1]), (char) => char.charCodeAt(0));
      const original = new Uint8Array(await (await fetch("img/here.svg")).arrayBuffer());
      return uploaded.length === original.length && uploaded.every((byte, index) => byte === original[index]);
    }));
    await click("#panel-image-button");
    assert.equal(await evaluate(() => $("original-image").hasAttribute("download")), true);
    await key("Escape");
  });
  await check("Backup round trip, import confirmation and invalid data validation", async () => {
    await click("#export-data");
    const deadline = Date.now() + 5000;
    while (!completedDownloads && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(completedDownloads, 1);
    const filename = (await readdir(downloadPath)).find((name) => name.endsWith(".json"));
    const backupJSON = await readFile(join(downloadPath, filename), "utf8");
    assert.equal(JSON.parse(backupJSON).nodes.length, 13);
    assert.deepEqual(await evaluate(() => {
      const c = validateCorpus(JSON.parse(JSON.stringify(snapshotCorpus())));
      return [c.nodes.length, c.links.length];
    }), [13, 22]);
    assert.ok(await evaluate(() => {
      const c = snapshotCorpus(); c.nodes[0].image_url = "javascript:alert(1)";
      try { validateCorpus(c); return false; } catch { return true; }
    }));
    assert.ok(await evaluate(() => {
      const c = snapshotCorpus(); c.links[0].target = "missing";
      try { validateCorpus(c); return false; } catch { return true; }
    }));
    assert.ok(await evaluate(() => {
      const c = snapshotCorpus(); c.nodes[0].image_url = "data:image/png;base64,a";
      try { validateCorpus(c); return false; } catch { return true; }
    }));
    await evaluate((backupJSON) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([backupJSON], "copy.json", { type: "application/json" }));
      $("import-file").files = transfer.files;
      $("import-file").dispatchEvent(new Event("change"));
    }, backupJSON);
    await until(() => $("import-dialog").open);
    await click("#confirm-import");
    await until(() => !$("import-dialog").open);
    assert.equal(await evaluate(() => state.selectedId), null);
    assert.equal(await evaluate(() => state.nodes.length), 13);
  });
  await check("Timeline separates images with nearby dates, including undated records", async () => {
    await click('[data-view="timeline"]');
    assert.equal(await evaluate(() => document.querySelectorAll(".node image").length), 13);
    assert.ok(await evaluate(() => state.root.node().textContent.includes("Sense data")));
    assert.ok(await evaluate(() => {
      const boxes = [...document.querySelectorAll(".node image")].map((n) => n.getBoundingClientRect());
      return boxes.every((a, i) => boxes.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    }));
    await screenshot("desktop-timeline");
  });
  await check("Mobile canvas, modal and editor have no horizontal overflow", async () => {
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await click('[data-view="graph"]');
    await until(() => innerWidth === 390);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot("mobile-graph");
    await click(".node image");
    assert.equal(await evaluate(() => $("image-modal").open), true);
    assert.equal(await evaluate(() => $("image-modal").scrollWidth <= $("image-modal").clientWidth), true);
    await screenshot("mobile-modal");
    await key("Escape");
    await click("#clear-selection");
    await click("#add-image");
    assert.equal(await evaluate(() => $("editor-dialog").scrollWidth <= $("editor-dialog").clientWidth), true);
    await screenshot("mobile-editor");
    await click("#cancel-editor");
  });
  assert.deepEqual(exceptions, [], "Browser JavaScript exceptions");
  console.log("All browser checks passed; no uncaught JavaScript exceptions.");
} finally {
  if (contextId) await command("Target.disposeBrowserContext", { browserContextId: contextId }, true);
  socket.close();
}
