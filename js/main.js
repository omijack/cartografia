/* global d3, readRepository, bindRepositoryControls, validateCorpus */
"use strict";

const TYPE_LABELS = { obra: "Obra", autor: "Autoria", exposicio: "Exposició", corrent: "Corrent", tecnica: "Tècnica", tema: "Tema" };
const CATEGORY_LABELS = { precursores: "Precursores", contemporanis: "Contemporanis", transmedia: "Transmèdia", digital: "Digital", experimental: "Experimental" };
const TYPE_COLORS = { obra: "#e7b888", autor: "#87b9b1", exposicio: "#d3b7db", corrent: "#a49bc7", tecnica: "#d6c479", tema: "#cba1aa" };
const $ = (id) => document.getElementById(id);
const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("ca");
const titleCase = (value) => String(value || "—").replaceAll("_", " ").replace(/^./, (letter) => letter.toLocaleUpperCase("ca"));
const nodeId = (value) => String(typeof value === "object" ? value.id : value);
const nodeColor = (node) => TYPE_COLORS[node.type] || "#aeb8c2";
const epochStart = (epoch) => Number.parseInt(String(epoch).match(/\d{4}/)?.[0], 10) || null;
const truncate = (value, length) => value.length > length ? value.slice(0, length - 1) + "…" : value;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = {
  nodes: [], links: [], filteredNodes: [], filteredLinks: [], byId: new Map(), neighbors: new Map(),
  view: "graph", selectedId: null, simulation: null, zoom: null, root: null,
  nodeSize: 96, paused: reducedMotion, fitNext: true, ready: false, modalIds: [], modalId: null
};
let svg;
let resizeTimer;
let toastTimer;
let originalObjectURL;

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6000);
}

async function loadData() {
  try {
    if (typeof d3 === "undefined") throw new Error("No s’ha pogut carregar D3. Comprova la connexió a Internet i recarrega la pàgina.");
    svg = d3.select("#graph");
    let corpus;
    try {
      corpus = await readRepository();
    } catch (error) {
      console.warn("No es pot llegir l’arxiu local.", error);
      toast("No s’ha pogut llegir l’arxiu local. Es mostra el corpus de mostra.");
    }
    if (corpus) {
      corpus = validateCorpus(corpus);
      $("storage-status").textContent = "Arxiu desat en aquest navegador";
    } else {
      const [nodes, links] = await Promise.all([d3.csv("data/comics.csv"), d3.csv("data/relations.csv")]);
      corpus = validateCorpus({ version: 1, nodes, links: links.map((link) => ({ ...link, weight: Number(link.weight) })) });
    }
    replaceCorpus(corpus);
    bindControls();
    bindRepositoryControls();
    state.ready = true;
    applyFilters();
    $("loading").hidden = true;
    ["add-image", "export-data", "import-data"].forEach((id) => { $(id).disabled = false; });
  } catch (error) {
    console.error(error);
    $("loading").replaceChildren(element("p", "form-error", error.message || "No s’han pogut carregar les dades."));
    $("loading").append(element("p", "", "Executa el projecte amb un servidor local i torna-ho a provar (consulta el README)."));
  }
}

function replaceCorpus(corpus) {
  state.simulation?.stop();
  state.nodes = corpus.nodes;
  state.links = corpus.links.map((link) => ({ ...link, source: nodeId(link.source), target: nodeId(link.target) }));
  state.byId = new Map(state.nodes.map((node) => [node.id, node]));
  state.neighbors = new Map(state.nodes.map((node) => [node.id, new Set([node.id])]));
  state.nodes.forEach((node) => { node.degree = 0; });
  state.links.forEach((link) => {
    state.neighbors.get(link.source).add(link.target);
    state.neighbors.get(link.target).add(link.source);
    state.byId.get(link.source).degree++;
    state.byId.get(link.target).degree++;
  });
  populateFilters();
  renderLegend();
}

function populateFilters() {
  [["filter-type", "type", TYPE_LABELS], ["filter-category", "category", CATEGORY_LABELS], ["filter-epoch", "epoch", {}]].forEach(([id, field, labels]) => {
    const select = $(id);
    const previous = select.value;
    while (select.options.length > 1) select.remove(1);
    const values = [...new Set(state.nodes.map((node) => node[field]).filter(Boolean))];
    values.sort(field === "epoch"
      ? (a, b) => (epochStart(a) ?? Infinity) - (epochStart(b) ?? Infinity)
      : (a, b) => (labels[a] || a).localeCompare(labels[b] || b, "ca"));
    values.forEach((value) => select.add(new Option(labels[value] || titleCase(value), value)));
    select.value = values.includes(previous) ? previous : "all";
  });
}

function renderLegend() {
  $("legend").replaceChildren();
  [...new Set(state.nodes.map((node) => node.type))].forEach((type) => {
    const button = element("button", "legend-item");
    button.type = "button";
    button.dataset.type = type;
    const dot = element("i", "legend-dot");
    dot.style.setProperty("--dot-color", TYPE_COLORS[type] || "#aeb8c2");
    button.append(dot, element("span", "", TYPE_LABELS[type] || titleCase(type)),
      element("span", "legend-count", state.nodes.filter((node) => node.type === type).length));
    button.addEventListener("click", () => {
      $("filter-type").value = $("filter-type").value === type ? "all" : type;
      applyFilters();
    });
    $("legend").append(button);
  });
}

function bindControls() {
  ["filter-type", "filter-category", "filter-epoch"].forEach((id) => $(id).addEventListener("change", applyFilters));
  $("search").addEventListener("input", applyFilters);
  ["clear-filters", "empty-clear"].forEach((id) => $(id).addEventListener("click", resetFilters));
  document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("reset-view").addEventListener("click", () => fitView(true));
  $("zoom-in").addEventListener("click", () => zoomBy(1.3));
  $("zoom-out").addEventListener("click", () => zoomBy(1 / 1.3));
  $("pause-layout").addEventListener("click", () => {
    state.paused = !state.paused;
    updatePauseButton();
    if (state.paused) state.simulation?.stop();
    else state.simulation?.alpha(.3).restart();
  });
  updatePauseButton();
  $("node-size").addEventListener("input", (event) => {
    state.nodeSize = Number(event.target.value);
    $("size-value").textContent = state.nodeSize < 88 ? "S" : state.nodeSize > 112 ? "L" : "M";
    state.fitNext = true;
    render();
  });
  $("show-labels").addEventListener("change", () => svg.classed("hide-labels", !$("show-labels").checked));
  $("focus-related").addEventListener("change", applyFilters);
  $("clear-selection").addEventListener("click", () => {
    clearSelection();
    applyFilters();
    $("visualization").focus();
  });
  $("panel-image-button").addEventListener("click", () => openModal(state.byId.get(state.selectedId)));
  document.querySelector("[data-close-modal]").addEventListener("click", () => $("image-modal").close());
  $("image-modal").addEventListener("click", (event) => {
    if (event.target !== $("image-modal")) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  });
  $("image-modal").addEventListener("close", () => {
    if (originalObjectURL) URL.revokeObjectURL(originalObjectURL);
    originalObjectURL = null;
  });
  $("modal-inspect").addEventListener("click", () => {
    $("image-modal").close();
    $("edit-image").focus();
  });
  $("previous-image").addEventListener("click", () => navigateModal(-1));
  $("next-image").addEventListener("click", () => navigateModal(1));
  document.addEventListener("keydown", (event) => {
    if ($("image-modal").open && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      navigateModal(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
      clearSelection();
      applyFilters();
    }
  });
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.ready) return;
      state.fitNext = true;
      render();
    }, 150);
  }).observe($("visualization"));
}

function updatePauseButton() {
  $("pause-layout").textContent = state.paused ? "▷" : "Ⅱ";
  const label = state.paused ? "Reprèn el moviment" : "Pausa el moviment";
  $("pause-layout").setAttribute("aria-label", label);
  $("pause-layout").title = label;
  $("pause-layout").setAttribute("aria-pressed", String(state.paused));
}

function resetFilters() {
  $("search").value = "";
  ["filter-type", "filter-category", "filter-epoch"].forEach((id) => { $(id).value = "all"; });
  $("focus-related").checked = false;
  applyFilters();
}

function applyFilters() {
  const query = normalize($("search").value.trim());
  let nodes = state.nodes.filter((node) => {
    const searchable = [node.label, node.description, node.type, TYPE_LABELS[node.type], node.category,
      CATEGORY_LABELS[node.category], node.technique, node.epoch, node.author, node.exhibition, node.location];
    return (!query || normalize(searchable.join(" ")).includes(query)) &&
      [["filter-type", "type"], ["filter-category", "category"], ["filter-epoch", "epoch"]]
        .every(([id, field]) => $(id).value === "all" || $(id).value === node[field]);
  });
  if (state.selectedId && !nodes.some((node) => node.id === state.selectedId)) clearSelection();
  if ($("focus-related").checked && state.selectedId) {
    const related = state.neighbors.get(state.selectedId);
    nodes = nodes.filter((node) => related.has(node.id));
  }
  state.filteredNodes = nodes;
  const ids = new Set(nodes.map((node) => node.id));
  state.filteredLinks = state.links.filter((link) => ids.has(link.source) && ids.has(link.target));
  $("result-count").textContent = nodes.length + " de " + state.nodes.length + " imatges · " +
    state.filteredLinks.length + (state.filteredLinks.length === 1 ? " connexió" : " connexions");
  $("no-results").hidden = nodes.length !== 0;
  document.querySelectorAll(".legend-item").forEach((button) => {
    const active = button.dataset.type === $("filter-type").value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  state.fitNext = true;
  render();
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  const views = {
    graph: ["El mapa de l’arxiu", "Tot està connectat.", "VISTA DE XARXA", "Xarxa del còmic expandit"],
    gallery: ["La col·lecció visual", "Històries per descobrir.", "VISTA DE GALERIA", "Galeria del còmic expandit"],
    timeline: ["L’arxiu en el temps", "Un recorregut visual.", "VISTA CRONOLÒGICA", "Cronologia del còmic expandit"]
  };
  const copy = views[view];
  ["view-kicker", "view-title", "view-badge", "graph-title"].forEach((id, index) => { $(id).textContent = copy[index]; });
  document.querySelectorAll(".view-button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("graph").toggleAttribute("hidden", view === "gallery");
  $("gallery").hidden = view !== "gallery";
  $("canvas-bottom").hidden = view === "gallery";
  $("node-size").disabled = view === "gallery";
  $("show-labels").disabled = view === "gallery";
  $("pause-layout").hidden = view !== "graph";
  $("view-description").textContent = view === "timeline"
    ? "Ordenat per l’any inicial · Arrossega i amplia per explorar"
    : "Arrossega per explorar · Clic per ampliar · Espai per veure la fitxa";
  state.fitNext = true;
  render();
}

function render() {
  if (!svg) return;
  hideTooltip();
  state.simulation?.stop();
  if (state.view === "gallery") {
    renderGallery();
    return;
  }
  const { width, height } = $("visualization").getBoundingClientRect();
  if (!width || !height) return;
  const previousTransform = d3.zoomTransform(svg.node());
  svg.interrupt().attr("viewBox", "0 0 " + width + " " + height);
  svg.selectAll(".rendered-layer").remove();
  state.root = svg.append("g").attr("class", "rendered-layer");
  state.zoom = d3.zoom().scaleExtent([.08, 5])
    .filter((event) => (!event.ctrlKey || event.type === "wheel") && !event.button && (event.type === "wheel" || !event.target.closest?.(".node")))
    .on("zoom", (event) => {
      state.root.attr("transform", event.transform);
      $("zoom-value").textContent = Math.round(event.transform.k * 100) + "%";
      hideTooltip();
    });
  svg.call(state.zoom).on("dblclick.zoom", null);
  svg.call(state.zoom.transform, previousTransform);
  if (!state.filteredNodes.length) return;
  if (state.view === "graph") renderGraph(width, height);
  else renderTimeline(width, height);
  highlightRelated(state.selectedId);
  if (state.fitNext) {
    fitView(false);
    state.fitNext = false;
  }
}

function cardWidth(node) {
  return state.nodeSize + Math.min(node.degree, 8) * 3;
}

function createNodes() {
  const nodes = state.root.append("g").selectAll(".node").data(state.filteredNodes, (node) => node.id).join("g")
    .attr("class", "node").attr("data-id", (node) => node.id).attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", (node) => node.label + ". " + (TYPE_LABELS[node.type] || node.type) + ". Retorn: amplia. Espai: fitxa.")
    .on("mouseenter", (event, node) => { showTooltip(event, node); highlightRelated(node.id); })
    .on("mousemove", moveTooltip)
    .on("mouseleave", () => { hideTooltip(); highlightRelated(state.selectedId); })
    .on("focus", (_, node) => highlightRelated(node.id))
    .on("blur", () => highlightRelated(state.selectedId))
    .on("click", (event, node) => { if (!event.defaultPrevented) openModal(node); })
    .on("keydown", (event, node) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (event.key === "Enter") openModal(node);
        else { selectNode(node); $("edit-image").focus(); }
      }
    });
  nodes.append("rect").attr("class", "node-card");
  nodes.append("text").attr("class", "image-fallback").attr("y", 3).attr("hidden", true).text("Imatge no disponible");
  nodes.append("image").attr("href", (node) => node.image_url).attr("preserveAspectRatio", "xMidYMid meet")
    .attr("x", (node) => -cardWidth(node) / 2 + 4).attr("y", (node) => -cardWidth(node) * .375 + 4)
    .attr("width", (node) => cardWidth(node) - 8).attr("height", (node) => cardWidth(node) * .75 - 8)
    .on("error", function () { d3.select(this.parentNode).select(".image-fallback").attr("hidden", null); d3.select(this).attr("visibility", "hidden"); });
  nodes.append("rect").attr("class", "node-border").attr("stroke", nodeColor);
  nodes.selectAll(".node-card, .node-border")
    .attr("x", (node) => -cardWidth(node) / 2).attr("y", (node) => -cardWidth(node) * .375)
    .attr("width", cardWidth).attr("height", (node) => cardWidth(node) * .75).attr("rx", 5);
  nodes.append("rect").attr("class", "node-ring")
    .attr("x", (node) => -cardWidth(node) / 2 - 5).attr("y", (node) => -cardWidth(node) * .375 - 5)
    .attr("width", (node) => cardWidth(node) + 10).attr("height", (node) => cardWidth(node) * .75 + 10).attr("rx", 9);
  nodes.append("text").attr("class", "node-label").attr("y", (node) => cardWidth(node) * .375 + 18)
    .text((node) => truncate(node.label, Math.max(17, Math.floor(cardWidth(node) / 5))));
  nodes.append("text").attr("class", "node-subtitle").attr("y", (node) => cardWidth(node) * .375 + 32)
    .text((node) => (TYPE_LABELS[node.type] || titleCase(node.type)) + " · " + (node.epoch || "Sense data"));
  return nodes;
}

function renderGraph(width, height) {
  const links = state.filteredLinks.map((link) => ({ ...link }));
  const link = state.root.append("g").attr("aria-hidden", true).selectAll("line").data(links).join("line")
    .attr("class", "link").attr("stroke-width", (item) => .6 + item.weight * 1.8);
  const nodes = createNodes();
  const update = () => {
    link.attr("x1", (item) => item.source.x).attr("y1", (item) => item.source.y)
      .attr("x2", (item) => item.target.x).attr("y2", (item) => item.target.y);
    nodes.attr("transform", (node) => "translate(" + node.x + "," + node.y + ")");
  };
  const freshLayout = state.filteredNodes.some((node) => !Number.isFinite(node.x));
  state.simulation = d3.forceSimulation(state.filteredNodes)
    .force("link", d3.forceLink(links).id((node) => node.id).distance(state.nodeSize * 1.9).strength(.28))
    .force("charge", d3.forceManyBody().strength(-460))
    .force("center", d3.forceCenter(width / 2, height / 2 + 35))
    .force("x", d3.forceX(width / 2).strength(.035))
    .force("y", d3.forceY(height / 2 + 35).strength(.045))
    .force("collision", d3.forceCollide().radius((node) => cardWidth(node) * .72 + 20).iterations(3))
    .alphaDecay(.045).on("tick", update).stop();
  // Pre-settle before fitting so every image starts inside the available canvas.
  state.simulation.tick(freshLayout ? 140 : 55);
  update();
  if (!state.paused) state.simulation.alpha(.06).restart();
  nodes.call(d3.drag().clickDistance(5)
    .on("start", (event, node) => {
      hideTooltip();
      if (!event.active && !state.paused) state.simulation.alphaTarget(.12).restart();
      node.fx = node.x; node.fy = node.y;
    })
    .on("drag", (event, node) => {
      node.fx = node.x = event.x; node.fy = node.y = event.y;
      update();
    })
    .on("end", (event, node) => {
      if (!event.active) state.simulation.alphaTarget(0);
      node.fx = null; node.fy = null;
    }));
}

function renderTimeline(width, height) {
  const size = state.nodeSize + 24;
  const years = state.filteredNodes.map((node) => epochStart(node.epoch)).filter((year) => year !== null);
  let [start, end] = d3.extent(years);
  if (start === undefined) { start = 1900; end = 2000; }
  if (start === end) { start -= 5; end += 5; }
  const hasUndated = years.length !== state.filteredNodes.length;
  const chartWidth = Math.max(width - 80, 900);
  const x = d3.scaleLinear().domain([start, end]).nice().range([130, chartWidth - (hasUndated ? size + 40 : 10)]);
  const positions = new Map();
  const rows = [];
  let rowY = 190;
  // Greedy lanes keep neighboring years and identical dates from covering each other.
  [...new Set(state.filteredNodes.map((node) => node.type))].forEach((type) => {
    const lanes = [];
    const items = state.filteredNodes.filter((node) => node.type === type)
      .sort((a, b) => (epochStart(a.epoch) ?? Infinity) - (epochStart(b.epoch) ?? Infinity));
    items.forEach((node) => {
      const nodeX = epochStart(node.epoch) === null ? chartWidth : x(epochStart(node.epoch));
      let lane = lanes.findIndex((right) => nodeX - size / 2 > right + 20);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = nodeX + size / 2;
      positions.set(node.id, { x: nodeX, y: rowY + lane * (size * .75 + 50) });
    });
    rows.push({ type, y: rowY });
    rowY += lanes.length * (size * .75 + 50) + 35;
  });
  const axisY = Math.max(height - 65, rowY - 20);
  state.root.append("g").attr("class", "timeline-grid").attr("transform", "translate(0," + axisY + ")")
    .call(d3.axisBottom(x).ticks(8).tickSize(-(axisY - 135)).tickFormat(""));
  state.root.append("g").attr("class", "timeline-axis").attr("transform", "translate(0," + axisY + ")")
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d")));
  const labels = state.root.append("g").attr("class", "timeline-axis");
  labels.selectAll("text").data(rows).join("text").attr("x", 0).attr("y", (row) => row.y)
    .text((row) => TYPE_LABELS[row.type] || titleCase(row.type));
  if (hasUndated) labels.append("text").attr("x", chartWidth).attr("y", axisY + 20).attr("text-anchor", "middle").text("Sense data");
  state.root.append("g").attr("aria-hidden", true).selectAll("path").data(state.filteredLinks).join("path")
    .attr("class", "link").attr("fill", "none").attr("stroke-width", (link) => .6 + link.weight * 1.8)
    .attr("d", (link) => {
      const a = positions.get(link.source), b = positions.get(link.target);
      return "M" + a.x + "," + a.y + " C" + a.x + "," + (a.y - 60) + " " + b.x + "," + (b.y - 60) + " " + b.x + "," + b.y;
    });
  createNodes().attr("transform", (node) => {
    const point = positions.get(node.id);
    return "translate(" + point.x + "," + point.y + ")";
  });
}

function renderGallery() {
  $("gallery").replaceChildren();
  state.filteredNodes.forEach((node) => {
    const card = element("article", "gallery-card");
    card.dataset.id = node.id;
    card.classList.toggle("is-selected", node.id === state.selectedId);
    const button = element("button", "gallery-image");
    button.type = "button";
    button.setAttribute("aria-label", "Amplia " + node.label);
    const img = element("img");
    img.src = node.image_url; img.alt = node.label; img.loading = "lazy";
    button.append(img, element("span", "", "↗"));
    button.addEventListener("click", () => openModal(node));
    const copy = element("div", "gallery-copy");
    const type = element("p", "", (TYPE_LABELS[node.type] || titleCase(node.type)) + " · " + (node.epoch || "Sense data"));
    type.style.color = nodeColor(node);
    const inspect = element("button", "text-button", "Consulta la fitxa →");
    inspect.type = "button";
    inspect.addEventListener("click", () => { selectNode(node); $("edit-image").focus(); });
    copy.append(type, element("h3", "", node.label), inspect);
    card.append(button, copy);
    $("gallery").append(card);
  });
}

function selectNode(node) {
  if (!node) return;
  state.selectedId = node.id;
  updateInfoPanel(node);
  $("focus-related").disabled = false;
  if ($("focus-related").checked) applyFilters();
  highlightRelated(node.id);
  document.querySelectorAll(".gallery-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.id === node.id));
}

function clearSelection() {
  state.selectedId = null;
  $("empty-state").hidden = false;
  $("profile").hidden = true;
  $("clear-selection").hidden = true;
  $("info-panel").classList.remove("has-selection");
  $("focus-related").checked = false;
  $("focus-related").disabled = true;
  highlightRelated(null);
}

function updateInfoPanel(node) {
  $("empty-state").hidden = true;
  $("profile").hidden = false;
  $("clear-selection").hidden = false;
  $("info-panel").classList.add("has-selection");
  $("panel-image").src = node.image_url;
  $("panel-image").alt = "Imatge de " + node.label;
  $("panel-category").textContent = CATEGORY_LABELS[node.category] || titleCase(node.category);
  $("panel-category").style.setProperty("--profile-color", nodeColor(node));
  $("profile-title").textContent = node.label;
  $("panel-description").textContent = node.description || "Aquesta imatge encara no té documentació. Edita la fitxa per afegir-hi context.";
  $("panel-metadata").replaceChildren();
  [["Tipus", TYPE_LABELS[node.type] || titleCase(node.type)], ["Autoria", node.author], ["Època", node.epoch || "Sense data"],
    ["Tècnica", titleCase(node.technique)], ["Exposició", node.exhibition], ["Lloc", node.location]].forEach(([label, value]) => {
    if (!value) return;
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    $("panel-metadata").append(row);
  });
  const links = state.links.filter((link) => isConnected(link, node.id));
  $("connection-count").textContent = links.length;
  $("panel-connections-list").replaceChildren();
  if (!links.length) $("panel-connections-list").append(element("li", "field-hint", "Cap connexió encara. Afegeix-ne una des de l’editor."));
  links.forEach((link) => {
    const related = state.byId.get(link.source === node.id ? link.target : link.source);
    const li = element("li");
    const button = element("button", "connection-button");
    button.type = "button";
    const img = element("img");
    img.src = related.image_url; img.alt = ""; img.loading = "lazy";
    const copy = element("span", "", related.label);
    copy.append(element("small", "connection-type", titleCase(link.type)));
    button.append(img, copy, element("span", "", "↗"));
    button.lastChild.style.flex = "0";
    button.addEventListener("click", () => {
      if (!state.filteredNodes.some((item) => item.id === related.id)) resetFilters();
      selectNode(related);
      focusNode(related.id);
    });
    li.append(button);
    $("panel-connections-list").append(li);
  });
  $("info-panel").scrollTop = 0;
}

function isConnected(link, id) { return nodeId(link.source) === id || nodeId(link.target) === id; }

function highlightRelated(id) {
  if (!svg) return;
  const related = state.neighbors.get(id);
  svg.selectAll(".node").classed("is-selected", (node) => node.id === state.selectedId)
    .attr("aria-pressed", (node) => String(node.id === state.selectedId))
    .classed("is-muted", (node) => Boolean(related && !related.has(node.id)));
  svg.selectAll(".link").classed("is-related", (link) => Boolean(id && isConnected(link, id)))
    .classed("is-muted", (link) => Boolean(id && !isConnected(link, id)));
}

function focusNode(id) {
  if (state.view === "gallery") return;
  const target = svg.selectAll(".node").filter((node) => node.id === id).node();
  if (!target || !state.zoom) return;
  const point = target.transform.baseVal.consolidate().matrix;
  const { width, height } = $("visualization").getBoundingClientRect();
  const scale = Math.max(.7, d3.zoomTransform(svg.node()).k);
  svg.transition().duration(reducedMotion ? 0 : 300).call(state.zoom.transform,
    d3.zoomIdentity.translate(width / 2 - point.e * scale, (height + 80) / 2 - point.f * scale).scale(scale));
}

function showTooltip(event, node) {
  $("tooltip").replaceChildren(element("strong", "", node.label),
    element("span", "", (TYPE_LABELS[node.type] || titleCase(node.type)) + " · " + (node.epoch || "Sense data")),
    element("span", "", node.degree + " connexions · Clic per ampliar"));
  $("tooltip").hidden = false;
  moveTooltip(event);
}
function moveTooltip(event) {
  const rect = $("tooltip").getBoundingClientRect();
  $("tooltip").style.left = Math.max(12, Math.min(event.clientX + 16, innerWidth - rect.width - 12)) + "px";
  $("tooltip").style.top = Math.max(12, Math.min(event.clientY + 16, innerHeight - rect.height - 12)) + "px";
}
function hideTooltip() { $("tooltip").hidden = true; }

function openModal(node) {
  if (!node) return;
  hideTooltip();
  state.modalIds = state.filteredNodes.map((item) => item.id);
  selectNode(node);
  updateModal(node);
  if (!$("image-modal").open) $("image-modal").showModal();
}

function updateModal(node) {
  state.modalId = node.id;
  $("modal-image").src = node.image_url;
  $("modal-image").alt = "Imatge ampliada de " + node.label;
  $("modal-category").textContent = CATEGORY_LABELS[node.category] || titleCase(node.category);
  $("modal-category").style.setProperty("--profile-color", nodeColor(node));
  $("modal-title").textContent = node.label;
  $("modal-description").textContent = node.description || "Sense documentació encara.";
  $("modal-metadata").textContent = [TYPE_LABELS[node.type] || titleCase(node.type), node.epoch || "Sense data", node.author, titleCase(node.technique), node.exhibition, node.location].filter(Boolean).join(" · ");
  $("image-position").textContent = (state.modalIds.indexOf(node.id) + 1) + " / " + state.modalIds.length;
  $("previous-image").disabled = $("next-image").disabled = state.modalIds.length < 2;
  if (originalObjectURL) URL.revokeObjectURL(originalObjectURL);
  originalObjectURL = null;
  const original = $("original-image");
  // Data URLs cannot be opened at top level in some browsers. Download uploaded
  // originals as attachments, which also avoids executing uploaded SVG documents.
  if (node.image_url.startsWith("data:")) {
    const [header, payload] = node.image_url.split(",");
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    originalObjectURL = URL.createObjectURL(new Blob([bytes], { type: header.slice(5, header.indexOf(";")) }));
    original.href = originalObjectURL;
    const extension = header.includes("svg+xml") ? "svg" : header.slice(11, header.indexOf(";"));
    original.download = node.label.replace(/[<>:"/\\|?*]/g, "-") + "." + extension;
    original.textContent = "Descarrega l’original ↓";
  } else {
    original.href = node.image_url;
    original.removeAttribute("download");
    original.textContent = "Obre l’original ↗";
  }
}

function navigateModal(direction) {
  const index = state.modalIds.indexOf(state.modalId);
  const id = state.modalIds[(index + direction + state.modalIds.length) % state.modalIds.length];
  const node = state.byId.get(id);
  if (node) { selectNode(node); updateModal(node); }
}

function zoomBy(factor) {
  if (state.zoom && state.filteredNodes.length) svg.transition().duration(reducedMotion ? 0 : 180).call(state.zoom.scaleBy, factor);
}

function fitView(animate) {
  if (!state.root || !state.zoom || !state.filteredNodes.length || state.view === "gallery") return;
  const bounds = state.root.node().getBBox();
  const { width, height } = $("visualization").getBoundingClientRect();
  const availableHeight = Math.max(120, height - 200);
  const scale = Math.max(.08, Math.min(1.15, (width - 60) / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1)));
  const transform = d3.zoomIdentity.translate(
    width / 2 - (bounds.x + bounds.width / 2) * scale,
    140 + availableHeight / 2 - (bounds.y + bounds.height / 2) * scale
  ).scale(scale);
  svg.interrupt();
  if (animate && !reducedMotion) svg.transition().duration(300).call(state.zoom.transform, transform);
  else svg.call(state.zoom.transform, transform);
}

loadData();
