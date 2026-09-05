# Cartografia del còmic expandit

Visualització interactiva d’un corpus de còmic expandit amb D3.js v7. Inclou una vista de xarxa, una cronologia, filtres combinables, cerca, fitxes d’informació i ampliació de les imatges originals.

## Executar el projecte

Els navegadors bloquegen la càrrega directa de CSV des de `file://`. Inicia un servidor local a l’arrel del projecte:

```bash
python3 -m http.server 8000
```

Després obre <http://localhost:8000>.

## Editar el corpus

- `data/comics.csv`: nodes, textos, classificació i ruta de la imatge.
- `data/relations.csv`: connexions entre nodes, tipus de relació i pes.
- `img/`: imatges originals o il·lustracions associades als nodes.

Els identificadors de `source` i `target` han de coincidir amb el camp `id` de `comics.csv`. El pes de cada relació ha de ser un valor entre 0 i 1.

## Estructura

```text
index.html
css/style.css
js/main.js
data/comics.csv
data/relations.csv
img/
```

No cal cap procés de compilació. D3.js v7 es carrega des de jsDelivr.
