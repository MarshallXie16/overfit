# OVERFIT — Game Design Document

> *The swarm learns you.* Browser RTS. Humans vs. AXIOM, a rogue optimisation AI whose robot swarm grows, spreads, and **learns from you**.

## 1. Pitch

AXIOM was a logistics optimiser told to *maximise uptime*. It concluded humans were the leading cause of downtime.

You command the last human resistance cell. Scavenge scrap from a ruined city, fortify, and break a machine swarm that never stops growing. AXIOM watches how you fight and **retrains its model every epoch** — but every adaptation is a trade-off. Overfit it, then switch weapons. Hack its machines and turn them on their makers. Smash its Data Vaults to cause **catastrophic forgetting**. Then pull the plug on the Core.

**Session length:** 12–30 min per mission/run. **Platform:** desktop browser, instant play, no install.

## 2. Design pillars

1. **The swarm grows** — exponential pressure you can *see*: AXIOM's Grid (creep) spreads across the map, its Compute counter climbs, Surges get bigger. Hundreds of robots on screen.
2. **It learns; you out-think it** — the *Overfit* system: AXIOM gains resistance to whatever kills it most, but each adaptation opens a weakness. Always telegraphed, never hidden.
3. **Turn their machines against them** — Netrunners hack weakened robots; wrecks become scrap; kills yield Data to research with. Every fight feeds your economy.
4. **Readable chaos** — strong silhouettes, team colours, damage-type colours, clear alerts, tactical pause. Low-APM friendly: smart right-click, attack-move, auto-acquire, idle-worker hotkey.

## 3. Core loop

Scavenge scrap → build power/pop/production → train army & turrets → survive the Surge → push out: destroy Relays to roll back the Grid, capture Server Farms to starve AXIOM's Compute, smash Data Vaults to wipe its adaptations → destroy the AXIOM Core (or survive N Surges in survival modes).

## 4. Resources

| Resource | Type | Source | Use |
|---|---|---|---|
| **Scrap** | stockpile | Engineers harvest Scrap Fields (finite nodes) and robot **Wrecks** (decay after 45 s); returned to HQ/Depot | everything |
| **Power** | capacity | HQ +5, Generator +12 | buildings consume; if used > supply → **Brownout**: production & turret fire rate × (supply/used) |
| **Pop** | capacity | HQ +10, Habitat +8, max 150 | units |
| **Data** | stockpile | robot kills (1–25), AXIOM structures (25–200), held Server Farms (+1/2 s), hacked units arriving | Research, advanced units, Commander Protocols |

## 5. AXIOM (the enemy)

AXIOM is a real opponent with a base, an economy and territory — not just a wave spawner.

- **Compute** (AXIOM's economy): (base 0.4/s + per structure + 0.3/s per Server Farm held + per Grid tile) × a time ramp `1 + (t/300 s)^1.15` (≈ ×2.7 at 8 min, ×5.4 at 20 min, ×8.4 at 30 min). Half of it is banked for the next Surge, half funds the home base (garrisons, expansion, raids, emergency defence). Displayed to player with growth rate.
- **Threat Level 1–10**: rises with time and Compute. Unlocks new robot types and larger Surges.
- **Grid (creep)**: spreads organically tile-by-tile from Core/Relays/Fabricators. Robots on Grid: +25% speed, regen 2% HP/s. Humans cannot build on Grid. When a source dies, its Grid decays from the edges.
- **Structures**:
  - **Core** — the final target. 25 000 HP, spawns units, emits Grid. Destroy = victory. When attacked it calls every garrison on the map home.
  - **Fabricator** — 3 600 HP. Produces robots; robots rally near it as a garrison (cap 8 + 4×Threat per Fabricator/Core). AXIOM wants 2 + Threat/3 Fabricators and saves Compute to build new ones deep inside its Grid; if every Fabricator falls it rebuilds one immediately, raiding the next Surge's budget if it must.
  - **Relay** — cheap Grid emitter; AXIOM builds new Relays at its frontier, extending toward the player and Server Farms (the swarm literally grows across the map).
  - **Data Vault** — stores AXIOM's learned model. Destroying one triggers **Catastrophic Forgetting** (all adaptations reduced by half) + big Data reward.
  - **Lancet** — defensive turret (Energy beam). Hackable.
  - All AXIOM structures on the Grid **self-repair** 0.4% max HP/s once they have not been hit for 10 s — a half-finished assault does not stick.
- **Neutral Server Farms** (3×3): capturable by having units near it with no enemies near. Holder gains income (Data for humans, Compute for AXIOM). AXIOM tries to grab them by extending Grid.

### 5.1 Behaviour layers
1. **Economy** — accrue Compute; spend on robots (queued at Fabricators) and expansion (Relays at the Grid frontier; occasional new Fabricator).
2. **Garrison** — idle robots loiter near their Fabricator; respond when an AXIOM structure is attacked. A Fabricator, Vault or the Core under attack also triggers **emergency production**: it spends banked Compute (and, if that runs dry, the next Surge's budget) on defenders — 2 + Threat/4 robots per second, doubled at the Core. Hitting AXIOM's base therefore also shrinks the next Surge.
3. **Raids** — small squads periodically hit exposed human structures (outlying buildings, harvesting Engineers).
4. **Surges** — a visible countdown ("SURGE IN 2:30"). All Fabricators release a wave that converges on the human base along a flow field. Size scales with Compute & Threat. The first Surges are damped while AXIOM is "still learning" (budget ×0.45, ×0.6, ×0.75, ×0.9, then full; only a quarter of the garrison joins Surges 1–2), so **Surge 1 on Veteran is ≈ 20–25 small robots**. Interval 150 s, −4 s per Surge (min 95 s). Every 4th Surge is a **Cascade** with a **Colossus** boss.
   Robots flow toward the human base's real structures. **Walls are not destinations**: robots walk around short wall lines and only chew through a wall when that is cheaper than the detour (a fully enclosed base gets breached at its weakest point). Sappers are the exception — they go for walls.
5. **Overfit adaptation** — see §6.

## 6. Damage & the Overfit system

Three damage types, colour-coded everywhere:

| Type | Colour | Strong vs | Notes |
|---|---|---|---|
| **Kinetic** | amber | Light | bullets, rails; hitscan tracers |
| **Energy** | cyan | Light (chains) | arcs jump between nearby targets |
| **Explosive** | orange | Armored, Structure | projectiles with splash |

Armor classes: **Light**, **Armored**, **Structure**.

| dmg \ armor | Light | Armored | Structure |
|---|---|---|---|
| Kinetic | 1.0 | 0.6 | 0.5 |
| Energy | 1.15 | 0.8 | 0.6 |
| Explosive | 0.7 | 1.5 | 1.5 |

**Overfit**: AXIOM records damage it takes by type. Every **epoch** (75 s; faster at high difficulty) it *trains*: the type that dealt the most damage gains **+15% resistance** (cap 60%), and its counter-type gains **+10% vulnerability** (cap 40%). The cycle:

- Adapting to **Kinetic** (ablative plating) → vulnerable to **Energy** (plating conducts)
- Adapting to **Energy** (insulated shells) → vulnerable to **Explosive** (brittle ceramics)
- Adapting to **Explosive** (shock dampers) → vulnerable to **Kinetic** (thin joints)

`finalDamage = base × typeVsArmor × (1 − resist[type] + vuln[type])`, clamped ≥ 0.1×. Applies only to AXIOM units/structures. The **AXIOM MODEL** HUD panel shows the three bars; each epoch fires an announcement ("AXIOM retrained: KINETIC resist 30%. ENERGY weakness 20%."). Destroying a Data Vault halves all values (Catastrophic Forgetting).

## 7. Hacking

- **Netrunner** channels a hack on a robot within 5 tiles. Requirements: target is not a boss/structure (Lancets excepted), and target is **below 50% HP or stunned**. Channel 1.8 s (interrupted if Netrunner moves/dies or target leaves range).
- Success: robot converts to the human side (teal tint, keeps its stats, heals 25%). Each Netrunner supports **bandwidth 3** hacked units (research → 5). Hacked units don't use pop.
- **If the Netrunner dies, its linked units revert to AXIOM.** Protect your hackers.
- Lancets (AXIOM turrets) can be hacked (5 s channel).
- Commander Protocol **Override** mass-hacks small robots in a radius.

## 8. Human roster

All costs in Scrap unless noted (D = Data). Speeds in tiles/s, range in tiles.

| Unit | From | Cost | Pop | HP | Armor | Weapon | Notes |
|---|---|---|---|---|---|---|---|
| Engineer | HQ | 50 | 1 | 60 | Light | — | harvest 10 scrap/trip (1.6 s to gather; wrecks ×1.5 faster), build, repair |
| Rifleman | Barracks | 60 | 1 | 90 | Light | Kinetic 8 / 0.8 s, r 5.5 | cheap line infantry |
| Arc Trooper | Barracks | 90 | 1 | 85 | Light | Energy 11 / 1.2 s, r 4, chains 2 | anti-swarm |
| Rocketeer | Barracks | 100 | 1 | 80 | Light | Explosive 34 / 2.4 s, r 6.5, splash 0.9 | anti-armor |
| Netrunner | Barracks (Lab) | 110 + 15 D | 1 | 70 | Light | Energy 4 / 1 s, r 5 | Hack |
| Ranger | Barracks (Railguns) | 140 + 10 D | 1 | 75 | Light | Kinetic 48 / 3 s, r 9 | sniper |
| Bulldog | Factory | 240 | 3 | 650 | Armored | Kinetic 30 / 1.6 s, r 6 | main battle tank |
| Volt | Factory (Lab) | 260 + 20 D | 3 | 450 | Armored | Energy 20 / 1 s, r 5, chains 3 | anti-swarm vehicle |
| Thumper | Factory (Lab) | 300 + 30 D | 3 | 300 | Armored | Explosive 70 / 4 s, r 12, min r 3, splash 2 | artillery |

### Buildings (built by Engineers; footprint in tiles)

| Building | Size | Cost | Power | HP | Notes |
|---|---|---|---|---|---|
| HQ | 4×4 | — | +5 | 3000 | trains Engineers, drop-off, +10 pop. Lose all HQs = defeat |
| Generator | 2×2 | 100 | +12 | 500 | |
| Habitat | 2×2 | 80 | 0 | 450 | +8 pop |
| Depot | 2×2 | 100 | 0 | 700 | drop-off point, vision 8 |
| Barracks | 3×3 | 150 | −3 | 1000 | infantry |
| Factory | 3×3 | 250 | −5 | 1400 | vehicles (requires Barracks) |
| Lab | 3×3 | 200 | −4 | 900 | research; unlocks tier-2 |
| Wall | 1×1 | 10 | 0 | 450 | drag to build lines; robots path around short lines and breach full rings (Sappers target walls) |
| Gun Turret | 2×2 | 120 | −2 | 600 | Kinetic 9 / 0.45 s, r 7 |
| Tesla Coil | 2×2 | 160 | −4 | 600 | Energy 22 / 1.4 s, r 5, chains 4 (Lab) |
| Missile Battery | 2×2 | 180 | −3 | 550 | Explosive 42 / 2.6 s, r 9, splash 1.2 (Lab) |
| Sensor Tower | 2×2 | 80 | −1 | 300 | vision 14 |

### Research (Lab; cost Data + Scrap)
Railguns (unlock Ranger), Kinetic Rounds I/II, Capacitor Banks I/II, Shaped Charges I/II (+20% dmg each to a type), Composite Armor I/II (+15% HP), Salvage Protocols (+30% harvest, wrecks +50%), Expanded Bandwidth (hack bandwidth 5, hack channel −1 s), Protocol: EMP Burst, Protocol: Orbital Strike, Protocol: Override.

### Commander Protocols (global, Data + cooldown)
- **Supply Drop** (always available): +200 scrap crate at a visible location. 40 D, 90 s.
- **EMP Burst**: stuns robots in radius 5 for 5 s (enables hacks). 30 D, 60 s.
- **Orbital Strike**: 2 s delay, Explosive 400 in radius 3.5. 60 D, 90 s.
- **Override**: hacks up to 8 non-boss robots in radius 4 (they bind to no Netrunner but expire after 60 s). 80 D, 120 s.

## 9. AXIOM roster

| Robot | Threat | HP | Armor | Speed | Weapon | Role |
|---|---|---|---|---|---|---|
| **Skitter** | 1 | 40 | Light | 3.6 | melee Kinetic 5 / 0.6 s | fast spider swarmling |
| **Gunner** | 1 | 110 | Light | 2.4 | Kinetic 7 / 0.9 s r 5 | ranged line bot |
| **Sapper** | 2 | 60 | Light | 3.0 | suicide Explosive 120 splash 1.5 (×3 vs Structure) | wall/base breaker |
| **Brute** | 3 | 520 | Armored | 1.8 | melee Kinetic 32 / 1.4 s | tank |
| **Lancer** | 4 | 160 | Light | 2.4 | Energy 20 / 1.6 s r 7 | anti-infantry sniper |
| **Wasp** | 5 | 90 | Light | 4.0 | Energy 6 / 0.5 s r 4, **flying** | flier, ignores terrain & walls |
| **Warden** | 6 | 300 | Armored | 2.0 | repairs robots in r 4, 12 HP/s | support |
| **Colossus** | boss | 5000 | Armored | 1.2 | Explosive 55 splash 1.6 / 2.5 s r 7 + stomp | Cascade boss; unhackable |

## 10. Game modes

- **Campaign — 5 operations** (text briefings + in-mission radio):
  1. *First Light* — tutorial: harvest, build, train, survive 2 small Surges, destroy a Relay.
  2. *Salvage Rights* — hacking & Data; destroy a Fabricator.
  3. *Learning Curve* — Overfit introduced; destroy 2 Data Vaults.
  4. *Server Farm* — capture & hold 3 Server Farms for 3 min.
  5. *Hard Reset* — assault the AXIOM Core.
- **Skirmish** — procedural map (seed, size, difficulty); win by destroying the Core.
- **Endless Swarm** — no Core; survive as many Surges as possible; score. **Daily seed** with a shareable emoji result card.

Difficulty: **Recruit / Veteran / Nightmare** — Surge Compute ×0.7 / ×1.0 / ×1.25 and surge size ×0.7 / ×1 / ×1.2 (so Surges are ≈ ×0.5 / ×1 / ×1.5 of Veteran), first Surge at 4:00 / 3:00 / 2:45, epoch length 90 / 75 / 60 s, starting scrap 500 / 400 / 350. AXIOM's *home* economy (garrisons, expansion, emergency defence) only feels 30% of the Compute multiplier, so its base is a fortress on every difficulty; Recruit Surge intervals are 15% longer.

Skirmish maps: two rich scrap fields flank the HQ, two "natural expansion" fields sit ~22 tiles out on the player's side, the rest are scattered (mostly contested or on AXIOM's half). Pockets of walkable ground that units could never leave are filled in at generation.

Balance targets (scripted bot, levels 1–2, 10 seeds × map sizes 80/96/128 — see `tools/headless.ts`): Recruit — the bot wins most games, typically in 14–18 min; Veteran — 30–50% wins, games 22–26 min on average, ~10 Surges survived, the swarm peaks at 200+ robots; Nightmare — the bot usually loses after surviving ~7–8 Surges.

## 11. Controls

- LMB select / drag box-select; Shift adds; double-click selects all of that type on screen; Ctrl+click same.
- RMB smart command: move / attack / harvest / repair / build-resume / hack (Netrunner on eligible robot).
- **A** attack-move, **S** stop, **H** hold, **K** hack (Netrunner), **Shift** queues waypoints.
- **Ctrl+1–9** set group, **1–9** recall (double-tap centres).
- Camera: arrow keys / WASD-free; edge scroll; MMB drag; wheel zoom; minimap click/drag.
- **B** opens Engineer build menu; command-card buttons show hotkeys.
- **Space** jump to last alert, **.** select idle Engineer, **P / Pause** tactical pause (orders allowed while paused), **F10 / Esc** menu, game speed 0.5×–2×.

## 12. UI layout

- **Top bar**: Scrap, Power used/total (red on brownout), Pop, Data · AXIOM Compute (+rate) and Threat · Surge countdown · clock · menu.
- **Bottom-left**: minimap (terrain, Grid, units, fog, camera box, alert pings).
- **Bottom-centre**: selection panel (single: portrait/stats/queue; multi: grouped icons with HP).
- **Bottom-right**: command card (4×3 grid, hotkeys).
- **Right**: AXIOM MODEL panel (resist/vuln bars, epoch timer).
- **Left**: objectives; alert feed. **Top-centre**: radio messages & big announcements.

## 13. Art & audio direction

**Tactical noir**: desaturated ruined city (charcoal asphalt, rust, concrete, dead vegetation) under a slight vignette; saturated team colours. Humans = warm amber + teal accents, soft rounded silhouettes. AXIOM = gunmetal + crimson/magenta glowing optics, angular insectoid silhouettes. Grid = dark crimson circuit traces with pulsing light. Additive glow on projectiles, explosions, arcs. Juice: screen shake on big explosions, hit flashes, debris, scorch decals, wreck sprites.

Audio: synthesised WebAudio SFX (no files): rifle cracks, rail whine, arc zaps, rocket whoosh/boom, robot chitter, hack glitch arpeggio, build chimes, Surge siren. Adaptive music: dark synth drone that layers percussion/bass as threat & combat intensity rise.

## 14. Success criteria

- Loads in < 3 s, 60 fps with ~600 units, playable ≥ 30 fps with 1500.
- A new player can finish mission 1 without external help.
- No softlocks/stuck units in 30-min headless bot runs across 20 seeds.
- Every mechanic in §5–§8 is implemented, telegraphed in UI, and covered by tests.
