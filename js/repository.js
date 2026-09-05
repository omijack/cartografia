/* global $, state, element, toast, nodeId, titleCase, normalize, TYPE_LABELS,
          replaceCorpus, resetFilters, selectNode */
"use strict";

const DOCUMENT_FIELDS = ["id", "label", "type", "category", "epoch", "technique", "image_url", "description", "author", "exhibition", "location"];
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
let draft;
let editorSession = 0;
let fileRevision = 0;
let editorBusy = false;
let pendingImport;

function openRepository() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cartografia-archive", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("corpus");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Tanca les altres pestanyes de Cartografia i torna-ho a provar."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function repositoryTransaction(mode, value) {
  const database = await openRepository();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("corpus", mode);
    const store = transaction.objectStore("corpus");
    const request = mode === "readonly" ? store.get("archive") : store.put(value, "archive");
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error || new Error("No s’ha pogut desar l’arxiu.")); };
  });
}

function readRepository() { return repositoryTransaction("readonly"); }
function saveRepository(corpus) { return repositoryTransaction("readwrite", corpus); }

function validImageURL(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value.startsWith("data:")) {
    if (value.length > MAX_IMAGE_BYTES * 1.38 ||
        !/^data:image\/(?:jpeg|png|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    try { return atob(value.split(",")[1]).length <= MAX_IMAGE_BYTES; }
    catch { return false; }
  }
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}

function validateCorpus(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.links)) {
    throw new Error("El fitxer no és un arxiu de Cartografia vàlid (versió 1).");
  }
  if (value.nodes.length > 2000 || value.links.length > 20000) throw new Error("L’arxiu supera el límit de 2.000 imatges o 20.000 relacions.");
  const ids = new Set();
  const nodes = value.nodes.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Hi ha una fitxa invàlida.");
    const node = {};
    DOCUMENT_FIELDS.forEach((field) => {
      const fieldValue = raw[field] ?? "";
      if (typeof fieldValue !== "string" && !(field === "id" && typeof fieldValue === "number")) throw new Error("El camp " + field + " ha de ser text.");
      node[field] = String(fieldValue).trim();
      const limit = field === "description" ? 10000 : field === "image_url" ? MAX_IMAGE_BYTES * 1.38 : 500;
      if (node[field].length > limit) throw new Error("El camp " + field + " és massa llarg.");
    });
    if (!node.id || !node.label || !node.type || !node.category || ids.has(node.id)) throw new Error("Cada fitxa necessita un identificador únic, títol, tipus i categoria.");
    if (!validImageURL(node.image_url)) throw new Error("La imatge de «" + node.label + "» té una adreça o format no vàlid.");
    ids.add(node.id);
    return node;
  });
  const uniqueLinks = new Set();
  const links = value.links.map((raw) => {
    if (!raw || typeof raw !== "object" || !["string", "number"].includes(typeof raw.source) || !["string", "number"].includes(typeof raw.target)) throw new Error("Hi ha una relació invàlida.");
    const source = String(raw.source), target = String(raw.target);
    const type = typeof raw.type === "string" ? raw.type.trim() : "";
    const weight = raw.weight;
    if (!ids.has(source) || !ids.has(target) || source === target || !type || type.length > 100 ||
        typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error("Hi ha una relació amb imatges, tipus o pes no vàlids.");
    }
    const key = JSON.stringify([source, target, normalize(type)]);
    if (uniqueLinks.has(key)) throw new Error("L’arxiu conté una relació duplicada.");
    uniqueLinks.add(key);
    return { source, target, type, weight };
  });
  const corpus = { version: 1, nodes, links };
  if (new Blob([JSON.stringify(corpus)]).size > MAX_ARCHIVE_BYTES) throw new Error("L’arxiu supera els 100 MB. Utilitza imatges més petites.");
  return corpus;
}

function snapshotCorpus(nodes = state.nodes, links = state.links) {
  return validateCorpus({
    version: 1,
    nodes: nodes.map((node) => Object.fromEntries(DOCUMENT_FIELDS.map((field) => [field, String(node[field] ?? "")]))),
    links: links.map((link) => ({ source: nodeId(link.source), target: nodeId(link.target), type: link.type, weight: link.weight }))
  });
}

function bindRepositoryControls() {
  $("add-image").addEventListener("click", () => openEditor());
  $("edit-image").addEventListener("click", () => openEditor(state.byId.get(state.selectedId)));
  ["close-editor", "cancel-editor"].forEach((id) => $(id).addEventListener("click", () => { if (!editorBusy) $("editor-dialog").close(); }));
  $("editor-dialog").addEventListener("cancel", (event) => { if (editorBusy) event.preventDefault(); });
  $("editor-dialog").addEventListener("close", () => { editorSession++; });
  $("image-file").addEventListener("change", readImageFile);
  $("editor-form").addEventListener("submit", saveEditor);
  $("add-relation").addEventListener("click", addDraftRelation);
  $("export-data").addEventListener("click", exportCorpus);
  $("import-data").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", prepareImport);
  $("confirm-import").addEventListener("click", commitImport);
  $("import-dialog").addEventListener("cancel", (event) => {
    if ($("confirm-import").disabled) event.preventDefault();
  });
}

function editorError(message = "") {
  $("editor-error").textContent = message;
  $("editor-error").hidden = !message;
}

function openEditor(node) {
  editorSession++;
  fileRevision++;
  editorBusy = false;
  $("editor-form").reset();
  $("image-file").setCustomValidity("");
  editorError();
  draft = {
    id: node?.id || crypto.randomUUID(),
    image_url: node?.image_url || "",
    links: node ? state.links.filter((link) => link.source === node.id || link.target === node.id).map((link) => ({ ...link })) : [],
    existing: Boolean(node)
  };
  $("editor-title").textContent = node ? "Documenta la imatge" : "Afegeix una imatge";
  const typeSelect = $("editor-form").elements.namedItem("type");
  [...typeSelect.options].filter((option) => !TYPE_LABELS[option.value]).forEach((option) => option.remove());
  if (node && ![...typeSelect.options].some((option) => option.value === node.type)) typeSelect.add(new Option(titleCase(node.type), node.type));
  DOCUMENT_FIELDS.forEach((field) => {
    const control = $("editor-form").elements.namedItem(field);
    if (control) control.value = node?.[field] || (field === "type" ? "obra" : "");
  });
  $("editor-preview").hidden = !draft.image_url;
  if (draft.image_url) $("editor-preview").src = draft.image_url;
  else $("editor-preview").removeAttribute("src");
  $("upload-label").textContent = node ? "Canvia la imatge" : "Tria una imatge";
  $("category-options").replaceChildren();
  [...new Set(state.nodes.map((item) => item.category))].forEach((category) => $("category-options").append(new Option(category, category)));
  $("relation-target").replaceChildren(new Option("Selecciona una imatge", ""));
  state.nodes.filter((item) => item.id !== draft.id).sort((a, b) => a.label.localeCompare(b.label, "ca"))
    .forEach((item) => $("relation-target").add(new Option(item.label, item.id)));
  $("save-image").disabled = false;
  renderDraftRelations();
  $("editor-dialog").showModal();
  $("editor-form").elements.namedItem("label").focus();
}

function fileDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No s’ha pogut llegir la imatge."));
    reader.readAsDataURL(file);
  });
}

async function readImageFile() {
  const file = $("image-file").files[0];
  if (!file) return;
  const session = editorSession;
  const revision = ++fileRevision;
  $("image-file").setCustomValidity("");
  $("save-image").disabled = true;
  editorError();
  try {
    if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) throw new Error("Tria una imatge JPG, PNG, WebP, GIF o SVG de menys de 10 MB.");
    const url = await fileDataURL(file);
    const probe = new Image();
    probe.src = url;
    await probe.decode();
    if (session !== editorSession || revision !== fileRevision) return;
    draft.image_url = url;
    $("editor-preview").src = url;
    $("editor-preview").hidden = false;
    $("upload-label").textContent = file.name;
    const title = $("editor-form").elements.namedItem("label");
    if (!title.value.trim()) title.value = file.name.replace(/\.[^.]+$/, "").slice(0, 160);
  } catch (error) {
    if (session !== editorSession || revision !== fileRevision) return;
    const message = error.message || "El fitxer no es pot mostrar com a imatge.";
    $("image-file").setCustomValidity(message);
    editorError(message);
  } finally {
    if (session === editorSession && revision === fileRevision) $("save-image").disabled = false;
  }
}

function addDraftRelation() {
  const target = $("relation-target").value;
  const type = $("relation-type").value.trim();
  if (!target || !type) { editorError("Selecciona una imatge i escriu el tipus de relació."); return; }
  if (draft.links.some((link) => (link.source === target || link.target === target) && normalize(link.type) === normalize(type))) {
    editorError("Aquesta relació ja existeix."); return;
  }
  draft.links.push({ source: draft.id, target, type, weight: .7 });
  $("relation-target").value = "";
  $("relation-type").value = "";
  editorError();
  renderDraftRelations();
}

function renderDraftRelations() {
  $("draft-relation-count").textContent = draft.links.length;
  $("draft-relations").replaceChildren();
  draft.links.forEach((link, index) => {
    const other = state.byId.get(link.source === draft.id ? link.target : link.source);
    const item = element("li");
    const copy = element("span", "", other.label);
    copy.append(element("small", "", titleCase(link.type)));
    const remove = element("button", "icon-button", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Elimina la relació " + link.type + " amb " + other.label);
    remove.addEventListener("click", () => {
      draft.links.splice(index, 1);
      renderDraftRelations();
      $("add-relation").focus();
    });
    item.append(copy, remove);
    $("draft-relations").append(item);
  });
}

async function saveEditor(event) {
  event.preventDefault();
  if (editorBusy || $("save-image").disabled) return;
  editorError();
  if (!draft.image_url) { editorError("Tria una imatge per a aquesta fitxa."); $("image-file").focus(); return; }
  if ($("relation-target").value || $("relation-type").value.trim()) {
    editorError("Prem «Connecta» per afegir la relació pendent, o buida’n els camps abans de desar.");
    $("add-relation").focus();
    return;
  }
  editorBusy = true;
  $("save-image").disabled = true;
  $("save-image").textContent = "Desant…";
  try {
    const node = { id: draft.id, image_url: draft.image_url };
    new FormData($("editor-form")).forEach((value, key) => { if (DOCUMENT_FIELDS.includes(key)) node[key] = String(value).trim(); });
    const nodes = draft.existing ? state.nodes.map((item) => item.id === node.id ? node : item) : [...state.nodes, node];
    const links = [...state.links.filter((link) => link.source !== node.id && link.target !== node.id), ...draft.links];
    const corpus = snapshotCorpus(nodes, links);
    // Commit the entire document and its relations atomically before changing the UI.
    await saveRepository(corpus);
    replaceCorpus(corpus);
    $("editor-dialog").close();
    resetFilters();
    selectNode(state.byId.get(node.id));
    $("storage-status").textContent = "Arxiu desat en aquest navegador";
    toast("Fitxa i relacions desades.");
    $("edit-image").focus();
  } catch (error) {
    console.warn(error);
    editorError(error.name === "QuotaExceededError"
      ? "No queda espai al navegador. La fitxa no s’ha desat. Prova una imatge més petita."
      : "No s’ha desat: " + error.message);
  } finally {
    editorBusy = false;
    $("save-image").disabled = false;
    $("save-image").textContent = "Desa la fitxa";
  }
}

function exportCorpus() {
  try {
    const corpus = snapshotCorpus();
    const url = URL.createObjectURL(new Blob([JSON.stringify(corpus, null, 2)], { type: "application/json" }));
    const anchor = element("a");
    anchor.href = url;
    anchor.download = "cartografia-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("Còpia exportada amb les fitxes, les relacions i les imatges pujades.");
  } catch (error) { toast(error.message); }
}

async function prepareImport() {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  try {
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error("La còpia supera els 100 MB.");
    pendingImport = validateCorpus(JSON.parse(await file.text()));
    $("import-summary").textContent = "La còpia conté " + pendingImport.nodes.length + " imatges i " + pendingImport.links.length + " relacions.";
    $("import-error").hidden = true;
    $("import-dialog").showModal();
  } catch (error) { toast("No s’ha importat cap canvi. " + error.message); }
}

async function commitImport() {
  const button = $("confirm-import");
  if (button.disabled || !pendingImport) return;
  button.disabled = true;
  const cancel = $("import-dialog").querySelector('[value="cancel"]');
  cancel.disabled = true;
  try {
    await saveRepository(pendingImport);
    state.selectedId = null;
    replaceCorpus(pendingImport);
    resetFilters();
    // Import can remove the selected record; reset its inspector as well.
    $("clear-selection").click();
    $("storage-status").textContent = "Arxiu desat en aquest navegador";
    $("import-dialog").close();
    pendingImport = null;
    toast("Arxiu importat i desat.");
  } catch (error) {
    $("import-error").textContent = "No s’ha importat: " + error.message;
    $("import-error").hidden = false;
  } finally { button.disabled = false; cancel.disabled = false; }
}
