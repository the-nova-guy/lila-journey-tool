# LILA BLACK – Player Journey Visualization Tool

A browser tool that lets Level Designers see how players actually move through LILA BLACK maps: paths, fights, loot, storm deaths, and heatmaps of where the action (and the empty space) is.

**Live tool:** https://lila-journey-tool-zeta.vercel.app/

Also in this repo: [`ARCHITECTURE.md`](ARCHITECTURE.md) (how it works and why) and [`INSIGHTS.md`](INSIGHTS.md) (three things learned about the game using the tool).

## Tech stack

| Layer | Choice |
|---|---|
| Data prep | Python 3 (pandas, pyarrow, numpy) – one offline script |
| Frontend | Vite + TypeScript, plain HTML Canvas (no UI framework) |
| Hosting | Vercel (static site, auto-deploys from `main`) |
| Environment variables | None |

## Features

- **Journeys on the minimap** – world coordinates mapped to the correct minimap for all 3 maps.
- **Humans vs bots** – humans are thick cyan lines, bots thin orange; each has its own toggle.
- **Event markers** – distinct shapes/colours for: killed a human, died to a human, killed a bot, died to a bot, storm death, loot. Each type can be shown/hidden, with live counts for the selected match.
- **Filters** – date, map, and "only matches with…" (bot paths recorded, any player death, human-vs-human kills, storm deaths), plus sorting (date, most events, longest) and Prev/Next stepping.
- **Playback** – play/pause, scrubber, 1x/5x/10x/30x speed, Space bar toggles. Paths grow and markers appear at their timestamps; positions are interpolated between samples.
- **Heatmaps** – traffic, kill zones, death zones, loot pickups. Scope: one match, or all matches on a map for a chosen date. Filter by humans/bots. Opacity slider.

## Quick tour (for a first-time user)

1. Pick a **Map**, optionally a **Date**, and set **Only matches with → Bot paths recorded** to find matches where bots moved.
2. Choose a match in the **Match** list (or use Prev/Next). The full journey is shown first.
3. Press **▶** (or Space) to replay it from the start. Drag the scrubber to jump.
4. Under **Heatmap**, set **Layer** to *Traffic*, *Kill zones*, *Death zones* or *Loot pickups*. Switch **Scope** between all matches and only the selected match.
5. Use the **Events** checkboxes to declutter (loot is the busiest marker).

## Run locally

Requirements: Node.js 18+, and Python 3.10+ (only if you want to regenerate the data).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

The processed data is **already committed** in `public/data/`, so the app runs without Python.

### Regenerate the data (optional)

```bash
pip install pandas pyarrow numpy
python scripts/preprocess.py path/to/player_data
```

`path/to/player_data` is the unzipped folder that contains `February_10 … February_14` and `minimaps/`. The script rewrites `public/data/index.json`, `public/data/heatmaps.json` and `public/data/matches/*.json`. The three minimap images live in `public/minimaps/`.

## Deploying

Import the repo in Vercel. It detects Vite automatically (build command `npm run build`, output directory `dist`). No environment variables are needed.

## Repo layout

```
scripts/preprocess.py   parquet -> JSON (decoding, cleaning, coordinate mapping, heatmap grids)
public/data/            generated: index.json, heatmaps.json, matches/<id>.json
public/minimaps/        the three minimap images
src/main.ts             app logic: loading, filters, rendering, playback, heatmaps
src/style.css           layout and styling
index.html              page structure
```
