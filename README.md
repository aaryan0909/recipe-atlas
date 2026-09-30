# Recipe Atlas

**How food moved through the world.**

An interactive atlas of ingredient journeys: pick an ingredient, press play, and watch it travel across a world map over centuries, with the dishes it made possible at every stop. Below the map sits a searchable explorer over a real recipe catalog.

Phase 1 journeys: **Chili Pepper, Tomato, Potato, Coffee, Sugar**.

## Why it exists

Recipes do not stay put. The chili in a Sichuan stir-fry is American, the tomato in an Italian sauce spent centuries feared as poison, and the sugar in a British pudding redrew the map of the Atlantic. This project treats food as data with a history: a small ETL pipeline, a curated historical dataset, and a map that animates both.

## Stack

- **Frontend:** React + Vite, `d3-geo` (Natural Earth projection), `topojson-client` + `world-atlas` (open Natural Earth data, no map API keys, no Mapbox).
- **Data pipeline:** Python ETL (`etl/fetch_themealdb.py`) that snapshots the public TheMealDB catalog into static JSON, so the app ships with zero runtime API dependency.
- **Historical dataset:** `public/data/journeys.json`, hand-curated stops with dates and sources discipline (approximate dates are marked `c.`; the dataset carries its own notes field).

## Run it

```bash
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
```

Refresh the recipe snapshot (writes chunked recipe files under `public/data/meals/` and `public/data/meta.json`):

```bash
python3 etl/fetch_themealdb.py
```

## How it works

- The timeline scrubber drives everything: as the year advances, route segments draw themselves between stops (great-circle style paths via `d3-geo`), markers light up, and the stop card updates.
- Each stop carries dish-matching keywords. The explorer and the stop cards share one catalog, matched live against recipe names and ingredients, with an optional cuisine bias per stop.
- Clicking a country on the map filters the explorer to that cuisine when the snapshot has one.
- Journeys are editorial: TheMealDB provides recipes, never historical claims. History lives in `journeys.json` only.

## Data notes

- Recipe snapshot: TheMealDB public API, pulled 2026-09-30 (472 meals, 29 cuisines, 738 distinct ingredients). Coverage reflects the free catalog; some cuisines (for example Indian) are absent from the free snapshot, and the UI says so rather than faking matches.
- Map data: Natural Earth via the `world-atlas` package.

## Roadmap

- Phase 2: street food layer, the living endpoint of every journey (city-level stalls and dishes).
- More journeys (wheat, corn, tea, chocolate, spices), plus flavor-pairing and essays attached to journeys instead of standing alone.
