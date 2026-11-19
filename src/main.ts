// ---- Types: the shape of the JSON that preprocess.py wrote (like C# classes) ----
interface MatchSummary {
  id: string; map: string; day: string; duration: number;
  humans: number; bots: number; events: number;
  counts: Record<string, number>;
}
interface Player {
  id: string; bot: boolean;
  path: [number, number, number][];            // [t, px, py]
  events: [number, number, number, string][];  // [t, px, py, eventName]
}
interface Match { id: string; map: string; duration: number; players: Player[]; }

// ---- Minimap image per map (files live in /public/minimaps) ----
const MAP_IMAGES: Record<string, string> = {
  AmbroseValley: "/minimaps/AmbroseValley_Minimap.png",
  GrandRift: "/minimaps/GrandRift_Minimap.png",
  Lockdown: "/minimaps/Lockdown_Minimap.jpg",
};

// ---- Event style table: one row per event type (like a ScriptableObject) ----
type Shape = "diamond" | "cross" | "triangle" | "dot";
interface EventStyle { label: string; shape: Shape; color: string; glyph: string; size: number; }
const EVENT_STYLES: Record<string, EventStyle> = {
  Kill:          { label: "Killed a human",   shape: "diamond",  color: "#ff3b3b", glyph: "◆", size: 9 },
  Killed:        { label: "Died to a human",  shape: "cross",    color: "#ff3b3b", glyph: "✖", size: 9 },
  BotKill:       { label: "Killed a bot",     shape: "diamond",  color: "#ff9f43", glyph: "◆", size: 6 },
  BotKilled:     { label: "Died to a bot",    shape: "cross",    color: "#ff9f43", glyph: "✖", size: 8 },
  KilledByStorm: { label: "Died to storm",    shape: "triangle", color: "#b46bff", glyph: "▲", size: 10 },
  Loot:          { label: "Loot pickup",      shape: "dot",      color: "#ffe14d", glyph: "●", size: 3.5 },
};

// ---- HTML elements ----
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const mapSelect = document.getElementById("mapSelect") as HTMLSelectElement;
const matchSelect = document.getElementById("matchSelect") as HTMLSelectElement;
const info = document.getElementById("info") as HTMLParagraphElement;
const dateSelect = document.getElementById("dateSelect") as HTMLSelectElement;
const filterSelect = document.getElementById("filterSelect") as HTMLSelectElement;
const sortSelect = document.getElementById("sortSelect") as HTMLSelectElement;
const matchCount = document.getElementById("matchCount") as HTMLDivElement;
const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const scrub = document.getElementById("scrub") as HTMLInputElement;
const timeLabel = document.getElementById("timeLabel") as HTMLSpanElement;
const speedSelect = document.getElementById("speedSelect") as HTMLSelectElement;
const heatLayer = document.getElementById("heatLayer") as HTMLSelectElement;
const heatScope = document.getElementById("heatScope") as HTMLSelectElement;
const heatWho = document.getElementById("heatWho") as HTMLSelectElement;
const heatOpacity = document.getElementById("heatOpacity") as HTMLInputElement;
const heatBar = document.getElementById("heatBar") as HTMLDivElement;
const heatInfo = document.getElementById("heatInfo") as HTMLDivElement;
const showHumans = document.getElementById("showHumans") as HTMLInputElement;
const showBots = document.getElementById("showBots") as HTMLInputElement;
const eventToggles = document.getElementById("eventToggles") as HTMLDivElement;

// ---- App state ----
let allMatches: MatchSummary[] = [];
let currentMatch: Match | null = null;
let currentSummary: MatchSummary | null = null;
const imageCache: Record<string, HTMLImageElement> = {};
const enabledEvents = new Set<string>(Object.keys(EVENT_STYLES));
// playback state: currentTime is in seconds since match start
let currentTime = 0;
let playing = false;
let lastFrame = 0;
let loadToken = 0;   // guards against out-of-order loads when switching matches quickly

function loadImage(src: string): Promise<HTMLImageElement> {
  if (imageCache[src]) return Promise.resolve(imageCache[src]);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { imageCache[src] = img; resolve(img); };
    img.src = src;
  });
}

// ---- Marker drawing ----
function drawMarker(style: EventStyle, x: number, y: number) {
  const s = style.size;
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  switch (style.shape) {
    case "diamond":
      ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#000"; ctx.stroke();
      break;
    case "triangle":
      ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.8); ctx.lineTo(x - s, y + s * 0.8);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#000"; ctx.stroke();
      break;
    case "cross":
      // black outline first so the X stays readable on any terrain
      ctx.strokeStyle = "#000"; ctx.lineWidth = 5.5;
      ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle = style.color; ctx.lineWidth = 3;
      ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
      break;
    case "dot":
      ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "#000"; ctx.stroke();
      break;
  }
}

// ---- Heatmaps ----
// heatmaps.json holds pre-counted grid cells: map -> day -> layer -> human|bot -> [[cx, cy, count]]
type HeatCell = [number, number, number];
type HeatData = Record<string, Record<string, Record<string, Record<string, HeatCell[]>>>>;
const CELL = 8, GRID = 128;                       // must match preprocess.py
const HEAT_EVENTS: Record<string, string[]> = {
  kills: ["Kill", "BotKill"],
  deaths: ["Killed", "BotKilled", "KilledByStorm"],
  loot: ["Loot"],
};
let heatData: HeatData = {};
let heatCanvas: HTMLCanvasElement | null = null;  // cached coloured overlay, rebuilt only when settings change

// 256-step colour ramp (blue -> cyan -> green -> yellow -> red), read from a gradient
const palette = (() => {
  const c = document.createElement("canvas"); c.width = 256; c.height = 1;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  [[0, "#2b3cff"], [0.25, "#00d4ff"], [0.5, "#3bff6b"], [0.75, "#ffe800"], [1, "#ff2a00"]]
    .forEach(([s, col]) => grad.addColorStop(s as number, col as string));
  g.fillStyle = grad; g.fillRect(0, 0, 256, 1);
  return g.getImageData(0, 0, 256, 1).data;
})();

function wantedWho(): string[] {
  return heatWho.value === "both" ? ["human", "bot"] : [heatWho.value];
}

// Build the 128x128 count grid for the current settings
function buildGrid(): { grid: Float32Array; total: number; note: string } {
  const grid = new Float32Array(GRID * GRID);
  let total = 0, note = "";
  const layer = heatLayer.value;
  if (heatScope.value === "match") {
    if (currentMatch) {
      for (const p of currentMatch.players) {
        if (!wantedWho().includes(p.bot ? "bot" : "human")) continue;
        const pts: [number, number][] = layer === "traffic"
          ? p.path.map((q) => [q[1], q[2]] as [number, number])
          : p.events.filter((e) => HEAT_EVENTS[layer].includes(e[3])).map((e) => [e[1], e[2]] as [number, number]);
        for (const [x, y] of pts) {
          const cx = Math.min(GRID - 1, Math.max(0, Math.floor(x / CELL)));
          const cy = Math.min(GRID - 1, Math.max(0, Math.floor(y / CELL)));
          grid[cy * GRID + cx]++; total++;
        }
      }
    }
    note = "1 match";
  } else {
    const byDay = heatData[mapSelect.value] ?? {};
    for (const [day, layers] of Object.entries(byDay)) {
      if (dateSelect.value !== "all" && day !== dateSelect.value) continue;
      for (const who of wantedWho()) {
        for (const [cx, cy, n] of layers[layer]?.[who] ?? []) { grid[cy * GRID + cx] += n; total += n; }
      }
    }
    const nMatches = allMatches.filter((x) => x.map === mapSelect.value &&
      (dateSelect.value === "all" || x.day === dateSelect.value)).length;
    note = `${nMatches} matches`;
  }
  return { grid, total, note };
}

// Gaussian-blur the count grid so isolated cells blend into smooth "heat"
function blurGrid(src: Float32Array, sigma = 1.6): Float32Array {
  const r = Math.ceil(sigma * 2.5);
  const k: number[] = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((s, v) => s + v, 0);
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {      // horizontal pass
    let s = 0;
    for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < GRID) s += src[y * GRID + xx] * k[i + r]; }
    tmp[y * GRID + x] = s / sum;
  }
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {      // vertical pass
    let s = 0;
    for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < GRID) s += tmp[yy * GRID + x] * k[i + r]; }
    out[y * GRID + x] = s / sum;
  }
  return out;
}

// Turn the grid into a smooth coloured overlay (cached in heatCanvas)
function rebuildHeat() {
  heatCanvas = null;
  const layer = heatLayer.value;
  heatBar.style.display = layer === "off" ? "none" : "block";
  if (layer === "off") { heatInfo.textContent = ""; return; }
  const { grid, total, note } = buildGrid();
  heatInfo.textContent = total === 0 ? "No data for these settings."
    : `${total.toLocaleString()} points from ${note}. Red = top 5% busiest areas.`;
  if (total === 0) return;

  // 1) smooth, then find the 95th-percentile density so a few outliers cannot wash everything out
  const smooth = blurGrid(grid);
  const nz = Array.from(smooth).filter((v) => v > 1e-6).sort((p, q) => p - q);
  const ref = nz[Math.floor(nz.length * 0.95)] || nz[nz.length - 1];

  // 2) colour each of the 128x128 cells: density -> ramp colour + transparency
  const small = document.createElement("canvas"); small.width = small.height = GRID;
  const sctx = small.getContext("2d")!;
  const img = sctx.createImageData(GRID, GRID);
  for (let i = 0; i < smooth.length; i++) {
    const t = Math.min(1, smooth[i] / ref) ** 0.8;
    const o = i * 4;
    if (t < 0.04) { img.data[o + 3] = 0; continue; }   // hide near-empty areas
    const k = Math.round(t * 255) * 4;
    img.data[o] = palette[k]; img.data[o + 1] = palette[k + 1]; img.data[o + 2] = palette[k + 2];
    img.data[o + 3] = Math.round(70 + 185 * t);        // faint at low density, solid at high
  }
  sctx.putImageData(img, 0, 0);

  // 3) scale up to 1024px with smoothing = soft edges between cells
  const big = document.createElement("canvas"); big.width = big.height = 1024;
  const bctx = big.getContext("2d")!;
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = "high";
  bctx.drawImage(small, 0, 0, 1024, 1024);
  heatCanvas = big;
}

// ---- The one function that paints everything ----
// Everything is drawn "as of currentTime", so the same code serves the static
// view (currentTime = end of match) and playback.
function render() {
  ctx.clearRect(0, 0, 1024, 1024);
  if (!currentMatch || !currentSummary) return;
  const img = imageCache[MAP_IMAGES[currentMatch.map]];
  if (img) ctx.drawImage(img, 0, 0, 1024, 1024);
  if (heatCanvas) {                                    // heatmap sits between map and paths
    ctx.globalAlpha = Number(heatOpacity.value);
    ctx.drawImage(heatCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }
  const visible = (p: Player) => (p.bot ? showBots.checked : showHumans.checked);

  // paths first (bottom layer): points up to currentTime, plus an interpolated head
  const heads: { x: number; y: number; bot: boolean }[] = [];
  for (const p of currentMatch.players) {
    if (!visible(p) || p.path.length === 0) continue;
    const pts = p.path;
    if (currentTime < pts[0][0]) continue;               // has not appeared yet
    let last = 0;
    while (last + 1 < pts.length && pts[last + 1][0] <= currentTime) last++;
    let hx = pts[last][1], hy = pts[last][2];
    if (last + 1 < pts.length) {                         // between two samples: lerp
      const [t0, x0, y0] = pts[last], [t1, x1, y1] = pts[last + 1];
      const f = (currentTime - t0) / (t1 - t0);
      hx = x0 + (x1 - x0) * f; hy = y0 + (y1 - y0) * f;
    }
    if (last > 0 || last + 1 < pts.length) {
      ctx.beginPath();
      ctx.moveTo(pts[0][1], pts[0][2]);
      for (let i = 1; i <= last; i++) ctx.lineTo(pts[i][1], pts[i][2]);
      ctx.lineTo(hx, hy);
      ctx.strokeStyle = p.bot ? "rgba(255,159,67,0.7)" : "rgba(56,225,255,0.95)";
      ctx.lineWidth = p.bot ? 2 : 3;
      ctx.stroke();
    }
    // show the head only while the player is still being tracked
    if (currentTime <= pts[pts.length - 1][0]) heads.push({ x: hx, y: hy, bot: p.bot });
  }
  // events on top. Loot first so rarer, important events are not hidden under it.
  const order = ["Loot", "BotKill", "BotKilled", "Kill", "Killed", "KilledByStorm"];
  for (const type of order) {
    if (!enabledEvents.has(type)) continue;
    for (const p of currentMatch.players) {
      if (!visible(p)) continue;
      for (const [t, x, y, name] of p.events) {
        if (name === type && t <= currentTime) drawMarker(EVENT_STYLES[type], x, y);
      }
    }
  }
  // current-position dots on the very top
  for (const h of heads) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.bot ? 5 : 7, 0, Math.PI * 2);
    ctx.fillStyle = h.bot ? "#ff9f43" : "#38e1ff";
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
  updateTimeUi();
}

// ---- Playback ----
function updateTimeUi() {
  const dur = currentMatch?.duration ?? 0;
  scrub.value = String(currentTime);
  timeLabel.textContent = `${fmtTime(Math.floor(currentTime))} / ${fmtTime(dur)}`;
  playBtn.innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
}
function tick(now: number) {
  if (!playing || !currentMatch) return;
  const dt = (now - lastFrame) / 1000;          // seconds since previous frame (like Time.deltaTime)
  lastFrame = now;
  currentTime = Math.min(currentMatch.duration, currentTime + dt * Number(speedSelect.value));
  if (currentTime >= currentMatch.duration) playing = false;
  render();
  if (playing) requestAnimationFrame(tick);
}
function togglePlay() {
  if (!currentMatch) return;
  if (playing) { playing = false; updateTimeUi(); return; }
  if (currentTime >= currentMatch.duration) currentTime = 0;   // replay from start
  playing = true;
  lastFrame = performance.now();
  requestAnimationFrame(tick);
}

// ---- Sidebar: event checkboxes with live counts ----
function buildEventToggles() {
  eventToggles.innerHTML = Object.entries(EVENT_STYLES).map(([key, s]) => `
    <label class="check">
      <input type="checkbox" data-event="${key}" checked />
      <span class="glyph" style="color:${s.color}">${s.glyph}</span> ${s.label}
      <span class="count" id="count-${key}">0</span>
    </label>`).join("");
  eventToggles.querySelectorAll<HTMLInputElement>("input").forEach((box) => {
    box.onchange = () => {
      if (box.checked) enabledEvents.add(box.dataset.event!);
      else enabledEvents.delete(box.dataset.event!);
      render();
    };
  });
}
function updateCounts() {
  const counts: Record<string, number> = {};
  currentMatch?.players.forEach((p) => p.events.forEach((e) => (counts[e[3]] = (counts[e[3]] ?? 0) + 1)));
  for (const key of Object.keys(EVENT_STYLES)) {
    document.getElementById(`count-${key}`)!.textContent = String(counts[key] ?? 0);
  }
}

// ---- Loading a match ----
async function selectMatch(summary: MatchSummary) {
  const token = ++loadToken;
  const [, match] = await Promise.all([
    loadImage(MAP_IMAGES[summary.map]),
    fetch(`/data/matches/${summary.id}.json`).then((r) => r.json() as Promise<Match>),
  ]);
  if (token !== loadToken) return;               // a newer selection superseded this one
  playing = false;
  currentSummary = summary;
  currentMatch = match;
  currentTime = match.duration;                  // start on the full journey; press play to replay
  scrub.max = String(match.duration);
  info.textContent =
    `${summary.humans} human, ${summary.bots} bots. ${summary.duration}s long. ${summary.day}`;
  updateCounts();
  rebuildHeat();
  render();
}

// ---- Filters ----
const n = (m: MatchSummary, k: string) => m.counts[k] ?? 0;
const FILTERS: Record<string, (m: MatchSummary) => boolean> = {
  any:    () => true,
  bots:   (m) => m.bots > 0,
  deaths: (m) => n(m, "Killed") + n(m, "BotKilled") + n(m, "KilledByStorm") > 0,
  pvp:    (m) => n(m, "Kill") + n(m, "Killed") > 0,
  storm:  (m) => n(m, "KilledByStorm") > 0,
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Rebuild the match list from the current filter settings
function fillMatches() {
  let list = allMatches.filter((m) =>
    m.map === mapSelect.value &&
    (dateSelect.value === "all" || m.day === dateSelect.value) &&
    FILTERS[filterSelect.value](m));
  if (sortSelect.value === "events") list = [...list].sort((a, b) => b.events - a.events);
  if (sortSelect.value === "duration") list = [...list].sort((a, b) => b.duration - a.duration);

  matchCount.textContent = `${list.length} match${list.length === 1 ? "" : "es"} found`;
  matchSelect.innerHTML = list
    .map((m) => `<option value="${m.id}">${m.day} - ${m.humans}H/${m.bots}B - ${fmtTime(m.duration)} - ${m.events} ev</option>`)
    .join("");
  if (list.length === 0) {
    playing = false; currentMatch = null; currentSummary = null;
    info.textContent = "No matches for these filters.";
    updateCounts(); rebuildHeat(); render();
    return;
  }
  showSelected();
}
function showSelected() {
  const m = allMatches.find((x) => x.id === matchSelect.value);
  if (m) selectMatch(m);
}
function step(delta: number) {
  const i = matchSelect.selectedIndex + delta;
  if (i < 0 || i >= matchSelect.options.length) return;
  matchSelect.selectedIndex = i;
  showSelected();
}

async function init() {
  [allMatches, heatData] = await Promise.all([
    fetch("/data/index.json").then((r) => r.json()),
    fetch("/data/heatmaps.json").then((r) => r.json()),
  ]);
  const maps = [...new Set(allMatches.map((m) => m.map))];
  const days = [...new Set(allMatches.map((m) => m.day))];
  mapSelect.innerHTML = maps.map((m) => `<option>${m}</option>`).join("");
  dateSelect.innerHTML = `<option value="all">All dates</option>` +
    days.map((d) => `<option>${d}</option>`).join("");
  mapSelect.onchange = dateSelect.onchange = filterSelect.onchange = sortSelect.onchange = fillMatches;
  matchSelect.onchange = showSelected;
  prevBtn.onclick = () => step(-1);
  nextBtn.onclick = () => step(1);
  // buttons give up focus after a click, so Space always means play/pause (not "press the focused button")
  document.addEventListener("click", (e) => {
    if (e.target instanceof HTMLButtonElement) e.target.blur();
  });
  playBtn.onclick = togglePlay;
  scrub.oninput = () => { playing = false; currentTime = Number(scrub.value); render(); };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); togglePlay(); }
  });
  heatLayer.onchange = heatScope.onchange = heatWho.onchange = () => { rebuildHeat(); render(); };
  heatOpacity.oninput = render;
  showHumans.onchange = render;
  showBots.onchange = render;
  buildEventToggles();
  fillMatches();
}
init();
