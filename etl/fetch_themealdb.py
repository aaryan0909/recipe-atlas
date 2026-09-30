#!/usr/bin/env python3
"""Recipe Atlas data pipeline.

Pulls the full public recipe catalog from TheMealDB (free public API),
normalizes it, and writes static JSON the site ships with:

  public/data/meals/index.json + meals-NN.json - recipe chunks (25 meals each,
      small files so they move through git/CI/deploy tooling without friction)
  public/data/meta.json   - snapshot provenance + counts

Run:  python3 etl/fetch_themealdb.py
"""
import json
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

BASE = "https://www.themealdb.com/api/json/v1/1"
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data"


def get(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "recipe-atlas-etl/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    areas = [a["strArea"] for a in get("list.php?a=list")["meals"]]
    print(f"areas: {len(areas)}")

    stubs = {}
    for area in areas:
        for m in get(f"filter.php?a={urllib.parse.quote(area)}")["meals"] or []:
            stubs[m["idMeal"]] = m
        time.sleep(0.05)
    print(f"meal stubs: {len(stubs)}")

    meals = []
    for i, mid in enumerate(sorted(stubs)):
        raw = (get(f"lookup.php?i={mid}")["meals"] or [None])[0]
        if not raw:
            continue
        ingredients = []
        for n in range(1, 21):
            name = (raw.get(f"strIngredient{n}") or "").strip()
            if name:
                ingredients.append(
                    {"name": name, "measure": (raw.get(f"strMeasure{n}") or "").strip()}
                )
        meals.append(
            {
                "id": raw["idMeal"],
                "name": raw["strMeal"],
                "area": raw.get("strArea") or stubs[mid].get("strArea") or "",
                "category": raw.get("strCategory") or "",
                "tags": [t.strip() for t in (raw.get("strTags") or "").split(",") if t.strip()],
                "thumb": raw.get("strMealThumb") or "",
                "youtube": raw.get("strYoutube") or "",
                "source": raw.get("strSource") or "",
                "ingredients": ingredients,
                "instructions": (raw.get("strInstructions") or "").strip(),
            }
        )
        if (i + 1) % 50 == 0:
            print(f"  fetched {i + 1}/{len(stubs)}")
        time.sleep(0.03)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meals_dir = OUT_DIR / "meals"
    meals_dir.mkdir(exist_ok=True)
    for old in meals_dir.glob("meals-*.json"):
        old.unlink()
    chunk_size = 25
    chunk_names = []
    for i in range(0, len(meals), chunk_size):
        name = f"meals-{i // chunk_size:02d}.json"
        (meals_dir / name).write_text(
            json.dumps(meals[i : i + chunk_size], ensure_ascii=False, separators=(",", ":"))
        )
        chunk_names.append(name)
    (meals_dir / "index.json").write_text(
        json.dumps({"count": len(meals), "chunkSize": chunk_size, "chunks": chunk_names}, indent=2)
    )
    meta = {
        "source": "TheMealDB public API (themealdb.com)",
        "snapshotDate": date.today().isoformat(),
        "mealCount": len(meals),
        "areas": sorted({m["area"] for m in meals if m["area"]}),
        "categories": sorted({m["category"] for m in meals if m["category"]}),
        "ingredientCount": len({i["name"].lower() for m in meals for i in m["ingredients"]}),
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    import urllib.parse

    sys.exit(main())
