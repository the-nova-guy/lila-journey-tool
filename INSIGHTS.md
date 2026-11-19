# Insights

Based on 796 matches over 5 days (566 AmbroseValley, 171 Lockdown, 59 GrandRift). Heatmaps use 32px cells on the 1024px minimap; each finding can be reproduced in the tool with the steps shown.

## 1. Loot decides where players go, and about a third of every map is dead space

**What caught my eye.** On the Traffic heatmap, large parts of each map stay dark. Switching to the Loot layer shows the same areas are dark there too.

**Evidence.**
- On all three maps, 30–34% of visited map cells get less than 5% of the busiest cell's traffic (AmbroseValley 33%, Lockdown 34%, GrandRift 30%).
- Those cells hold only about 5% of all traffic and about 1% of all loot. On AmbroseValley, 120 of the 148 such cells have no loot at all.
- The hottest 10% of cells hold 55–66% of the loot.
- Loot and traffic move together (rank correlation 0.79 on AmbroseValley, 0.74 on Lockdown).

**Actionable.** Players go where the loot is, so loot placement is steering routes more than the map layout. Add loot or objectives to the dead areas, or cut or repurpose them. Metrics affected: map utilization (share of the map visited), traffic spread, time spent per area, and loot pickups per match.

**Why a level designer cares.** A third of the authored space is barely used. Moving a few loot spawns is a cheap test of whether those areas can come alive.

*How to see it:* AmbroseValley, All dates, Heatmap → Traffic, then Loot pickups.
*Caveat:* correlation, not proof; buildings attract both loot and players.

## 2. Deaths concentrate in a handful of spots on AmbroseValley

**What caught my eye.** The Death zones heatmap (humans only) has bright spots that are weaker on the Traffic heatmap, so some places are more lethal than their traffic explains.

**Evidence.**
- Overall, humans die 8.9 times per 1,000 position samples on AmbroseValley.
- Of the 103 well-travelled cells (100+ samples), 26 run at more than twice that rate; the worst five run at 37–49 per 1,000, roughly 4–5x the average.
- The busiest 10% of cells account for 51% of deaths.
- About 90% of human deaths in the data come from bots (see the bonus observation), so these are mostly player-vs-bot hot spots.

**Actionable.** Open the highest-rate cells in the playback and check why they are lethal (open sightlines, bot approach routes, no cover, loot that lures players into the open). Tune cover or bot pacing there. Metrics affected: death rate per area, survival time, and early churn.

**Why a level designer cares.** These are the exact places to look at first when the map feels unfair, and the tool shows them directly.

*How to see it:* AmbroseValley, Heatmap → Death zones → Humans only, then compare with Traffic.
*Caveat:* the worst cells have only 4–10 deaths each, so treat them as leads to inspect, not proof.

## 3. The storm only matters at the very end of a match

**What caught my eye.** Filtering to matches with storm deaths, every purple marker appears very late in the timeline.

**Evidence.**
- All 39 storm deaths happened between 655 and 887 seconds (about 10:55 to 14:47), median about 12:19.
- Only 17.5% of human journeys (137 of 781) last past 650 seconds, so 82.5% of players never meet the storm.
- Among those who last that long, roughly 28% die to it. Overall the storm causes 8.8% of human deaths.
- Storm deaths are spread out: no 8px cell has more than one, so there is no single trap spot.
- Lockdown has about 3x as many storm deaths per match as AmbroseValley (0.10 vs 0.03), partly because Lockdown matches run longer (median 448s vs 362s).

**Actionable.** If the storm is meant to push players across the map, it starts too late to shape routes for most players. Test an earlier or faster storm timeline. Metrics affected: storm death share, match length, share of journeys reaching the storm phase, and extraction rate.

**Why a level designer cares.** The storm is a level-design tool for forcing movement and encounters. If it arrives after most players are already done, the map's late-game flow is rarely experienced.

*How to see it:* Only matches with → Storm deaths, Sort → Longest, drag the scrubber to the end.
*Caveat:* there is no extraction event in the data, so "survived" journeys may include players who left the match.

## Bonus observation: the data looks almost entirely player-vs-bot

779 of 796 matches contain exactly one human, and there are only 3 human-vs-human kills in 5 days versus 2,376 bot kills. About 90% of human deaths come from bots (400 of 442), 8.8% from the storm, 0.7% from other humans. Any "choke point" or "fight zone" conclusion from this data is really about bot fights. If the dataset is a sample (one player per match), that would explain it, so I treat this as a data caveat rather than a claim about the live game.

## What I ruled out

My first reading was that GrandRift is mostly ignored: 74% of its visited cells had two or fewer position samples. That was a sample-size artefact, since GrandRift has only 59 matches. With the same number of matches sampled on every map, all three look similarly sparse (63–76%), so I dropped it.
