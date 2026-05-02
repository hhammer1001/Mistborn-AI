/**
 * rng.ts — Seeded RNG with deterministic sub-streams.
 *
 * Used to make games reproducible: a single root seed deterministically
 * derives every RNG stream consumed by the engine (market shuffle, each
 * player's initial deck shuffle, mid-game shuffles, per-bot exploration).
 *
 * Replay only needs to persist the root seed; sub-streams are pure
 * functions of (seed, label).
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    // mulberry32 needs a non-zero state; coerce 0 to a fixed non-zero value
    // so seed=0 still produces a usable stream.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Returns the next number in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [0, n). Mirrors `Math.floor(Math.random() * n)`. */
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Snapshot a copy with the current state — clone advances independently. */
  clone(): Rng {
    const c = new Rng(0);
    c.state = this.state;
    return c;
  }
}

/**
 * Derives an independent sub-seed from a root seed and a label.
 *
 * Uses splitmix32 over (seed XOR hash(label)) so two different labels
 * applied to the same root seed produce uncorrelated streams.
 */
export function splitSeed(rootSeed: number, label: string): number {
  // FNV-1a over the label bytes; cheap and good enough for de-correlation.
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  // splitmix32 finalizer on (seed XOR labelHash).
  let x = ((rootSeed >>> 0) ^ h) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** Convenience: build an Rng for a labeled sub-stream of `rootSeed`. */
export function subRng(rootSeed: number, label: string): Rng {
  return new Rng(splitSeed(rootSeed, label));
}

/** Generate a fresh root seed from Math.random — used when callers don't supply one. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
