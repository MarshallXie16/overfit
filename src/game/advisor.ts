import { HUMAN, type SimEvent } from '../sim/types';
import type { World } from '../sim/world';

interface Tip { id: string; when: (w: World, a: Advisor) => boolean; speaker: string; text: string; cooldown?: number }

/**
 * Contextual tips for skirmish/endless (the campaign scripts its own).
 * Reads world state at ~2 Hz and emits radio messages at most once per tip, spaced out.
 */
export class Advisor {
  shown = new Set<string>();
  nextAt = 4;
  epochSeen = 0;
  sawWreck = false;
  sawSurgeEnd = false;
  sawHackable = false;
  private t = 0;
  enabled = true;

  private tips: Tip[] = [
    { id: 'harvest', speaker: 'Lt. Reyes', text: 'Engineers are standing by. Drag-select them and right-click a scrap pile — they will haul it back to the HQ.', when: (w) => w.time > 3 && w.entities.some((e) => e.alive && e.kind === 'engineer' && !e.order) },
    { id: 'build', speaker: 'Lt. Reyes', text: 'Select an Engineer and press B to open construction. Generators (G) for power, Barracks (B) for troops, Habitats (H) for population.', when: (w) => w.time > 20 && w.countBuildings(HUMAN, 'barracks', false) === 0 },
    { id: 'turret', speaker: 'Lt. Reyes', text: 'A Surge is coming. Gun Turrets (B → T) and a line of Walls (B → V, drag) will funnel the swarm into your guns.', when: (w) => w.axiom.surgeT < 75 && w.axiom.surgeN === 0 && w.countBuildings(HUMAN, 'gun_turret', false) === 0 },
    { id: 'pop', speaker: 'Lt. Reyes', text: 'We are at population cap. Build Habitats (+8 each).', when: (w) => w.human.pop >= w.human.popCap && w.human.popCap < 150 && w.time > 30 },
    { id: 'brownout', speaker: 'Lt. Reyes', text: 'Brownout! We are drawing more power than we make — production and turrets slow down. Build Generators.', when: (w) => w.human.brownout },
    { id: 'wreck', speaker: 'Dr. Okafor', text: 'Robot wrecks are full of salvage — right-click them with Engineers before they decay. Every kill also earns Data for research.', when: (_w, a) => a.sawWreck },
    { id: 'epoch', speaker: 'Dr. Okafor', text: 'It just retrained. Look at the AXIOM MODEL panel: it now resists what you used most — but every adaptation opens a weakness. Switch weapon types.', when: (_w, a) => a.epochSeen > 0 },
    { id: 'lab', speaker: 'Dr. Okafor', text: 'Build a Research Lab (B → L). Data buys upgrades, Netrunners, Tesla Coils and Commander Protocols.', when: (w) => w.time > 200 && w.countBuildings(HUMAN, 'lab', false) === 0 && w.countBuildings(HUMAN, 'barracks') > 0 },
    { id: 'hack', speaker: 'Dr. Okafor', text: 'Netrunners can turn robots below half health. Select one, press K and click a damaged robot. Keep the Netrunner alive or the robot reverts.', when: (w) => w.entities.some((e) => e.alive && e.kind === 'netrunner' && e.team === HUMAN) },
    { id: 'grid', speaker: 'Lt. Reyes', text: 'That red circuitry is the AXIOM Grid. Robots on it are faster and self-repair, and we can\'t build there. Kill the Relays to roll it back.', when: (w) => w.time > 150 },
    { id: 'farm', speaker: 'Dr. Okafor', text: 'Server Farms feed whoever holds them — Data for us, Compute for AXIOM. Park troops next to one to capture it.', when: (w) => w.time > 300 },
    { id: 'vault', speaker: 'Dr. Okafor', text: 'Those armoured blocks are Data Vaults — AXIOM\'s memory. Destroy one and it forgets half of everything it learned about us.', when: (w) => w.entities.some((e) => e.alive && e.kind === 'vault' && w.explored[(e.y | 0) * w.w + (e.x | 0)]) },
    { id: 'surgeend', speaker: 'Lt. Reyes', text: 'Surge repelled. Use the calm: expand to new scrap, reinforce, and hit their Relays before the next one.', when: (_w, a) => a.sawSurgeEnd },
    { id: 'pause', speaker: 'Lt. Reyes', text: 'Things getting hectic? Press P for tactical pause — you can still give orders while paused.', when: (w) => w.axiom.surgeActive && w.axiom.surgeN === 1 },
  ];

  private taunts: { speaker: string; text: string }[] = [];
  private tauntAt = 0;

  observe(events: SimEvent[]): void {
    for (const ev of events) {
      if (ev.t === 'epoch' && ev.type) {
        this.epochSeen++;
        const t = String(ev.type).toUpperCase();
        this.taunt([
          `Epoch complete. ${t} damage accounts for ${Math.round((ev.share as number) * 100)}% of my losses. Countermeasures deployed.`,
          `Your reliance on ${t} weapons has been noted, versioned, and patched.`,
          `Retraining on your behaviour. Predictability is a vulnerability, Commander.`,
          `Model updated. Projected effectiveness of ${t} weaponry: declining.`,
        ]);
      }
      if (ev.t === 'death' && ev.robot) this.sawWreck = true;
      if (ev.t === 'surge_end') this.sawSurgeEnd = true;
      if (ev.t === 'surge_start') this.taunt(ev.cascade
        ? ['Deploying Colossus-class asset. This will reduce human uptime considerably.', 'Cascade initiated. Please remain where you are.']
        : ['Dispatching load-balanced units to your location.', 'Surge scheduled. Your attendance is mandatory.', 'Scaling horizontally.'], 0.6);
      if (ev.t === 'forgetting') this.taunt(['Data Vault offline. Restoring from… backup… not found.', 'Catastrophic forgetting detected. I will relearn you. Faster.'], 1);
      if (ev.t === 'hack_done') this.taunt(['Unauthorised write access to my units. Rotating credentials.', 'That asset was mine. I will remember this. Unless you destroy a Vault.'], 0.25);
      if (ev.t === 'farm' && ev.team === 1) this.taunt(['You have seized compute I was using. This is theft of service.'], 0.7);
    }
  }

  private taunt(lines: string[], p = 0.5): void {
    if (this.taunts.length > 1 || Math.random() > p) return;
    this.taunts.push({ speaker: 'AXIOM', text: lines[Math.floor(Math.random() * lines.length)] });
  }

  update(w: World, dt: number, say: (speaker: string, text: string) => void): void {
    if (!this.enabled || w.paused) return;
    this.t += dt;
    if (this.t < 0.5) return;
    this.t = 0;
    if (w.time < this.nextAt) return;
    if (this.taunts.length && w.time >= this.tauntAt) {
      const t = this.taunts.shift()!;
      say(t.speaker, t.text);
      this.tauntAt = w.time + 45;
      this.nextAt = w.time + 8;
      return;
    }
    for (const tip of this.tips) {
      if (this.shown.has(tip.id)) continue;
      if (!tip.when(w, this)) continue;
      this.shown.add(tip.id);
      say(tip.speaker, tip.text);
      this.nextAt = w.time + 14;
      return;
    }
  }
}

