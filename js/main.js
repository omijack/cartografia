/* global d3 */

const TYPE_LABELS = {
  obra: "Obra",
  autor: "Autoria",
  corrent: "Corrent",
  tecnica: "Tècnica",
  tema: "Tema"
};

const CATEGORY_LABELS = {
  precursores: "Precursores",
  contemporanis: "Contemporanis",
  transmedia: "Transmèdia",
  digital: "Digital",
  experimental: "Experimental"
};

const TYPE_COLORS = {
  obra: "#ef8354",
  autor: "#5bc0be",
  corrent: "#a88beb",
  tecnica: "#e6c75c",
  tema: "#f08cae"
};

const state = {
  nodes: [],
  links: [],
  filteredNodes: [],
  filteredLinks: [],
  view: "graph",
  selectedId: null,
  simulation: null,
  zoom: null,
  resizeTimer: null,
  lastFocused: null
};

const dom = {
  svg: d3.select("#graph"),
  visualization: document.querySelector("#visualization"),
  loading: document.querySelector("#loading"),
  noResults: document.querySelector("#no-results"),
  tooltip: document.querySelector("#tooltip"),
  resultCount: document.querySelector("#result-count"),
  search: document.querySelector("#search"),
  typeFilter: document.querySelector("#filter-type"),
  categoryFilter: document.querySelector("#filter-category"),
  epochFilter: document.querySelector("#filter-epoch"),
  clearFilters: document.querySelector("#clear-filters"),
  resetView: document.querySelector("#reset-view"),
  viewDescription: document.querySelector("#view-description"),
  emptyState: document.querySelector("#empty-state"),
  profile: document.querySelector("#profile"),
  panelImageButton: document.querySelector("#panel-image-button"),
  panelImage: document.querySelector("#panel-image"),
  panelCategory: document.querySelector("#panel-category"),
  profileTitle: document.querySelector("#profile-title"),
  panelDescription: document.querySelector("#panel-description"),
  panelType: document.querySelector("#panel-type"),
  panelEpoch: document.querySelector("#panel-epoch"),
  panelTechnique: document.querySelector("#panel-technique"),
  connectionsList: document.querySelector("#panel-connections-list"),
  modal: document.querySelector("#image-modal"),
  modalImage: document.querySelector("#modal-image"),
  modalCategory: document.querySelector("#modal-category"),
  modalTitle: document.querySelector("#modal-title"),
  modalDescription: document.querySelector("#modal-description"),
  modalMetadata: document.querySelector("#modal-metadata"),
  modalClose: document.querySelector(".close-modal")
};

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ca");

const titleCase = (value) =>
  String(value || "—")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("ca"));

const nodeId = (value) => String(typeof value === "object" ? value.id : value);
const nodeColor = (node) => TYPE_COLORS[node.type] || "#aeb8c2";
const epochStart = (epoch) => Number.parseInt(String(epoch).match(/\d{4}/)?.[0], 10) || 0;

async function loadData() {
  try {
    const [nodes, links] = await Promise.all([
      d3.csv("data/comics.csv", (row) => ({
        ...row,
        id: String(row.id),
        relationIds: String(row.relations || "").split(";").filter(Boolean)
      })),
      d3.csv("data/relations.csv", (row) => ({
        ...row,
        source: String(row.source),
        target: String(row.target),
        weight: Number(row.weight) || 0.3
      }))
    ]);

    state.nodes = nodes;
    state.links = links.filter((link) =>
      nodes.some((node) => node.id === link.source) && nodes.some((node) => node.id === link.target)
    );

    state.nodes.forEach((node) => {
      node.degree = state.links.filter(
        (link) => nodeId(link.source) === node.id || nodeId(link.target) === node.id
      ).length;
    });

    populateFilters();
    renderLegend();
    bindControls();
    applyFilters();
    dom.loading.hidden = true;
  } catch (error) {
    console.error(error);
    dom.loading.innerHTML = `
      <div class="error-message">
        <strong>No s'han pogut carregar les dades.</strong><br>
        Obre el projecte mitjançant un servidor local (consulta el README) i torna-ho a provar.
      </div>`;
  }
}

function populateFilters() {
  addOptions(dom.typeFilter, [...new Set(state.nodes.map((node) => node.type))], TYPE_LABELS);
  addOptions(dom.categoryFilter, [...new Set(state.nodes.map((node) => node.category))], CATEGORY_LABELS);
  addOptions(
    dom.epochFilter,
    [...new Set(state.nodes.map((node) => node.epoch))].sort((a, b) => epochStart(a) - epochStart(b))
  );
}

function addOptions(select, values, labels = {}) {
  values.sort((a, b) => String(labels[a] || a).localeCompare(String(labels[b] || b), "ca"));
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labels[value] || titleCase(value);
    select.append(option);
  });
}

function renderLegend() {
  const types = [...new Set(state.nodes.map((node) => node.type))];
  d3.select("#legend")
    .selectAll("span.legend-item")
    .data(types)
    .join("span")
    .attr("class", "legend-item")
    .html(
      (type) =>
        `<i class="legend-dot" style="--dot-color:${TYPE_COLORS[type] || "#aeb8c2"}"></i>${TYPE_LABELS[type] || titleCase(type)}`
    );
}

function bindControls() {
  [dom.typeFilter, dom.categoryFilter, dom.epochFilter].forEach((control) => {
    control.addEventListener("change", applyFilters);
  });
  dom.search.addEventListener("input", applyFilters);

  dom.clearFilters.addEventListener("click", () => {
    dom.search.value = "";
    dom.typeFilter.value = "all";
    dom.categoryFilter.value = "all";
    dom.epochFilter.value = "all";
    applyFilters();
  });

  document.querySelectorAll(".view-button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  dom.resetView.addEventListener("click", resetView);
  dom.panelImageButton.addEventListener("click", () => {
    const selected = state.nodes.find((node) => node.id === state.selectedId);
    if (selected) openModal(selected);
  });

  document.querySelectorAll("[data-close-modal]").forEach((control) => {
    control.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", handleGlobalKeydown);

  new ResizeObserver(() => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(render, 120);
  }).observe(dom.visualization);
}

function applyFilters() {
  const query = normalize(dom.search.value.trim());
  const type = dom.typeFilter.value;
  const category = dom.categoryFilter.value;
  const epoch = dom.epochFilter.value;

  state.filteredNodes = state.nodes.filter((node) => {
    const haystack = normalize(
      [node.label, node.description, node.type, node.category, node.technique, node.epoch].join(" ")
    );
    return (
      (!query || haystack.includes(query)) &&
      (type === "all" || node.type === type) &&
      (category === "all" || node.category === category) &&
      (epoch === "all" || node.epoch === epoch)
    );
  });

  const visibleIds = new Set(state.filteredNodes.map((node) => node.id));
  state.filteredLinks = state.links
    .filter((link) => visibleIds.has(nodeId(link.source)) && visibleIds.has(nodeId(link.target)))
    .map((link) => ({ ...link, source: nodeId(link.source), target: nodeId(link.target) }));

  const count = state.filteredNodes.length;
  dom.resultCount.textContent = `${count} ${count === 1 ? "element visible" : "elements visibles"} · ${state.filteredLinks.length} ${state.filteredLinks.length === 1 ? "relació" : "relacions"}`;
  dom.noResults.hidden = count !== 0;

  if (state.selectedId && !visibleIds.has(state.selectedId)) clearSelection();
  render();
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  document.querySelectorAll(".view-button").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  dom.viewDescription.textContent =
    view === "graph"
      ? "Relacions entre obres, autories, corrents i tècniques"
      : "El corpus ordenat per data; les línies conserven les relacions";
  dom.svg.select("#graph-title").text(view === "graph" ? "Xarxa del còmic expandit" : "Cronologia del còmic expandit");
  render();
}

function render() {
  if (!state.nodes.length) return;
  if (state.simulation) state.simulation.stop();

  const { width, height } = dom.visualization.getBoundingClientRect();
  if (!width || !height) return;

  dom.svg.attr("viewBox", `0 0 ${width} ${height}`);
  dom.svg.selectAll(".rendered-layer").remove();

  const root = dom.svg.append("g").attr("class", "rendered-layer graph-layer");
  state.zoom = d3
    .zoom()
    .scaleExtent([0.35, 4])
    .filter((event) => !event.target.closest?.(".node") && !event.button)
    .on("zoom", (event) => root.attr("transform", event.transform));
  dom.svg.call(state.zoom).on("dblclick.zoom", null);

  if (!state.filteredNodes.length) return;
  if (state.view === "graph") renderGraph(root, width, height);
  else renderTimeline(root, width, height);
}

function renderGraph(root, width, height) {
  const links = state.filteredLinks.map((link) => ({ ...link }));
  const radius = d3
    .scaleSqrt()
    .domain([0, d3.max(state.nodes, (node) => node.degree) || 1])
    .range([8, 19]);

  const link = root
    .append("g")
    .attr("aria-hidden", "true")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "link")
    .attr("stroke-width", (item) => 0.6 + item.weight * 2.4);

  const node = createNodes(root, (item) => radius(item.degree));

  state.simulation = d3
    .forceSimulation(state.filteredNodes)
    .force("link", d3.forceLink(links).id((item) => item.id).distance((item) => 175 + (1 - item.weight) * 120).strength(0.38))
    .force("charge", d3.forceManyBody().strength(-680))
    .force("center", d3.forceCenter(width / 2, height / 2 + 12))
    .force("x", d3.forceX(width / 2).strength(0.018))
    .force("y", d3.forceY(height / 2).strength(0.024))
    .force("collision", d3.forceCollide().radius((item) => radius(item.degree) + 38).iterations(2))
    .alpha(0.85)
    .alphaDecay(0.035)
    .on("tick", () => {
      link
        .attr("x1", (item) => item.source.x)
        .attr("y1", (item) => item.source.y)
        .attr("x2", (item) => item.target.x)
        .attr("y2", (item) => item.target.y);
      node.attr("transform", (item) => `translate(${item.x},${item.y})`);
    });

  node.call(
    d3
      .drag()
      .on("start", (event, item) => {
        hideTooltip();
        if (!event.active) state.simulation.alphaTarget(0.2).restart();
        item.fx = item.x;
        item.fy = item.y;
      })
      .on("drag", (event, item) => {
        item.fx = event.x;
        item.fy = event.y;
      })
      .on("end", (event, item) => {
        if (!event.active) state.simulation.alphaTarget(0);
        item.fx = null;
        item.fy = null;
      })
  );

  updateHighlight(node, link);
}

function renderTimeline(root, width, height) {
  const margin = { top: 86, right: 66, bottom: 54, left: 66 };
  const years = state.filteredNodes.map((node) => epochStart(node.epoch));
  let domain = d3.extent(years);
  if (domain[0] === domain[1]) domain = [domain[0] - 5, domain[1] + 5];

  const x = d3.scaleLinear().domain(domain).nice().range([margin.left, width - margin.right]);
  const types = [...new Set(state.filteredNodes.map((node) => node.type))];
  const y = d3.scalePoint().domain(types).range([margin.top + 30, height - margin.bottom - 18]).padding(0.4);

  root
    .append("g")
    .attr("class", "timeline-grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(width / 140))).tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));

  root
    .append("g")
    .attr("class", "timeline-axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(width / 140))).tickFormat(d3.format("d")));

  root
    .append("g")
    .attr("class", "timeline-axis")
    .attr("transform", `translate(${margin.left - 15},0)`)
    .call(d3.axisLeft(y).tickSize(0).tickPadding(10).tickFormat((type) => TYPE_LABELS[type] || titleCase(type)))
    .call((axis) => axis.select(".domain").remove());

  const positions = new Map();
  const overlaps = new Map();
  [...state.filteredNodes]
    .sort((a, b) => epochStart(a.epoch) - epochStart(b.epoch))
    .forEach((item) => {
      const key = `${item.type}-${epochStart(item.epoch)}`;
      const index = overlaps.get(key) || 0;
      overlaps.set(key, index + 1);
      positions.set(item.id, {
        x: x(epochStart(item.epoch)) + (index % 3) * 12 - Math.min(index, 2) * 6,
        y: y(item.type) + Math.floor(index / 3) * 16
      });
    });

  const link = root
    .append("g")
    .attr("aria-hidden", "true")
    .selectAll("path")
    .data(state.filteredLinks)
    .join("path")
    .attr("class", "link")
    .attr("fill", "none")
    .attr("stroke-width", (item) => 0.6 + item.weight * 2)
    .attr("d", (item) => {
      const source = positions.get(nodeId(item.source));
      const target = positions.get(nodeId(item.target));
      const bend = Math.max(20, Math.abs(target.x - source.x) * 0.22);
      return `M${source.x},${source.y} C${source.x},${source.y - bend} ${target.x},${target.y - bend} ${target.x},${target.y}`;
    });

  const node = createNodes(root, () => 10)
    .attr("transform", (item) => {
      const position = positions.get(item.id);
      return `translate(${position.x},${position.y})`;
    });

  updateHighlight(node, link);
}

function createNodes(root, radiusAccessor) {
  const node = root
    .append("g")
    .selectAll("g.node")
    .data(state.filteredNodes, (item) => item.id)
    .join("g")
    .attr("class", (item) => `node${item.id === state.selectedId ? " is-selected" : ""}`)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (item) => `${item.label}. ${TYPE_LABELS[item.type] || item.type}, ${item.epoch}. Obre la imatge.`)
    .on("mouseenter", (event, item) => {
      showTooltip(event, item);
      highlightRelated(item.id);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", () => {
      hideTooltip();
      highlightRelated(state.selectedId);
    })
    .on("focus", (event, item) => highlightRelated(item.id))
    .on("blur", () => highlightRelated(state.selectedId))
    .on("click", (event, item) => {
      if (event.defaultPrevented) return;
      selectNode(item, true);
    })
    .on("keydown", (event, item) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(item, true);
      }
    });

  node
    .append("circle")
    .attr("class", "halo")
    .attr("r", (item) => radiusAccessor(item) + 8)
    .attr("stroke", nodeColor);

  node
    .append("circle")
    .attr("class", "node-core")
    .attr("r", radiusAccessor)
    .attr("fill", nodeColor);

  node
    .append("circle")
    .attr("class", "node-ring")
    .attr("r", (item) => radiusAccessor(item) + 4);

  node
    .append("text")
    .attr("text-anchor", "middle")
    .attr("y", (item) => radiusAccessor(item) + 17)
    .text((item) => truncate(item.label, 26));

  return node;
}

function selectNode(node, showImage = false) {
  state.selectedId = node.id;
  updateInfoPanel(node);
  highlightRelated(node.id);
  dom.svg.selectAll(".node").classed("is-selected", (item) => item.id === node.id);
  if (showImage) openModal(node);
}

function clearSelection() {
  state.selectedId = null;
  dom.emptyState.hidden = false;
  dom.profile.hidden = true;
  highlightRelated(null);
}

function updateInfoPanel(node) {
  dom.emptyState.hidden = true;
  dom.profile.hidden = false;
  dom.panelImage.src = node.image_url;
  dom.panelImage.alt = `Imatge de ${node.label}`;
  dom.panelCategory.textContent = CATEGORY_LABELS[node.category] || titleCase(node.category);
  dom.panelCategory.style.setProperty("--profile-color", nodeColor(node));
  dom.profileTitle.textContent = node.label;
  dom.panelDescription.textContent = node.description;
  dom.panelType.textContent = TYPE_LABELS[node.type] || titleCase(node.type);
  dom.panelEpoch.textContent = node.epoch;
  dom.panelTechnique.textContent = titleCase(node.technique);

  const connections = state.links
    .filter((link) => nodeId(link.source) === node.id || nodeId(link.target) === node.id)
    .map((link) => ({
      link,
      node: state.nodes.find((candidate) =>
        candidate.id === (nodeId(link.source) === node.id ? nodeId(link.target) : nodeId(link.source))
      )
    }))
    .filter((item) => item.node);

  dom.connectionsList.replaceChildren();
  if (!connections.length) {
    const item = document.createElement("li");
    item.textContent = "Sense connexions documentades";
    dom.connectionsList.append(item);
    return;
  }

  connections.forEach(({ link, node: related }) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "connection-button";
    button.innerHTML = `<span>${related.label}</span><span class="connection-type">${titleCase(link.type)}</span>`;
    button.addEventListener("click", () => {
      if (!state.filteredNodes.some((candidate) => candidate.id === related.id)) {
        dom.search.value = "";
        dom.typeFilter.value = "all";
        dom.categoryFilter.value = "all";
        dom.epochFilter.value = "all";
        applyFilters();
      }
      state.selectedId = related.id;
      updateInfoPanel(related);
      render();
    });
    item.append(button);
    dom.connectionsList.append(item);
  });
}

function updateHighlight(nodeSelection, linkSelection) {
  if (!state.selectedId) return;
  const relatedIds = getRelatedIds(state.selectedId);
  nodeSelection
    .classed("is-selected", (item) => item.id === state.selectedId)
    .classed("is-muted", (item) => !relatedIds.has(item.id));
  linkSelection
    .classed("is-related", (item) => isConnected(item, state.selectedId))
    .classed("is-muted", (item) => !isConnected(item, state.selectedId));
}

function highlightRelated(id) {
  const nodes = dom.svg.selectAll(".node");
  const links = dom.svg.selectAll(".link");
  if (!id) {
    nodes.classed("is-muted", false);
    links.classed("is-muted", false).classed("is-related", false);
    return;
  }

  const relatedIds = getRelatedIds(id);
  nodes.classed("is-muted", (item) => !relatedIds.has(item.id));
  links
    .classed("is-related", (item) => isConnected(item, id))
    .classed("is-muted", (item) => !isConnected(item, id));
}

function getRelatedIds(id) {
  const ids = new Set([id]);
  state.links.forEach((link) => {
    if (nodeId(link.source) === id) ids.add(nodeId(link.target));
    if (nodeId(link.target) === id) ids.add(nodeId(link.source));
  });
  return ids;
}

function isConnected(link, id) {
  return nodeId(link.source) === id || nodeId(link.target) === id;
}

function showTooltip(event, node) {
  dom.tooltip.innerHTML = `
    <div class="tooltip-content">
      <img src="${node.image_url}" alt="">
      <div><strong>${node.label}</strong><span>${TYPE_LABELS[node.type] || titleCase(node.type)} · ${node.epoch}</span></div>
    </div>`;
  dom.tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const gap = 15;
  const width = 220;
  const x = Math.min(event.clientX + gap, window.innerWidth - width - gap);
  const y = Math.min(event.clientY + gap, window.innerHeight - 90);
  dom.tooltip.style.left = `${Math.max(gap, x)}px`;
  dom.tooltip.style.top = `${Math.max(gap, y)}px`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
}

function openModal(node) {
  state.lastFocused = document.activeElement;
  dom.modalImage.src = node.image_url;
  dom.modalImage.alt = `Imatge ampliada de ${node.label}`;
  dom.modalCategory.textContent = CATEGORY_LABELS[node.category] || titleCase(node.category);
  dom.modalCategory.style.setProperty("--profile-color", nodeColor(node));
  dom.modalTitle.textContent = node.label;
  dom.modalDescription.textContent = node.description;
  dom.modalMetadata.textContent = `${TYPE_LABELS[node.type] || titleCase(node.type)} · ${node.epoch} · ${titleCase(node.technique)}`;
  dom.modal.hidden = false;
  document.body.classList.add("has-modal");
  window.requestAnimationFrame(() => dom.modalClose.focus());
}

function closeModal() {
  if (dom.modal.hidden) return;
  dom.modal.hidden = true;
  document.body.classList.remove("has-modal");
  dom.modalImage.src = "";
  state.lastFocused?.focus?.();
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && !dom.modal.hidden) {
    closeModal();
    return;
  }

  if (event.key === "Tab" && !dom.modal.hidden) {
    const focusable = [...dom.modal.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function resetView() {
  dom.svg.transition().duration(350).call(state.zoom.transform, d3.zoomIdentity);
  if (state.view === "graph" && state.simulation) state.simulation.alpha(0.45).restart();
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

loadData();
