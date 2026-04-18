import type { CardDef } from "./types";
import { METAL_NAMES } from "./types";

// Global card ID counter (matches Python's _next_card_id)
let _nextCardId = 0;

export function resetCardIds() {
  _nextCardId = 0;
}

// ── Base Card ──

export class Card {
  id: number;
  def: CardDef;
  name: string;
  cost: number;
  metal: number;
  sought: boolean = false;
  /** True if this card was drawn at end of the previous turn and hasn't been
   *  "played" yet (for allies: moved to zone + play() effect; for funding:
   *  play() to give money). Cleared when played at the start of its owner's
   *  next turn. Only meaningful for Ally and Funding cards. */
  pending: boolean = false;

  constructor(def: CardDef) {
    this.id = _nextCardId++;
    this.def = def;
    this.name = def.name;
    this.cost = def.cost;
    this.metal = def.metal;
  }

  toJSON(): { id: number; name: string; type: string; cost: number; metal: number; metalName: string; sought: boolean; pending: boolean; [key: string]: unknown } {
    return {
      id: this.id,
      name: this.name,
      type: "card",
      pending: this.pending,
      cost: this.cost,
      metal: this.metal,
      metalName: this.metal >= 0 && this.metal < METAL_NAMES.length
        ? METAL_NAMES[this.metal]
        : "unknown",
      sought: this.sought,
    };
  }

  reset() {
    // Base reset — overridden by subclasses
  }

  snapshot(): Record<string, unknown> {
    return { sought: this.sought };
  }

  applySnapshot(s: Record<string, unknown>): void {
    this.sought = s.sought as boolean;
  }
}

// ── Action Card ──

export class Action extends Card {
  capacity: number;
  metalUsed: number = 0;
  burned: boolean = false;

  // Abilities stored from CardDef for easy access
  private _ab1Eff: string;
  private _ab1Amt: string;
  private _ab2Eff: string;
  private _ab2Amt: string;
  private _ab3Eff: string;
  private _ab3Amt: string;
  private _activeEff: string;
  private _activeAmt: string;
  private _burnEff: string;
  private _burnAmt: string;

  constructor(def: CardDef) {
    super(def);
    this._ab1Eff = def.ability1Effect ?? "";
    this._ab1Amt = def.ability1Amount ?? "";
    this._ab2Eff = def.ability2Effect ?? "";
    this._ab2Amt = def.ability2Amount ?? "";
    this._ab3Eff = def.ability3Effect ?? "";
    this._ab3Amt = def.ability3Amount ?? "";
    this._activeEff = def.activeEffect ?? "";
    this._activeAmt = def.activeAmount ?? "";
    this._burnEff = def.burnEffect ?? "";
    this._burnAmt = def.burnAmount ?? "";

    // Capacity = how many metal levels this card supports
    if (this._ab3Eff) {
      this.capacity = 3;
    } else if (this._ab2Eff) {
      this.capacity = 2;
    } else {
      this.capacity = 1;
    }
  }

  // Access abilities by data index (for compatibility with engine logic)
  // data[3]=ab1eff, data[4]=ab1amt, data[5]=ab2eff, ... data[9]=activeEff, data[10]=activeAmt, data[11]=burnEff, data[12]=burnAmt
  get data(): string[] {
    return [
      this.name,         // 0
      String(this.cost), // 1
      String(this.metal),// 2
      this._ab1Eff,      // 3
      this._ab1Amt,      // 4
      this._ab2Eff,      // 5
      this._ab2Amt,      // 6
      this._ab3Eff,      // 7
      this._ab3Amt,      // 8
      this._activeEff,   // 9
      this._activeAmt,   // 10
      this._burnEff,     // 11
      this._burnAmt,     // 12
    ];
  }

  burn(player: { resolve(effect: string, amount: string): void }) {
    this.burned = true;
    if (this._burnEff) {
      player.resolve(this._burnEff, this._burnAmt);
    }
  }

  addMetal(player: { resolve(effect: string, amount: string): void }) {
    this.metalUsed += 1;
    // Ability index: metalUsed=1 -> data[3,4], metalUsed=2 -> data[5,6], metalUsed=3 -> data[7,8]
    const idx = this.metalUsed;
    const effects = [
      [this._ab1Eff, this._ab1Amt],
      [this._ab2Eff, this._ab2Amt],
      [this._ab3Eff, this._ab3Amt],
    ];
    if (idx >= 1 && idx <= 3) {
      const [eff, amt] = effects[idx - 1];
      if (eff) {
        player.resolve(eff, amt);
      }
    }
  }

  ability1(player: { resolve(effect: string, amount: string): void }) {
    player.resolve(this._ab1Eff, this._ab1Amt);
  }

  override reset() {
    this.burned = false;
    this.metalUsed = 0;
  }

  override toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      type: "action" as const,
      capacity: this.capacity,
      metalUsed: this.metalUsed,
      burned: this.burned,
      abilities: this._getAbilities(),
      ...(this._activeEff ? { activeAbility: { effect: this._activeEff, amount: this._activeAmt } } : {}),
      ...(this._burnEff ? { burnAbility: { effect: this._burnEff, amount: this._burnAmt } } : {}),
    };
  }

  private _getAbilities() {
    const abilities: { effect: string; amount: string }[] = [];
    const pairs: [string, string][] = [
      [this._ab1Eff, this._ab1Amt],
      [this._ab2Eff, this._ab2Amt],
      [this._ab3Eff, this._ab3Amt],
    ];
    for (const [eff, amt] of pairs) {
      if (eff) abilities.push({ effect: eff, amount: amt });
    }
    return abilities;
  }
}

// ── Ally Card ──

export class Ally extends Card {
  health: number;
  defender: boolean;
  available1: boolean = false;
  available2: boolean = false;
  availableRiot: boolean = false;

  private _ab1Eff: string;
  private _ab1Amt: string;
  private _ab2Eff: string;
  private _ab2Amt: string;

  constructor(def: CardDef) {
    super(def);
    this._ab1Eff = def.ability1Effect ?? "";
    this._ab1Amt = def.ability1Amount ?? "";
    this._ab2Eff = def.ability2Effect ?? "";
    this._ab2Amt = def.ability2Amount ?? "";
    this.health = def.health ?? 0;
    this.defender = def.defenseType === "D";
    this.reset();
  }

  // data[] compatibility for engine logic that accesses card.data[N]
  get data(): string[] {
    return [
      this.name,           // 0
      String(this.cost),   // 1
      String(this.metal),  // 2
      this._ab1Eff,        // 3
      this._ab1Amt,        // 4
      this._ab2Eff,        // 5
      this._ab2Amt,        // 6
      String(this.health), // 7
      "",                  // 8 (on-play special, checked by name)
      this.defender ? "D" : "", // 9
      "",                  // 10
    ];
  }

  ability1(player: { resolve(effect: string, amount: string): void }) {
    player.resolve(this._ab1Eff, this._ab1Amt);
    this.available1 = false;
  }

  ability2(player: { resolve(effect: string, amount: string): void }) {
    player.resolve(this._ab2Eff, this._ab2Amt);
    this.available2 = false;
  }

  riot(player: { resolve(effect: string, amount: string): void }) {
    this.availableRiot = false;
    player.resolve(this._ab1Eff, this._ab1Amt);
  }

  play(player: { extraBurn(n: number): void; permDraw(n: number): void; smoking: boolean }) {
    if (this.name === "Noble") player.extraBurn(1);
    if (this.name === "Crewleader") player.permDraw(1);
    if (this.name === "Smoker") player.smoking = true;
  }

  override reset() {
    if (this._ab1Eff) {
      this.available1 = true;
      this.availableRiot = true;
      if (this._ab2Eff) {
        this.available2 = true;
      }
    }
  }

  override toJSON() {
    const base = super.toJSON();
    const abilities: { effect: string; amount: string }[] = [];
    if (this._ab1Eff) abilities.push({ effect: this._ab1Eff, amount: this._ab1Amt });
    if (this._ab2Eff) abilities.push({ effect: this._ab2Eff, amount: this._ab2Amt });

    return {
      ...base,
      type: "ally" as const,
      health: this.health,
      defender: this.defender,
      available1: this.available1,
      available2: this.available2,
      abilities,
    };
  }
}

// ── Funding Card ──

export class Funding extends Card {
  constructor(def: CardDef) {
    super(def);
  }

  play(owner: { money(n: number): void }) {
    owner.money(1);
  }

  override reset() {
    // Funding has no state to reset
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      type: "funding" as const,
    };
  }
}

// ── Factory ──

export function createCard(def: CardDef): Card {
  switch (def.cardType) {
    case 1: return new Funding(def);
    case 2: return new Action(def);
    case 3: return new Ally(def);
    default: return new Card(def);
  }
}
