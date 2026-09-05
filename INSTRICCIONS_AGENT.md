# Instruccions per a agent de codi: Cartografia Interactiva de Còmic Expandit

## Objectiu del projecte

Crear una visualització interactiva de xarxa (graf) amb D3.js per a un projecte doctoral sobre **còmic expandit**. L'usuari té un arxiu d'imatges que vol classificar, relacionar i visualitzar en format de mapa o graf interactiu.

**Requisit clau**: En fer clic a un node, s'ha d'obrir la imatge associada en resolució original (lightbox/modal).

---

## Estructura de dades

### Fitxer CSV/JSON principal (`data/comics.csv`)

```csv
id,label,type,category,epoch,technique,image_url,description,relations
1,"Veus de l'ànima",obra,precursores,1960-1970,mixed_media,https://exemple.com/img1.jpg,"Obra pionera del còmic expandit","2;3;5"
2,"Muntanyes possibles",obra,precursores,1970-1980,collage,https://exemple.com/img2.jpg,"Exploració del format","1;4"
3,"L'illa del tresor",adaptacio,adaptacions,1980-1990,watercolor,https://exemple.com/img3.jpg,"Adaptació clàssica","1;5"
```

### Camps obligatoris

| Camp | Descripció | Tipus |
|------|------------|-------|
| `id` | Identificador únic | number |
| `label` | Nom de l'obra/element | string |
| `type` | Tipus d'element (obra, autor, corrent, tècnica, tema) | string |
| `category` | Categoria per agrupació (precursores, contemporanis, etc.) | string |
| `epoch` | Període temporal | string |
| `technique` | Tècnica artística | string |
| `image_url` | URL de la imatge en resolució original | string (URL) |
| `description` | Descripció breu | string |
| `relations` | IDs d'altres nodes connectats (separats per `;`) | string |

### Fitxer de relacions (`data/relations.csv`)

```csv
source,target,type,weight
1,2,influencia,0.8
1,3,adaptacio,0.5
2,4,contemporani,0.3
```

---

## Requisits tècnics

### Stack tecnològic

- **D3.js v7** (d3js.org)
- **HTML5 + CSS3**
- **JavaScript ES6+**
- Sense frameworks (vanilla JS)
- Fitxer únic HTML amb CSS i JS inclosos (o fitxers separats segons convengui)

### Estructura de fitxers

```
cartografia-comic/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── main.js
├── data/
│   ├── comics.csv
│   └── relations.csv
└── img/
    └── (imatges localment si cal)
```

---

## Funcionalitats requerides

### 1. Graf de xarxa (force-directed graph)

```javascript
// Simulació de forces
const simulation = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id(d => d.id).distance(150))
  .force("charge", d3.forceManyBody().strength(-300))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(50));
```

- Nodes amb mida variable segons nombre de connexions
- Color segons `category` o `type`
- Línies amb gruix segons `weight`
- Drag & drop per reordenar nodes
- Zoom i pan

### 2. Lightbox per a imatges (REQUISIT CRÍTIC)

En fer clic a un node, obrir un modal/lightbox amb la imatge en resolució original:

```javascript
// Opció 1: Lightbox custom
function openLightbox(d) {
  const modal = d3.select("#image-modal");
  modal.select("img").attr("src", d.image_url);
  modal.select(".modal-title").text(d.label);
  modal.select(".modal-description").text(d.description);
  modal.style("display", "flex");
}

// Opció 2: Usar GLightbox (millor opció)
// Incloure GLightbox CDN:
// <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/glightbox/dist/css/glightbox.min.css">
// <script src="https://cdn.jsdelivr.net/npm/glightbox/dist/js/glightbox.min.js"></script>

const lightbox = GLightbox({
  elements: [
    {
      href: d.image_url,
      title: d.label,
      description: d.description,
      type: 'image'
    }
  ]
});
```

**Estructura HTML del modal:**

```html
<div id="image-modal" class="modal">
  <div class="modal-content">
    <span class="close-modal">&times;</span>
    <img id="modal-image" src="" alt="">
    <div class="modal-info">
      <h3 class="modal-title"></h3>
      <p class="modal-description"></p>
      <div class="modal-metadata"></div>
    </div>
  </div>
</div>
```

**CSS del modal:**

```css
.modal {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.9);
  z-index: 1000;
  justify-content: center;
  align-items: center;
}

.modal-content {
  max-width: 90vw;
  max-height: 90vh;
  position: relative;
}

#modal-image {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
}

.close-modal {
  position: absolute;
  top: -40px;
  right: 0;
  color: white;
  font-size: 30px;
  cursor: pointer;
}
```

### 3. Filtres i classificació

Panell lateral o barra superior amb filtres:

```html
<div class="filters">
  <select id="filter-type">
    <option value="all">Tots els tipus</option>
    <option value="obra">Obres</option>
    <option value="autor">Autors</option>
    <option value="corrent">Corrents</option>
  </select>

  <select id="filter-category">
    <option value="all">Totes les categories</option>
    <option value="precursores">Precursors</option>
    <option value="contemporanis">Contemporanis</option>
  </select>

  <select id="filter-epoch">
    <option value="all">Totes les èpoques</option>
    <option value="1960-1970">1960-1970</option>
    <option value="1970-1980">1970-1980</option>
  </select>
</div>
```

**Lògica de filtre:**

```javascript
function filterNodes() {
  const typeFilter = document.getElementById('filter-type').value;
  const categoryFilter = document.getElementById('filter-category').value;

  const filtered = nodes.filter(d => {
    const matchType = typeFilter === 'all' || d.type === typeFilter;
    const matchCategory = categoryFilter === 'all' || d.category === categoryFilter;
    return matchType && matchCategory;
  });

  updateGraph(filtered);
}
```

### 4. Panell d'informació (profile)

En seleccionar un node, mostrar detalls en un panell lateral:

```html
<div id="info-panel" class="info-panel">
  <h2 id="panel-title"></h2>
  <img id="panel-image" src="" alt="" style="max-width: 100%;">
  <p id="panel-description"></p>
  <div id="panel-metadata">
    <p><strong>Tipus:</strong> <span id="panel-type"></span></p>
    <p><strong>Època:</strong> <span id="panel-epoch"></span></p>
    <p><strong>Tècnica:</strong> <span id="panel-technique"></span></p>
  </div>
  <div id="panel-connections">
    <h3>Connexions</h3>
    <ul id="panel-connections-list"></ul>
  </div>
</div>
```

### 5. Visualització alternativa: Cronologia

Afegir opció per canviar entre vista de graf i cronologia:

```javascript
// Timeline mode
function showTimeline() {
  const xScale = d3.scaleTime()
    .domain(d3.extent(nodes, d => parseEpoch(d.epoch)))
    .range([0, width]);

  // Dibuixar nodes en línia temporal
}
```

---

## Disseny visual

### Paleta de colors

```css
:root {
  --color-obra: #4A90D9;
  --color-autor: #E74C3C;
  --color-corrent: #2ECC71;
  --color-tecnica: #F39C12;
  --color-tema: #9B59B6;
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
}
```

### Fonts

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

h1, h2, h3 {
  font-family: 'Playfair Display', Georgia, serif;
}
```

### Layout

```
┌─────────────────────────────────────────────────────┐
│  CARTOGRAFIA DEL CÒMIC EXPANDIT                    │
├──────────────┬──────────────────────────────────────┤
│  FILTRES     │                                      │
│  ┌────────┐  │                                      │
│  │ Tipus  │  │         GRAF / MAPA                  │
│  └────────┘  │         INTERACTIU                   │
│  ┌────────┐  │                                      │
│  │Categoria│ │                                      │
│  └────────┘  │                                      │
│  ┌────────┐  │                                      │
│  │ Època  │  │                                      │
│  └────────┘  │                                      │
├──────────────┤                                      │
│  PANELL      │                                      │
│  INFO        │                                      │
│  ┌────────┐  │                                      │
│  │Imatge  │  │                                      │
│  │Detalls │  │                                      │
│  └────────┘  │                                      │
└──────────────┴──────────────────────────────────────┘
```

---

## Interaccions

1. **Hover sobre node**: Mostrar popover amb info bàsica i miniatura
2. **Clic sobre node**: Obrir lightbox amb imatge original + panell d'info
3. **Clic fora del modal**: Tancar lightbox
- **Escape**: Tancar lightbox
4. **Scroll sobre graf**: Zoom in/out
5. **Drag sobre node**: Moure node (reordenar)
6. **Canvi de filtre**: Actualitzar grafs amb animació de transició

---

## Comportament de càrrega

1. Carregar CSV/JSON de dades
2. Parsejar relacions
3. Inicialitzar simulació D3
4. Dibuixar nodes i línies
5. Afegir event listeners
6. Mostrar grafs amb animació d'entrada

---

## Restriccions

- **NO** usar cap framework (React, Vue, Angular)
- **NO** usar jQuery
- **NO** fer servir serveis externs per a les imatges (les URLs del CSV són les originals)
- **SI** usar D3.js v7
- **SI** ser responsive (funcionar en mòbil i desktop)
- **SI** ser accessible (aria labels, keyboard navigation)

---

## Exemples de referència

- [D3 Force Directed Graph](https://observablehq.com/@d3/force-directed-graph)
- [D3 Graph with Images](https://bl.ocks.org/mbostock/950642)
- [GLightbox](https://biati.digital/glightbox/)
- [Kumu](https://kumu.io) (per a comparar funcionalitats)

---

## Fitxers de sortida esperats

```
cartografia-comic/
├── index.html              ← Pàgina principal
├── css/
│   └── style.css           ← Estils
├── js/
│   └── main.js             ← Lògica D3.js
├── data/
│   ├── comics.csv          ← Dades dels elements
│   └── relations.csv       ← Relacions entre elements
└── INSTRICCIONS_AGENT.md   ← Aquest fitxer
```

---

## Notes per a l'agent

- Prioritzar la **llegibilitat del codi**
- Afegir **comentaris** en les parts complexes
- Assegurar que el **lightbox funcioni** correctament (provar amb imatges reals)
- El graf ha de ser **suau** (60fps) fins a 200 nodes
- Fer **test** en diferents mides de pantalla
