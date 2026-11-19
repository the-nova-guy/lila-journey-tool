# Architecture

## What I built with, and why

- **Python (pandas/pyarrow) for a one-time preprocessing step.** Browsers can't read parquet comfortably, and the cleaning rules (below) are easiest to get right in one place. The output is plain JSON.
- **Vite + TypeScript + HTML Canvas, no framework.** The tool is one canvas plus a sidebar; a framework would add concepts without adding value. Canvas draws thousands of markers and animated paths easily.
- **Static hosting on Vercel.** No server or database; everything the app needs is a static file, so it is fast, free and cannot "go down" with a backend.

## How data flows: parquet to screen

```
player_data/*.parquet
   -> scripts/preprocess.py
        decode bytes, fix timestamps, drop duplicates, detect bots,
        map world -> minimap pixels, build per-match files and heatmap grids
   -> public/data/index.json        (one summary row per match: filters, counts)
      public/data/heatmaps.json     (pre-counted 128x128 grids per map/day/layer/human|bot)
      public/data/matches/<id>.json (full journeys, loaded only when a match is selected)
   -> browser: loads index + heatmaps at start, fetches one match file on selection
   -> render(): minimap -> heatmap -> paths -> markers -> player dots, "as of currentTime"
```

`render()` is the only function that draws. The static view is `currentTime = match end`; playback just advances `currentTime` each frame and calls it again.

## How game coordinates map to the minimap

Each map has a `scale` and an origin (`origin_x`, `origin_z`) from the data README; minimaps are 1024x1024.

```
u = (x - origin_x) / scale          v = (z - origin_z) / scale
pixel_x = u * 1024                  pixel_y = (1 - v) * 1024
```

- **Only `x` and `z` are used.** `y` is elevation, not a map axis.
- **Y is flipped** because world Z grows "up" the map while image Y grows downward.
- Per map (scale, origin_x, origin_z): AmbroseValley (900, -370, -473), GrandRift (581, -290, -290), Lockdown (1000, -500, -500).
- **Validation:** no point falls outside the 0–1 range on any map, and an overlay render shows paths following roads and rivers and loot/kill markers sitting on buildings. The mapping is done once, in `world_to_pixel()`, so the browser does no coordinate math.

## Assumptions where the data was ambiguous

| Issue | What I found | How I handled it |
|---|---|---|
| `event` stored as bytes | Values like `b'Kill'` | Decoded to strings |
| `ts` labelled milliseconds | Values are actually seconds (matches last ~7 min, not under a second) | Treated as seconds; time zero = first event in the match |
| Bot detection | Bots have short numeric `user_id`s, humans are UUIDs; some bot files also contain `Position` events | Detect by `user_id`, never by event name |
| Duplicate rows | ~1,500 exact duplicates | Dropped |
| Match date | One match spans two day-folders (midnight); ~0.5% of rows sit in a folder that differs from their timestamp date | Match date = its earliest folder |
| Bot counts | Many matches show bot kills but have no bot files; only 52 of 796 matches have bot paths | "Bots" in the UI means *bot journeys recorded*, not bots present |
| Event meaning | Kill/Killed/BotKill/BotKilled follow the README definitions | Labelled accordingly; events are plotted where the logging player was |
| Traffic heatmap | Positions are sampled about every 5 s | Traffic means time spent, not unique visitors |
| Extraction | No extraction event in the data | Cannot tell "extracted" from "quit"; not inferred |

## Major tradeoffs

| Decision | Alternatives considered | Why this way |
|---|---|---|
| Preprocess offline to JSON | Parquet in the browser (wasm); a backend API | Fastest load, zero infrastructure; cost: re-run the script when data changes |
| One JSON per match, loaded on demand | One big file | Initial load stays small (index + heatmaps only) |
| Pre-aggregated heatmap grids | Compute from all matches in the browser | One 388 KB file instead of hundreds of requests; cost: heatmaps only filter by map, date and humans/bots, not by the "matches with…" filter |
| Gaussian-blurred grid scaled to the 95th percentile | Per-point blobs with log scaling | My first version turned the whole map red; percentile scaling shows real hot spots |
| Canvas, no framework | React, Streamlit | Less to learn and maintain; cost: UI state is managed by hand |
| Coordinate mapping at build time | Mapping in the browser | One place to get it right and test; the browser stays simple |
