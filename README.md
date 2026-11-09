# Mapform core

Open core of [Mapform](https://mapform.app), a web platform for designing infrastructure in native IFC 4.3: terrain, roads, rail, underground utilities and power lines.

This package holds the parts that do not depend on the user interface:

- **Units** - metres, international feet and US survey feet, with exact conversion factors.
- **Coordinate systems** - a registry of 1,150+ projected systems generated from the EPSG database (Polish CS2000 and CS92, all US State Plane zones on NAD83 and NAD83(2011), ETRS89 and WGS 84 UTM, British National Grid) plus common vertical datums.
- **Project settings** - validation and the values that go into `IfcMapConversion`, so a model lands in the right place on the map.
- **Terrain** - survey point files (PNEZD, PENZD, NEZ, XYZ, with decimal commas), LandXML surfaces from Civil 3D and OpenRoads, Delaunay TIN with a maximum edge length, statistics, outline and height at a point. Height grids (ESRI ASCII grid, or any raster read elsewhere) become TINs with no-data cells left out.
- **Project file** - writes a new IFC 4.3 project in the browser: units (m, ft, US survey ft), contexts, IfcProjectedCRS, IfcMapConversion and a site with latitude and longitude. Matches the file IfcOpenShell makes and passes its EXPRESS rule checks.
- **Terrain in IFC** - writes TIN surfaces into an IFC 4.3 project file as IfcGeographicElement (TERRAIN) with IfcTriangulatedIrregularNetwork, in the browser; a million triangles take about a second.

## Install

```bash
npm install github:mapform-app/core
```

## Use

```ts
import { suggestPl2000Zone, toProjected, mapConversionFor } from '@mapform/core';

const epsg = suggestPl2000Zone(19.94);            // 2178, CS2000 zone 7
const [e, n] = toProjected(epsg, 19.9449, 50.0647); // Krakow in CS2000/21

const mc = mapConversionFor({
  name: 'Campus',
  code: 'KRK01',
  crsEpsg: epsg,
  lengthUnit: 'm',
  origin: { easting: e, northing: n, elevation: 210 },
  rotationDeg: 0,
});
```

## Develop

```bash
npm install
npm test
npm run typecheck
```

The coordinate system registry in `src/crs-registry.generated.ts` is generated from the EPSG database shipped with PROJ. To refresh it:

```bash
pip install pyproj
npm run generate:crs
```

## License

AGPL-3.0. See [LICENSE](LICENSE).
