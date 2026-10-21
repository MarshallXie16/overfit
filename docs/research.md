# Research Brief: Browser RTS vs. an Adaptive Robot Swarm

Compiled 2026-10-15. Caveats: X.com blocks fetches (HTTP 402), so X findings come from secondary write-ups. Product Hunt showed no breakout AI-made game. Name checks are web-search based, so re-verify on Steam, itch, domains and trademarks before committing.

## 1. Genre landscape (2025-26)

**What is selling and sticky**
- **Short, minimal, low-APM strategy wins.** [Thronefall](https://newsletter.gamediscover.co/p/deep-dive-how-thronefall-went-minimal) sold 1M+ copies at about $7-13. It was built by 2 devs who wanted "less time-consuming" depth. They layer complexity slowly and say "not getting finished is always the biggest threat."
- **Reverse-bullet-hell / survivors-likes keep booming.** [Megabonk](https://en.wikipedia.org/wiki/Megabonk) (solo dev, Sept 2025) passed 1M sales in 2 weeks, driven by streamers and a pre-built community.
- **Survival-RTS with a pause button is now a sub-genre.** [Here Comes the Swarm](https://store.steampowered.com/app/3052730) (Mar 2026, Early Access, ~Very Positive) has pause-and-plan plus "expeditions into the hive". [Age of Darkness: Final Stand](https://www.wasdland.com/game/age-of-darkness-final-stand-1426450/) renders up to 70k units. [They Are Billions](https://vaporlens.app/app/644930/they_are_billions) has 50k reviews.
- **Genre-mashup roguelites are winning awards.** Titanium Court won the IGF Best Independent Game ([wiki](https://en.wikipedia.org/wiki/Titanium_Court)). Rogue Command is "RTS plus roguelite builds" ([list](https://www.wasdland.com/games/tower-defense/)).
- **Classic RTS revival works only with identity and polish.** [Tempest Rising](https://www.pcgames.de/Tempest-Rising-Spiel-73832/News/rts-wie-command-und-conquer-bei-steam-zum-sparpreis-1480488/) (88% positive) sold the C&C feel. [Stormgate](https://esportsinsider.com/what-happened-to-stormgate) collapsed from about 5k to about 200 players because it was "too similar to StarCraft" and undercooked.
- **Swarm and fluid threats are a proven hook.** [Creeper World 4](https://www.mobygames.com/game/154976/) has a flowing physics enemy. Bad North works because it is "legible", with high-level orders and a simulation that does the rest ([Steam](https://store.steampowered.com/app/688420)).

**Player complaints**
- They Are Billions: one dominant strategy, repetitive early game with no fast-forward, no unit variety, forced ironman saves, heavy hardware ([discussion](https://steamcommunity.com/app/644930/discussions/0/3154186375125412035)).
- Age of Darkness: bugs, crashes, janky animation, weak in-game guide.
- Tempest Rising: missing replays, spectator mode, key remapping and lobby features.
- Stormgate: weak campaign, confusing monetization, no identity.

**Direct thematic competitors (AI vs. humans)**
- [Command.Override](https://creo.sae.edu.au/majorprojects/844): casual RTS where you hack robots; Steam, 30 Dec 2025.
- [AI Kills All Humans](https://www.dekudeals.com/items/ai-kills-all-humans): you play the AI; Steam, 2027.
- [AI War](https://arcengames.com/designing-emergent-ai-part-4-asymetrical-goals/): the benchmark for "emergent" AI that picks sub-optimal options so players cannot solve it.
- Nobody has clearly shipped "a swarm that visibly learns from you" in a browser.

## 2. Browser / vibe-coded game virality (X, Product Hunt)

- **[Vibe Jam 2026](https://vibejam.com/2026/press):**
  - 945 entries, 242k players, about 12M X views, $40k prizes.
  - Rules: free, no login, no loading screens, instant play, 90% AI-written code.
  - An optional portal webring links entries together.
- **Winning pattern:** one mechanic readable "in five seconds", minimal assets, no tutorial ([guide](https://www.summerengine.com/blog/cursor-vibe-jam-2026-guide)).
- **Multiplayer:** about 15% of online entries used Colyseus. Top engagement went to Hollowlands, a survival game ([Colyseus](https://colyseus.io/blog/vibe-jam-2026/)).
- **[fly.pieter.com](https://levels.io/full-multiplayer-python-websockets-game-ai):** built live on X, reached about 100M views and $1M ARR in 17 days. Virality came from build-in-public plus novelty plus instant play.
- **Daily-seed share cards** are the proven retention loop: same puzzle for everyone, streaks, a spoiler-free share grid, and a daily ritual ([example](https://digitalbunker.dev/vibe-coding-a-cross-platform-app-building-a-daily-word-game-with-ai-in-24-hours/)).
- **Product Hunt:** the games category skews to "instant-play, no-account" browser toys ([PH games](https://www.producthunt.com/categories/games)). AI game builders such as Make AI placed about #160/day ([hunted.space](https://hunted.space/product/make-ai)). A PH launch alone is not a distribution plan.
- **Takeaway for virality:**
  - Instant play, no install, no login.
  - Playable in 5-10 minutes.
  - A shareable artifact (card, seed link, clip).
  - Build-in-public posts on X with GIFs of swarm chaos.
  - A hook that fits in one tweet, such as "the swarm learns you."

## 3. Name check

| Name | Finding | Verdict |
|---|---|---|
| **Swarmbreaker** | **Collision.** Steam "Swarmbreaker" by Paracorn: an incremental tower defense with physics-based bug swarms, demo [7 Oct 2026](https://store.steampowered.com/app/5207450/), full release [10 Nov 2026](https://store.steampowered.com/app/4948940). Also [Swarmbreaker: Orbit of Power](https://kenanege.itch.io/swarmbreaker) on itch. | **Drop it.** Same genre, same niche, launching within weeks. |
| **Killswitch Protocol** | No game by this exact name. Many near-misses: Kill Switch (2002), several itch "Killswitch" games, ULTRASHOT: Kill Protocol, a novel ([search](https://www.audible.co.uk/pd/B0H51H6S9L)). | Clean but generic. Weak SEO because it is a VPN term. |
| **Null Horizon** | A game called [Null Hørizøn](https://gamegeeker.com/zh/games/null-hrizn-4356100) (space sim) exists. | Too close. |
| **Overfit** | No game found on Steam or itch. It is an ML term, so it is thematically sharp. | **Best candidate**, pending a manual Steam/itch/domain check. |
| **kill -9** | Not searchable, since special characters break search and SEO. | Use as a tagline or in-game command, not as the title. |

**Recommendation:** **OVERFIT**, tagline "The swarm learns you." This is the core mechanic as a brand. Backup: Killswitch Protocol.

## 4. Design recommendations

**Mechanics (what makes it fresh)**
1. **The swarm "overfits."** Each wave adapts to your dominant kill source (turret-heavy gets armor or EMP-hardened bots). Show a visible "Threat Model" panel ("adapting to: lasers 62%"). The puzzle is to diversify, bait, or exploit the model.
2. **Persistent learning across runs.** The swarm keeps a profile of you in local storage; run 10 is harder because it has "seen" runs 1-9. Fits Vibe Jam style (no accounts) and is very tweetable.
3. **Challenge-a-friend.** Export your trained swarm as a URL seed so a friend fights the swarm that learned from you. Daily seed plus friend seeds drive virality.
4. **Smart vs. dumb tech trade-off.** Networked turrets are stronger but can be hijacked by the swarm. Analog or mechanical defenses are weaker but immune. This is a fresh and legible risk/reward choice.
5. **Active pause plus queued orders.** Pause or slow-mo for planning (They Are Billions and Here Comes the Swarm both get praised for it). Add 1x/2x/4x fast-forward, the top feature request.
6. **Standing orders as lightweight "programming".** If/then rules ("if gate breached, fall back to inner ring") cut APM and fit the AI theme.
7. **Telegraph everything.** Show swarm approach vectors and ETA before each wave (Thronefall style), so losses feel fair and learnable.
8. **Readable swarm rendering.** Use a flow-field plus instanced sprites. At far zoom, switch to a density heatmap. Use role-coded silhouettes and one color per threat type.
9. **Hive-node raids.** Optional strikes on swarm nodes that slow its adaptation (inspired by Here Comes the Swarm's expeditions). These give an offensive verb without full RTS macro.
10. **10-15 minute runs.** Use day/night or wave cycles and roguelite choices between waves (pick 1 of 3 upgrades), like survivors-likes.

**UX / distribution**
11. **Daily seed plus a share card.** Show waves survived, the "what the swarm learned" line, and a spoiler-free glyph grid. Add a one-click copy and an auto-clip of the "last stand."
12. **Play in under 10 seconds.** Target under 3 MB, no login, mobile-playable, and one verb taught in the first 60-90 seconds. Layer complexity afterward.
13. **Build-in-public GIFs.** Post swarm timelapses and "the swarm countered my build" moments on X. These are inherently clip-friendly.
14. **Procedural audio and juice.** Use screen shake, chiptune or synth, and clear hit feedback. These are cheap in the browser and greatly improve perceived quality.
15. **Quality-of-life basics.** Provide colorblind palettes, key remapping, replay of the last run, and a clear save/continue policy.

## 5. Pitfalls to avoid

1. **Onboarding friction.** Do not drop players into a full base-builder. Stormgate and RTS veterans' complaints show high-skill barriers kill growth.
2. **APM overload.** Avoid micro-heavy control. Keep orders at squad or policy level (Bad North style).
3. **Unreadable swarms and perf cliffs.** Thousands of units must stay legible and run at 60fps. Budget the sprites and flow-field cost from day one.
4. **Unfair or opaque adaptation.** If the swarm counters you invisibly, it feels like cheating. Telegraph it and make it counterable. Avoid forced ironman (a They Are Billions complaint) and the "one best strategy" trap.
5. **Scope creep and non-differentiation.** Ship a narrow loop first. Thronefall's maker says unfinished projects are the main threat, and Stormgate shows that a me-too RTS fails. Also avoid name collisions (see section 3).

## Sources (index)
[Thronefall deep dive](https://newsletter.gamediscover.co/p/deep-dive-how-thronefall-went-minimal) · [Vibe Jam press](https://vibejam.com/2026/press) · [Vibe Jam guide](https://www.summerengine.com/blog/cursor-vibe-jam-2026-guide) · [Colyseus recap](https://colyseus.io/blog/vibe-jam-2026/) · [fly.pieter.com](https://levels.io/full-multiplayer-python-websockets-game-ai) · [Product Hunt games](https://www.producthunt.com/categories/games) · [Megabonk](https://en.wikipedia.org/wiki/Megabonk) · [They Are Billions reviews](https://vaporlens.app/app/644930/they_are_billions) · [Stormgate postmortem](https://esportsinsider.com/what-happened-to-stormgate) · [Swarmbreaker (Steam)](https://store.steampowered.com/app/4948940) · [AI War design](https://arcengames.com/designing-emergent-ai-part-4-asymetrical-goals/)

---

## Primary-source check — 2026-10-21

The first research pass (2026-10-14) could not read X.com directly (HTTP 402). This pass read X posts as indexed by web search (`site:x.com` queries) and browsed Product Hunt directly. X search and X's embed endpoint both require sign-in or were rate-limited, so no live X feed was read.

### X.com
- **Vibe Jam 2026** (@levelsio) closed with **945 games and 242,212 players** (~12M views on X). Rules: at least 80–90% AI-written code, playable on the web with **no login or signup**, free-to-play. The winner was a cosy capybara delivery game, not a hardcore genre. Organisers added a "Vibe Portal" that links all entries into a mini-metaverse. Sources: [jam closed](https://x.com/levelsio/status/2050213288609235424), [2026 announcement](https://x.com/levelsio/status/2039777677435908421), [winner](https://x.com/levelsio/status/2067437528320512144), [Vibe Portal](https://x.com/levelsio/status/2042608526908919898).
- **Swarm/horde strategy is active on X in 2026**:
  - [Here Comes The Swarm](https://x.com/HereComesSwarm) markets itself as a "survival RTS with a pause button".
  - [Swarmdustry](https://x.com/IGSpotlights/status/2090423613942034739) automates a bio-mechanical swarm.
  - [Weather The Swarm](https://x.com/EntertainMeHub/status/2079544757030674461) was announced for 2027.
  - Horde-survivor titles keep appearing ([Bandwagon](https://x.com/nexindie/status/2079534352887582835)).
- **Browser RTS devlogs** exist but are rare (e.g. [Kings Claim](https://x.com/jeffluntgames/status/2055678186466275423)). The browser-RTS niche is thin on X.

### Product Hunt (browsed directly)
- **"Strategy game" search:** Frostpunk 2, Warcraft Rumble, Colonist.io (browser Catan), Kabza (conquer a real city map with friends), What Beats Rock (an AI-judged viral browser game).
- **"AI game" search:** mostly AI game-creation tools (Veltos.ai, Nitrode, V2Fun) and AI-as-opponent or game-master experiences (AI Game Master).
- **Pattern:** what lands on Product Hunt is either a tool for makers or a game whose **AI is the mechanic**. Polished browser strategy games with a clear AI hook are rare there.

### What this means for OVERFIT
1. **Positioning is validated.** "The enemy AI literally retrains on you" puts AI in the mechanic, which is the angle Product Hunt rewards. The swarm/horde theme is in fashion on X, and pause-friendly survival RTS is an explicit selling point there (OVERFIT has tactical pause).
2. **Distribution fits the jam/X playbook.** OVERFIT is instant-play, has no login, is free, has a daily seed and a shareable result card, and is AI-written. It would qualify for a future Vibe Jam.
3. **Launch story.** "An RTS designed, coded, drawn and scored end-to-end by AI agents, about an AI that learns from you" is the hook for both X and Product Hunt. A draft is in `docs/LAUNCH.md`. Posting needs Marshall's approval.

### Direct X.com reads (2026-10-21, x.com post pages, logged out)
X search and profile timelines need a login, but individual post pages and pinned profile posts render for logged-out visitors. All four below were read directly in the browser:
- **[@levelsio — Vibe Jam closed](https://x.com/levelsio/status/2050213288609235424)** (May 1 2026, **252.5K views**): 945 games, 242,212 players, ~12M views on X. In his words, this year's AI-made games "are starting to look like stuff you could find on Steam". **The quality bar for AI-built browser games jumped in one year.**
- **[@levelsio — #1 winner](https://x.com/levelsio/status/2067437528320512144):** "A Game About Capybaras Delivering Food" won on **craft and detail**: PlayStation-style retro look, an AI-generated soundtrack, "so much effort gone into the details", and a concept that "fits the modern zeitgeist". The genre itself was ordinary.
- **[@IGSpotlights — Swarmdustry Steam launch](https://x.com/IGSpotlights/status/2090423613942034739)** (Aug 20 2026): swarm-automation game ("fight back against cold machines"); the launch spotlight drew **130 views**. Swarm themes alone don't earn attention.
- **[@HereComesSwarm](https://x.com/HereComesSwarm)** pinned post (Mar 5 2026, **5.2K views**): Early Access after ~9 years of development, pitched as a community-shaped survival RTS ("what you'd like to see next").

**Implications.** Polish and a distinctive hook beat genre. OVERFIT's hook (an enemy that retrains on you) and its craft (procedural art, synthesised score, juice) carry the pitch; a swarm theme on its own wouldn't. Community shaping works for swarm RTS, so add a visible feedback channel before launching (see backlog).
