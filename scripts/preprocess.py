"""
Turns the raw parquet telemetry into small JSON files the browser can load.

Run from the repo root:
    python scripts/preprocess.py path/to/player_data

Output (in public/data/):
    index.json            -> one summary row per match (used by the filters)
    matches/<id>.json     -> full journeys for one match (loaded on demand)
"""
import json, os, re, sys
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

# From the README: scale, origin_x, origin_z per map. Minimaps are 1024x1024.
MAPS = {
    "AmbroseValley": (900, -370, -473),
    "GrandRift":     (581, -290, -290),
    "Lockdown":      (1000, -500, -500),
}
IMG = 1024
BOT_ID = re.compile(r"^\d+$")          # bots have short numeric user_ids
COMBAT_AND_ITEM = {"Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm", "Loot"}

# Heatmap settings: the 1024px minimap is cut into 128 x 128 cells of 8px each
CELL, GRID = 8, 128
HEAT_LAYERS = {
    "traffic": {"Position", "BotPosition"},
    "kills":   {"Kill", "BotKill"},
    "deaths":  {"Killed", "BotKilled", "KilledByStorm"},
    "loot":    {"Loot"},
}


def build_heatmaps(df, day_of_match, out):
    """Count events per grid cell: heat[map][day][layer][human|bot] = [[cx, cy, n], ...]"""
    df = df.assign(mday=df["match_id"].map(day_of_match))
    heat = {}
    for map_id, mdf in df.groupby("map_id"):
        px, py = world_to_pixel(map_id, mdf["x"].to_numpy("float64"), mdf["z"].to_numpy("float64"))
        mdf = mdf.assign(
            cx=np.clip((px // CELL).astype(int), 0, GRID - 1),
            cy=np.clip((py // CELL).astype(int), 0, GRID - 1),
            who=np.where(mdf["is_bot"], "bot", "human"),
        )
        for day, ddf in mdf.groupby("mday"):
            for layer, events in HEAT_LAYERS.items():
                sub = ddf[ddf["event"].isin(events)]
                for who, w in sub.groupby("who"):
                    cells = w.groupby(["cx", "cy"]).size().reset_index(name="n")
                    heat.setdefault(map_id, {}).setdefault(day, {}).setdefault(layer, {})[who] = cells.values.tolist()
    with open(os.path.join(out, "heatmaps.json"), "w") as f:
        json.dump(heat, f, separators=(",", ":"))



def world_to_pixel(map_id, x, z):
    """World (x, z) -> minimap pixel. Uses x and z only; y is elevation."""
    scale, ox, oz = MAPS[map_id]
    u = (x - ox) / scale
    v = (z - oz) / scale
    return u * IMG, (1 - v) * IMG        # image Y axis points down, world Z up


def load_all(root):
    frames = []
    for day in sorted(os.listdir(root)):
        folder = os.path.join(root, day)
        if not day.startswith("February") or not os.path.isdir(folder):
            continue
        for name in os.listdir(folder):
            df = pq.read_table(os.path.join(folder, name)).to_pandas()
            df["day"] = day
            frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    # TRAP 1: 'event' is stored as bytes
    df["event"] = df["event"].apply(lambda b: b.decode("utf-8") if isinstance(b, bytes) else b)
    # TRAP 2: 'ts' is labelled milliseconds but the numbers are really SECONDS
    df["sec"] = df["ts"].astype("int64")
    # TRAP 3: some bot files contain 'Position' events, so detect bots by user_id, not event name
    df["is_bot"] = df["user_id"].str.fullmatch(BOT_ID)
    # TRAP 4: exact duplicate rows exist
    df = df.drop_duplicates(["user_id", "match_id", "sec", "event", "x", "z"])
    return df


def build(root, out):
    df = load_all(root)
    os.makedirs(os.path.join(out, "matches"), exist_ok=True)
    index = []
    day_of_match = {}
    for match_id, m in df.groupby("match_id"):
        map_id = m["map_id"].iloc[0]
        t0 = int(m["sec"].min())                      # time zero = first event in the match
        players = []
        for user_id, p in m.groupby("user_id"):
            p = p.sort_values("sec")
            px, py = world_to_pixel(map_id, p["x"].to_numpy(dtype="float64"), p["z"].to_numpy(dtype="float64"))
            p = p.assign(px=px.round(1).astype(float), py=py.round(1).astype(float), t=p["sec"] - t0)
            moves = p[p["event"].isin(["Position", "BotPosition"])]
            events = p[p["event"].isin(COMBAT_AND_ITEM)]
            players.append({
                "id": user_id,
                "bot": bool(p["is_bot"].iloc[0]),
                "path": moves[["t", "px", "py"]].values.tolist(),
                "events": [[int(r.t), r.px, r.py, r.event] for r in events.itertuples()],
            })
        duration = int(m["sec"].max() - t0)
        # a match can span two folders (midnight); use the earliest folder
        day = sorted(m["day"].unique())[0].replace("February_", "Feb ")
        day_of_match[match_id] = day
        with open(os.path.join(out, "matches", f"{match_id}.json"), "w") as f:
            json.dump({"id": match_id, "map": map_id, "duration": duration,
                       "players": players}, f, separators=(",", ":"))
        index.append({
            "id": match_id, "map": map_id, "day": day, "duration": duration,
            "humans": sum(not p["bot"] for p in players),
            "bots": sum(p["bot"] for p in players),
            "events": int(m["event"].isin(COMBAT_AND_ITEM).sum()),
            # per-event-type counts, used by the match filters in the UI
            "counts": {k: int(v) for k, v in m["event"].value_counts().items()
                       if k in COMBAT_AND_ITEM},
        })
    index.sort(key=lambda r: (r["day"], r["map"], r["id"]))
    with open(os.path.join(out, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    build_heatmaps(df, day_of_match, out)
    print(f"{len(index)} matches + heatmaps written to {out}")


if __name__ == "__main__":
    build(sys.argv[1], os.path.join("public", "data"))
