# Cartografia del còmic expandit

Arxiu visual per documentar imatges d’obres i exposicions de còmic expandit, establir-hi relacions i explorar-les amb D3.js v7. Interfície en català, sense frameworks ni procés de compilació.

## Explorar i documentar

- **Xarxa:** nodes amb miniatures completes, marcs segons el tipus i mida segons les connexions. Arrossega imatges o el fons, utilitza el zoom i enquadra tot el mapa. Pots pausar el moviment, canviar la mida de les miniatures i ocultar-ne els títols.
- **Galeria:** recorre les imatges i accedeix directament a cada fitxa.
- **Cronologia:** situa les imatges per l’any inicial de l’època, amb carrils per evitar superposicions i un espai per a les imatges sense data.
- **Fitxes:** documentació, autoria, tipus, categoria, època, tècnica, exposició i localització. Les connexions inclouen miniatures navegables.
- **Filtres:** cerca sense distingir accents, filtres combinables i llegenda clicable. «Només les connexions» aïlla l’entorn de la imatge seleccionada.
- **Imatges originals:** clic o Retorn sobre una miniatura per ampliar-la; fletxes esquerra/dreta per navegar; Escape per tancar. Espai sobre un node obre la fitxa. Els diàlegs mantenen el focus del teclat.
- **Edició:** «Afegeix imatge» permet pujar un original; «Edita la fitxa i les relacions» permet documentar-lo i afegir o eliminar connexions. «Cancel·la» descarta l’esborrany.

Les imatges incloses a `img/` són il·lustracions de mostra, no reproduccions originals de les obres.

## Desament i còpies

Les fitxes, les relacions i els originals pujats es desen conjuntament a **IndexedDB, només en aquest navegador i aquesta adreça web**. Es recuperen en recarregar. Els CSV del projecte no es modifiquen.

Utilitza **Exporta l’arxiu** per descarregar un JSON i **Importa** per recuperar-lo. La importació valida el contingut i demana confirmació abans de substituir el corpus local. La còpia inclou les imatges pujades; les imatges indicades amb una ruta o URL conserven aquesta referència, de manera que cal conservar també `img/` o l’accés als originals externs.

Formats admesos: JPG, PNG, WebP, GIF i SVG, fins a 10 MB per imatge; arxiu fins a 100 MB, 2.000 fitxes i 20.000 relacions (l’espai disponible depèn del navegador). Les imatges pujades mantenen els bytes originals. Les noves connexions tenen pes 0,7; els pesos existents es conserven.

Aquest és un **portal local de treball**: encara no hi ha servidor d’aplicació, comptes d’usuari, sincronització entre dispositius ni còpies automàtiques. Per mantenir un repositori compartit caldrà afegir aquests serveis. Esborrar les dades del navegador elimina l’arxiu local; conserva’n exportacions. Dues pestanyes que editin simultàniament no fusionen els canvis.

## Executar el projecte

Els navegadors bloquegen la càrrega directa de CSV des de `file://`. Inicia un servidor local a l’arrel del projecte:

```bash
python3 -m http.server 8000
```

Després obre <http://localhost:8000>.

## Corpus inicial

- `data/comics.csv`: nodes, textos, classificació i ruta de la imatge.
- `data/relations.csv`: connexions entre nodes, tipus de relació i pes.
- `img/`: imatges originals o il·lustracions associades als nodes.

Els identificadors de `source` i `target` han de coincidir amb el camp `id` de `comics.csv`. El pes de cada relació ha de ser un valor entre 0 i 1.

Els CSV es carreguen quan no hi ha un arxiu desat al navegador. Per tant, modificar-los no substitueix una còpia local ja desada. `relations.csv` és la font de les connexions; el camp antic `relations` dels nodes no s’utilitza. Els camps opcionals `author`, `exhibition` i `location` també s’admeten al CSV.

## Estructura

```text
index.html
css/style.css
js/main.js
js/repository.js
data/comics.csv
data/relations.csv
img/
tests/browser.mjs
```

No cal cap procés de compilació. D3.js v7 es carrega des de jsDelivr.

## Verificació

Comprovació de sintaxi:

```bash
node --check js/main.js
node --check js/repository.js
```

Les proves d’integració necessiten Node.js 22 o posterior i Chromium/Chrome amb depuració remota. Amb el servidor local en funcionament, inicia un navegador de proves (ajusta el nom de l’executable al teu sistema):

```bash
chromium --headless --remote-debugging-port=9222 --user-data-dir=/tmp/cartografia-browser-tests about:blank
node tests/browser.mjs
```

Les proves creen i eliminen un context aïllat: no modifiquen l’arxiu de l’usuari. Comproven miniatures, filtres, zoom, arrossegament, galeria, cronologia, teclat, edició, càrrega d’imatges, persistència, importació i disposició mòbil. `TEST_BASE_URL` i `TEST_BROWSER_URL` permeten canviar els ports; `TEST_SCREENSHOTS` indica una carpeta opcional per a les captures.
