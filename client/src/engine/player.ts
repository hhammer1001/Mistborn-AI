import { Card, Action, Ally, Funding } from "./card";
import { PlayerDeck } from "./deck";
import type { Mission } from "./mission";
import type { Game } from "./game";
import { CHARACTER_DEFS } from "./data/characters";
import type { GameActionInternal, SerializedGameAction } from "./types";
import { METAL_NAMES, TRAINING_REWARDS, ACTION_TYPE_TO_CODE } from "./types";

/** Copy all mutable state from `src` into `dest`. Used by Player.clone and
 *  by callers that want to construct a Player subclass (e.g. a simulation
 *  player) with the same state as an existing player. */
export function copyPlayerState(dest: Player, src: Player, cardMap: Map<number, Card>): void {
  dest.curHealth = src.curHealth;
  dest.smoking = src.smoking;
  dest.pDamage = src.pDamage;
  dest.pMoney = src.pMoney;
  dest.handSize = src.handSize;
  dest.atium = src.atium;
  dest.metalTokens = [...src.metalTokens];
  dest.metalAvailable = [...src.metalAvailable];
  dest.metalBurned = [...src.metalBurned];
  dest.burns = src.burns;
  dest.training = src.training;
  dest.charAbility1 = src.charAbility1;
  dest.charAbility2 = src.charAbility2;
  dest.charAbility3 = src.charAbility3;
  dest.alive = src.alive;
  dest.curDamage = src.curDamage;
  dest.curMoney = src.curMoney;
  dest.curMission = src.curMission;
  dest.curBoxings = src.curBoxings;
  dest.ability1metal = src.ability1metal;
  dest.ability1effect = src.ability1effect;
  dest.ability1amount = src.ability1amount;

  // Allies are always-in-play — not in any deck collection, so clone fresh
  // and add to the cardMap for cross-reference lookups.
  dest.allies = src.allies.map((a) => {
    const cloned = a.clone() as Ally;
    cardMap.set(a.id, cloned);
    return cloned;
  });

  dest._active_card = src._active_card ? (cardMap.get(src._active_card.id) ?? null) : null;
}

export class Player {
  name: string;
  allies: Ally[] = [];
  game: Game;
  character: string;
  curHealth: number;
  smoking = false;

  pDamage = 0;
  pMoney = 0;
  handSize = 5;
  _active_card: Card | null = null;

  deck: PlayerDeck;
  atium = 0;
  metalTokens: number[] = new Array(9).fill(0);
  metalAvailable: number[] = new Array(9).fill(0);
  metalBurned: number[] = new Array(9).fill(0);
  burns = 1;
  training = 0;
  trainingRewards = TRAINING_REWARDS;
  charAbility1 = true;
  charAbility2 = true;
  charAbility3 = true;
  turnOrder: number;
  alive = true;

  curDamage = 0;
  curMoney = 0;
  curMission = 0;
  curBoxings = 0;

  ability1metal: string;
  ability1effect: string;
  ability1amount: string;

  // Effect dispatch table
  private missionFuncs: Record<string, (amount: number) => void>;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Player", character = "Kelsier") {
    this.name = name;
    this.game = game;
    this.character = character;
    this.turnOrder = turnOrder;
    this.deck = deck;
    this.curHealth = 36 + 2 * turnOrder;

    if (this.curHealth > 40) {
      this.curHealth = 40;
      this.curBoxings = 1;
    }

    const charDef = CHARACTER_DEFS[character];
    this.ability1metal = charDef ? String(charDef.ability1Metal) : "0";
    this.ability1effect = charDef?.ability1Effect ?? "D";
    this.ability1amount = charDef?.ability1Amount ?? "1";

    this.missionFuncs = {
      D: (n) => this.damage(n),
      M: (n) => this.money(n),
      H: (n) => this.heal(n),
      C: (n) => this.draw(n),
      E: (n) => this.eliminate(n),
      A: (n) => this.gainAtium(n),
      T: (n) => this.train(n),
      K: (n) => this.killEnemyAlly(n),
      R: (n) => this.refresh(n),
      B: (n) => this.extraBurn(n),
      Pc: (n) => this.permDraw(n),
      Pd: (n) => this.permDamage(n),
      Pm: (n) => this.permMoney(n),
      riot: (n) => this.riot(n),
      Mi: (n) => this.mission(n),
      seek: (n) => this.seek(n),
      pull: (n) => this.pull(n),
      push: (n) => this.push(n),
      choose: () => { /* handled in resolve() */ },
      special1: () => this.special1(),
      special2: () => this.special2(),
      special3: () => this.special3(),
      special4: () => this.special4(),
      special5: () => this.special5(),
      special6: () => this.special6(),
      special7: () => this.special7(),
      special8: () => this.special8(),
      special9: () => this.special9(),
      special10: () => this.special10(),
      special11: () => this.special11(),
      special12: () => this.special12(),
      special13: () => this.special13(),
      special14: () => this.special14(),
      special15: () => this.special15(),
      special16: () => this.special16(),
    };
  }

  // ── Turn flow (used by bots, overridden for web play) ──

  playTurn(game: Game) {
    // Start-of-turn: apply permanent bonuses, play pending allies/funding drawn
    // at the end of the previous turn. (session.ts does this separately for
    // its unified flow; here we handle it for bot-vs-bot Game.play().)
    this.curMoney = this.pMoney;
    this.curDamage = this.pDamage;
    this.playPending();
    this.resolve("T", "1");
    this.takeActions(game);
    this.assignDamage(game);
    game.attack(this);
    this.curDamage = 0;  // pDamage is applied at the start of the next turn instead
  }

  /** Play allies (→ zone + run play()) and funding (→ money) that were drawn
   *  as pending at the end of the previous turn. */
  playPending() {
    const remaining: Card[] = [];
    for (const c of this.deck.hand) {
      if (c.pending && c instanceof Ally) {
        c.pending = false;
        c.play(this);
        this.allies.push(c);
      } else {
        remaining.push(c);
      }
    }
    this.deck.hand = remaining;
    for (const c of this.deck.hand) {
      if (c.pending && c instanceof Funding) {
        c.pending = false;
        c.play(this);
      }
    }
  }

  takeActions(game: Game) {
    for (;;) {
      const actions = this.availableActions(game);
      const action = this.selectAction(actions, game);
      this.performAction(action, game);
      if (action.type === "end_actions") return;
    }
  }

  selectAction(_actions: GameActionInternal[], _game: Game): GameActionInternal {
    // Base Player uses console (overridden by bots and WebPlayer)
    throw new Error("selectAction not implemented for base Player");
  }

  assignDamage(game: Game) {
    for (;;) {
      const [targets, opp] = game.validTargets(this);
      const choice = this.assignDamageIn(targets);
      if (choice === -1) return;
      this.curDamage -= targets[choice].health;
      opp.killAlly(targets[choice]);
    }
  }

  assignDamageIn(_targets: Ally[]): number {
    return -1; // Base: don't kill any allies
  }

  // ── Core effect resolution ──

  resolve(effect: string, amount: string) {
    const elist = effect.split(".");
    const vlist = amount.split(".");
    for (let i = 0; i < elist.length; i++) {
      if (elist[i] === "choose") {
        this.choose(vlist[i]);
      } else {
        const e = elist[i];
        const v = parseInt(vlist[i], 10);
        const fn = this.missionFuncs[e];
        if (fn) fn(v);
      }
    }
  }

  // ── Basic effects ──

  damage(amount: number) { this.curDamage += amount; }
  money(amount: number) { this.curMoney += amount; }
  heal(amount: number) {
    this.curHealth += amount;
    if (this.curHealth > 40) this.curHealth = 40;
  }
  mission(amount: number) { this.curMission += amount; }
  draw(amount: number) { this.deck.draw(amount, this); }
  gainAtium(amount: number) { this.atium += amount; }
  extraBurn(amount: number) { this.burns += amount; }
  permDraw(amount: number) { this.handSize += amount; }
  permMoney(amount: number) { this.pMoney += amount; }
  permDamage(amount: number) { this.pDamage += amount; }

  train(amount: number) {
    for (let i = 0; i < amount; i++) {
      this.training += 1;
      if (this.training in this.trainingRewards) {
        const [eff, amt] = this.trainingRewards[this.training];
        this.resolve(eff, amt);
      } else if (this.training > 20) {
        this.gainAtium(1);
      }
    }
  }

  // ── Interactive decisions (overridden by bots and WebPlayer) ──

  senseCheckIn(_card: Action): boolean { return false; }
  killEnemyAllyIn(_allies: Ally[]): number { return -1; }
  cloudAlly(_card: Card, _ally: Ally): boolean { return false; }
  eliminateIn(): number { return -1; }
  pullIn(): number { return -1; }
  subdueIn(_choices: Card[]): number { return -1; }
  soarIn(_choices: Card[]): number { return -1; }
  confrontationIn(_choices: Action[]): number { return -1; }
  informantIn(_card: Card): boolean { return false; }
  keeperIn(_choices: Card[]): number { return -1; }
  chooseIn(_options: string[]): number { return 0; }
  refreshIn(): number { return 0; }
  pushIn(): number { return -1; }
  riotIn(_riotable: Ally[]): Ally { return _riotable[0]; }
  seekIn(_twice: boolean, _seeker: boolean, _choices: Action[]): [number, number] { return [-1, -1]; }
  cloudP(_card: Action): boolean { return false; }

  // ── Sense check ──

  senseCheck(): number {
    for (const card of this.deck.hand) {
      if (card instanceof Action && card.data[9] === "sense") {
        if (this.senseCheckIn(card)) {
          const idx = this.deck.hand.indexOf(card);
          if (idx !== -1) this.deck.hand.splice(idx, 1);
          this.deck.discard.push(card);
          return parseInt(card.data[10], 10);
        }
      }
    }
    return 0;
  }

  // ── Complex abilities ──

  killEnemyAlly(_amount = 0) {
    const [options, opp] = this.game.validTargets(this, true);
    if (options.length > 0) {
      const choice = this.killEnemyAllyIn(options);
      if (choice !== -1) {
        opp.killAlly(options[choice]);
      }
    }
  }

  killAlly(ally: Ally) {
    // Check for cloudA protection
    for (const card of [...this.deck.hand]) {
      if (card instanceof Action && card.data[9] === "cloudA") {
        if (this.cloudAlly(card, ally)) {
          const idx = this.deck.hand.indexOf(card);
          if (idx !== -1) this.deck.hand.splice(idx, 1);
          this.deck.discard.push(card);
          return;
        }
      }
    }
    // Undo on-play effects
    if (ally.name === "Noble") this.extraBurn(-1);
    if (ally.name === "Crewleader") this.permDraw(-1);
    if (ally.name === "Smoker") this.smoking = false;
    const idx = this.allies.indexOf(ally);
    if (idx !== -1) this.allies.splice(idx, 1);
    this.deck.discard.push(ally);
  }

  eliminate(amount: number) {
    for (let i = 0; i < amount; i++) {
      const choice = this.eliminateIn();
      if (choice === -1) break;
      this.game.market.discard.push(this.deck.eliminate(choice));
    }
  }

  pull(amount: number) {
    for (let i = 0; i < amount; i++) {
      const choice = this.pullIn();
      if (choice === -1) return;
      const card = this.deck.discard[choice];
      this.deck.cards.unshift(card);
      this.deck.discard.splice(choice, 1);
    }
  }

  choose(options: string) {
    const ops = options.slice(1, -1).split("/"); // strip parens, split
    const choice = this.chooseIn(ops);
    this.resolve(ops[2 * choice], ops[2 * choice + 1]);
  }

  refresh(_amount: number) {
    const choice = this.refreshIn();
    if (this.metalTokens[choice] === 2) this.metalTokens[choice] = 0;
    if (this.metalTokens[choice] === 4) this.metalTokens[choice] = 3;
  }

  push(_amount = 1) {
    const choice = this.pushIn();
    if (choice > -1) {
      const card = this.game.market.hand[choice];
      this.game.market.discard.push(card);
      this.game.market.buy(card);
    }
  }

  riot(_amount: number) {
    const riotable: Ally[] = [];
    for (const ally of this.allies) {
      if (ally.availableRiot) riotable.push(ally);
    }
    if (riotable.length > 0) {
      const choice = this.riotIn(riotable);
      choice.riot(this);
    }
  }

  seek(amount: number) {
    let seeker = false;
    let twice = false;
    if (amount === -6) { amount = 6; twice = true; }
    else if (amount === -5) { amount = 5; seeker = true; }

    const choices: Action[] = [];
    for (const c of this.game.market.hand) {
      if (c.cost <= amount && c instanceof Action) choices.push(c);
    }
    if (choices.length === 0) return;
    if (choices.length === 1) twice = false;

    const [choice, choice2] = this.seekIn(twice, seeker, choices);
    if (choice > -1) {
      choices[choice].ability1(this);
      if (twice && choice2 > -1) {
        choices[choice2].ability1(this);
      } else if (seeker) {
        choices[choice].sought = true;
      }
    }
  }

  takeDamage(amount: number) {
    for (const card of [...this.deck.hand]) {
      if (card instanceof Action && card.data[9] === "cloudP") {
        if (this.cloudP(card)) {
          amount = Math.max(amount - parseInt(card.data[10], 10), 0);
          const idx = this.deck.hand.indexOf(card);
          if (idx !== -1) this.deck.hand.splice(idx, 1);
          this.deck.discard.push(card);
        }
      }
    }
    this.curHealth -= amount;
    if (amount > 0 && this.smoking) this.curHealth += 1;
    if (this.curHealth <= 0) this.alive = false;
  }

  // ── Special abilities ──

  private _isLowest(m: Mission): boolean {
    const ours = m.playerRanks[this.turnOrder];
    if (ours <= 0) return false;
    let someoneHigher = false;
    for (let i = 0; i < m.playerRanks.length; i++) {
      if (i === this.turnOrder) continue;
      const r = m.playerRanks[i];
      if (r > 0 && r <= ours) return false;
      if (r > ours) someoneHigher = true;
    }
    return someoneHigher;
  }

  private _isHighest(m: Mission): boolean {
    const ours = m.playerRanks[this.turnOrder];
    if (ours <= 0) return false;
    for (let i = 0; i < m.playerRanks.length; i++) {
      if (i === this.turnOrder) continue;
      if (m.playerRanks[i] >= ours && m.playerRanks[i] > 0) return false;
    }
    return true;
  }

  special1() { // Investigate: +1 money per mission you're lowest on
    const count = this.game.missions.filter((m) => this._isLowest(m)).length;
    this.money(count);
  }
  special2() { // Eavesdrop: advance 1 on every mission you're lowest on
    for (const m of this.game.missions) {
      if (this._isLowest(m)) m.progress(this.turnOrder, 1);
    }
  }
  special3() { // Lookout: draw per mission you're highest on
    const count = this.game.missions.filter((m) => this._isHighest(m)).length;
    this.draw(count);
  }
  special4() { // Hyperaware: +3 damage per mission you're highest on
    const count = this.game.missions.filter((m) => this._isHighest(m)).length;
    this.damage(count * 3);
  }
  special5() { // Coppercloud: draw 1 if lowest on any mission
    for (const m of this.game.missions) {
      if (this._isLowest(m)) { this.draw(1); return; }
    }
  }
  special6() { // House War tier 2: mission += damage, damage = 0
    this.curMission += this.curDamage;
    this.curDamage = 0;
  }
  special7() { // Dominate tier 2: damage += mission, mission = 0
    this.curDamage += this.curMission;
    this.curMission = 0;
  }
  special8() { // Subdue: gain a market card costing <= 5
    const choices = this.game.market.hand.filter((c) => c.cost <= 5);
    const choice = this.subdueIn(choices);
    if (choice === -1) return;
    this.deck.discard.push(choices[choice]);
    this.game.market.buy(choices[choice]);
  }
  special9() { // Soar: buy an eliminated card at or below money
    const choices = this.game.market.discard.filter((c) => c.cost <= this.curMoney);
    const choice = this.soarIn(choices);
    if (choice === -1) return;
    this.deck.discard.push(choices[choice]);
    const idx = this.game.market.discard.indexOf(choices[choice]);
    if (idx !== -1) this.game.market.discard.splice(idx, 1);
  }
  special10() { // Precise Shot: gain any eliminated card
    const choices = this.game.market.discard;
    const choice = this.soarIn(choices);
    if (choice === -1) return;
    this.deck.discard.push(choices[choice]);
    this.game.market.discard.splice(choice, 1);
  }
  special11() { // Maelstrom: kill all opponent allies + clear market
    for (const player of this.game.players) {
      if (player !== this) {
        for (const ally of [...player.allies]) {
          player.killAlly(ally);
        }
      }
    }
    while (this.game.market.hand.length > 0) {
      this.game.market.buy(this.game.market.hand[0]);
    }
  }
  special12() { // Confrontation 1: play first ability of an eliminated action
    const choices: Action[] = [];
    for (const card of this.game.market.discard) {
      // Skip Confrontation itself — its ability1 is special12, which would recurse
      if (card instanceof Action && card.name !== "Confrontation") choices.push(card);
    }
    if (choices.length === 0) return;
    const choice = this.confrontationIn(choices);
    if (choice === -1) return;
    choices[choice].ability1(this);
  }
  special13() { // Confrontation 2: instant victory
    this.game.victoryType = "C";
    this.game.winner = this;
  }
  special14() { // Informant: look at top of deck, optionally eliminate
    if (this.deck.cards.length > 0 && this.informantIn(this.deck.cards[0])) {
      this.game.market.discard.push(this.deck.cards[0]);
      this.deck.cards.shift();
    }
  }
  special15() { // Keeper: set aside a card from hand
    if (this.deck.hand.length === 0) return;
    const choices: Card[] = [];
    for (const c of this.deck.hand) {
      if (c instanceof Funding && this.curMoney < 1) continue;
      if (c instanceof Action && (c.burned || c.metalUsed > 0)) continue;
      choices.push(c);
    }
    if (choices.length === 0) return;
    const choice = this.keeperIn(choices);
    // keeperIn may return -1 (decline to set aside) or an out-of-range index
    if (choice < 0 || choice >= choices.length) return;
    const card = choices[choice];
    if (card instanceof Funding) this.curMoney -= 1;
    this.deck.setAside.push(card);
    const idx = this.deck.hand.indexOf(card);
    if (idx !== -1) this.deck.hand.splice(idx, 1);
  }
  special16() { // Seeker 2: play first ability of a sought market card
    const soughtCards = this.game.market.hand.filter((c) => c.sought);
    if (soughtCards.length > 0) {
      (soughtCards[0] as Action).ability1(this);
    }
  }

  // ── Metal token helpers ──

  resetToken(val: number): number {
    if (val === 1 || val === 3) return 0;
    if (val === 4) return 2;
    return val;
  }

  // ── Action generation ──

  availableActions(game: Game): GameActionInternal[] {
    const actions: GameActionInternal[] = [];
    let idx = 0;
    const isBurnSlotAvailable = () =>
      (this.metalTokens.slice(0, -1).filter((v) => v === 1).length + this.metalTokens[8]) < this.burns;

    actions.push({ type: "end_actions", index: idx++ });

    if (this.curMoney >= 2) {
      actions.push({ type: "buy_boxing", index: idx++ });
    }
    if (this.curBoxings > 0) {
      actions.push({ type: "use_boxing", index: idx++ });
    }

    // Mission advances
    if (this.curMission > 0) {
      for (const mission of game.missions) {
        if (mission.playerRanks[this.turnOrder] < 12) {
          actions.push({ type: "advance_mission", index: idx++, mission });
        }
      }
    }

    // Card actions (burn, refresh, use metal)
    for (const card of this.deck.hand) {
      if (card instanceof Funding) continue;
      const actionCard = card as Action;
      if (!actionCard.burned) {
        if (actionCard.metalUsed === 0) {
          if (actionCard.metal === 8) {
            // Atium cards can be burned as any metal
            for (let m = 0; m < 9; m++) {
              actions.push({ type: "burn_card", index: idx++, card: actionCard, metalIndex: m });
            }
          } else {
            const base = Math.floor(actionCard.metal / 2) * 2;
            actions.push({ type: "burn_card", index: idx++, card: actionCard, metalIndex: base });
            actions.push({ type: "burn_card", index: idx++, card: actionCard, metalIndex: base + 1 });
          }
          // Refresh options
          if (actionCard.metal === 8) {
            for (let i = 0; i < this.metalTokens.length; i++) {
              if (this.metalTokens[i] === 2 || this.metalTokens[i] === 4) {
                actions.push({ type: "refresh_metal", index: idx++, card: actionCard, metalIndex: i });
              }
            }
          } else {
            const base = Math.floor(actionCard.metal / 2) * 2;
            if (this.metalTokens[base] === 2 || this.metalTokens[base] === 4) {
              actions.push({ type: "refresh_metal", index: idx++, card: actionCard, metalIndex: base });
            }
            if (this.metalTokens[base + 1] === 2 || this.metalTokens[base + 1] === 4) {
              actions.push({ type: "refresh_metal", index: idx++, card: actionCard, metalIndex: base + 1 });
            }
          }
        }
        if (this.metalAvailable[actionCard.metal] && actionCard.metalUsed < actionCard.capacity) {
          actions.push({ type: "use_metal", index: idx++, card: actionCard });
        }
      }
    }

    // Burn/flare metal tokens
    for (let metal = 0; metal < this.metalTokens.length - 1; metal++) {
      if (this.metalTokens[metal] === 0) {
        if (isBurnSlotAvailable()) {
          actions.push({ type: "burn_metal", index: idx++, metalIndex: metal });
        } else {
          actions.push({ type: "flare_metal", index: idx++, metalIndex: metal });
        }
      }
    }
    // Atium token burn
    if (this.atium > 0 && isBurnSlotAvailable()) {
      actions.push({ type: "burn_metal", index: idx++, metalIndex: 8 });
    }

    // Buy from market
    for (const card of game.market.hand) {
      if (card.cost <= this.curMoney) {
        actions.push({ type: "buy", index: idx++, card });
        if (this.training >= 8 && this.charAbility2 &&
            (card instanceof Action || (card instanceof Ally && card.def.ability1Effect))) {
          actions.push({ type: "buy_eliminate", index: idx++, card });
        }
      }
    }

    // Ally abilities
    for (const ally of this.allies) {
      if (ally.available1 && this.metalBurned[ally.metal] > 0) {
        actions.push({ type: "ally_ability_1", index: idx++, card: ally });
      }
      if (ally.available2 && this.metalBurned[ally.metal] > 1) {
        actions.push({ type: "ally_ability_2", index: idx++, card: ally });
      }
    }

    // Character abilities
    if (this.charAbility1 && this.training >= 5 && this.metalBurned[parseInt(this.ability1metal)] > 0) {
      actions.push({ type: "char_ability_1", index: idx++ });
    }
    if (this.charAbility3 && this.training >= 13 && this.metalBurned[8] > 0) {
      actions.push({ type: "char_ability_3", index: idx++ });
    }

    // Atium as any metal
    if (this.atium > 0 && isBurnSlotAvailable()) {
      for (let i = 0; i < 9; i++) {
        actions.push({ type: "use_atium", index: idx++, metalIndex: i });
      }
    }

    // Buy with boxings
    for (const card of game.market.hand) {
      if (card.cost > this.curMoney && card.cost <= this.curMoney + this.curBoxings) {
        const boxingsCost = card.cost - this.curMoney;
        actions.push({ type: "buy_with_boxings", index: idx++, card, boxingsCost });
        if (this.training >= 8 && this.charAbility2 &&
            (card instanceof Action || (card instanceof Ally && card.def.ability1Effect))) {
          actions.push({ type: "buy_elim_boxings", index: idx++, card, boxingsCost });
        }
      }
    }

    return actions;
  }

  // ── Action execution ──

  performAction(action: GameActionInternal, game: Game) {
    // Track active card for self-elimination prevention
    if (action.type === "burn_card" || action.type === "use_metal") {
      this._active_card = "card" in action ? action.card : null;
    } else {
      this._active_card = null;
    }

    switch (action.type) {
      case "end_actions": {
        this.curBoxings += Math.floor(this.curMoney / 2);
        this.curMoney = 0;  // pMoney is applied at the start of the next turn instead
        this.curMission = 0;
        this.metalTokens = this.metalTokens.map((v) => this.resetToken(v));
        this.metalTokens[8] = 0;
        this.metalAvailable = new Array(9).fill(0);
        this.metalBurned = new Array(9).fill(0);
        this.charAbility1 = true;
        this.charAbility2 = true;
        this.charAbility3 = true;
        this.deck.cleanUp(this, game.market);
        for (const ally of this.allies) ally.reset();
        break;
      }
      case "advance_mission": {
        const sense = game.senseCheck(this);
        if (sense > 0) {
          this.curMission -= sense;
        } else {
          this.curMission -= 1;
          action.mission.progress(this.turnOrder, 1);
        }
        break;
      }
      case "burn_card": {
        action.card.burn(this);
        this.metalAvailable[action.metalIndex] += 1;
        this.metalBurned[action.metalIndex] += 1;
        if (action.card.metal === 8 && action.metalIndex !== 8) {
          this.metalBurned[8] += 1;
        }
        break;
      }
      case "refresh_metal": {
        const idx = this.deck.hand.indexOf(action.card);
        if (idx !== -1) this.deck.hand.splice(idx, 1);
        this.deck.discard.push(action.card);
        if (this.metalTokens[action.metalIndex] === 4) {
          this.metalTokens[action.metalIndex] = 3;
        } else {
          this.metalTokens[action.metalIndex] = 0;
        }
        break;
      }
      case "use_metal": {
        const card = action.card as Action;
        if (this.metalAvailable[card.metal] > 0) {
          this.metalAvailable[card.metal] -= 1;
          card.addMetal(this);
        } else if (this.metalAvailable[8]) {
          this.metalAvailable[8] -= 1;
          this.metalBurned[card.metal] += 1;
          card.addMetal(this);
        }
        break;
      }
      case "burn_metal": {
        const mi = action.metalIndex;
        if (mi === 8) {
          this.metalTokens[8] += 1;
          this.atium -= 1;
        } else {
          this.metalTokens[mi] = 1; // burned
        }
        this.metalAvailable[mi] += 1;
        this.metalBurned[mi] += 1;
        break;
      }
      case "flare_metal": {
        const mi = action.metalIndex;
        this.metalTokens[mi] = 4; // flared
        this.metalAvailable[mi] += 1;
        this.metalBurned[mi] += 1;
        break;
      }
      case "buy": {
        this.curMoney -= action.card.cost;
        this.deck.discard.push(action.card);
        game.market.buy(action.card);
        break;
      }
      case "buy_eliminate": {
        this.curMoney -= action.card.cost;
        this.charAbility2 = false;
        game.market.discard.push(action.card);
        game.market.buy(action.card);
        (action.card as Action).ability1(this);
        break;
      }
      case "ally_ability_1": {
        (action.card as Ally).ability1(this);
        break;
      }
      case "ally_ability_2": {
        (action.card as Ally).ability2(this);
        break;
      }
      case "char_ability_1": {
        this.resolve(this.ability1effect, this.ability1amount);
        this.charAbility1 = false;
        break;
      }
      case "char_ability_3": {
        this.resolve("D.Mi", "3.3");
        this.charAbility3 = false;
        break;
      }
      case "use_atium": {
        const mi = action.metalIndex;
        this.metalAvailable[mi] += 1;
        this.metalBurned[mi] += 1;
        if (mi !== 8) this.metalBurned[8] += 1;
        this.atium -= 1;
        break;
      }
      case "buy_with_boxings": {
        this.curMoney = 0;
        this.curBoxings -= action.boxingsCost;
        this.deck.discard.push(action.card);
        game.market.buy(action.card);
        break;
      }
      case "buy_elim_boxings": {
        this.curMoney = 0;
        this.curBoxings -= action.boxingsCost;
        this.charAbility2 = false;
        game.market.discard.push(action.card);
        game.market.buy(action.card);
        (action.card as Action).ability1(this);
        break;
      }
      case "buy_boxing": {
        this.curMoney -= 2;
        this.curBoxings += 1;
        break;
      }
      case "use_boxing": {
        this.curBoxings -= 1;
        this.curMoney += 1;
        break;
      }
    }
  }

  // ── Clone ──

  /** Deep-clone this player for lookahead simulation. Caller must pass the
   *  cloned game, the cloned deck, and a cardMap populated by prior clones
   *  (market + other players' decks) so ally references resolve correctly. */
  clone(newGame: Game, newDeck: PlayerDeck, cardMap: Map<number, Card>): Player {
    const p = new (this.constructor as new (
      deck: PlayerDeck, game: Game, turnOrder: number, name?: string, character?: string
    ) => Player)(newDeck, newGame, this.turnOrder, this.name, this.character);
    copyPlayerState(p, this, cardMap);
    return p;
  }

  // ── Serialization ──

  serializeAction(action: GameActionInternal, _game: Game): SerializedGameAction {
    const code = ACTION_TYPE_TO_CODE[action.type];

    switch (action.type) {
      case "end_actions":
        return { type: action.type, code, index: action.index, description: "End actions (move to damage phase)" };
      case "advance_mission":
        return { type: action.type, code, index: action.index, description: `Advance mission ${action.mission.name}`, missionName: action.mission.name };
      case "burn_card":
        return { type: action.type, code, index: action.index, description: `Burn ${action.card.name} for ${METAL_NAMES[action.metalIndex]}`, cardId: action.card.id, metalIndex: action.metalIndex };
      case "refresh_metal":
        return { type: action.type, code, index: action.index, description: `Use ${action.card.name} to refresh ${METAL_NAMES[action.metalIndex]}`, cardId: action.card.id, metalIndex: action.metalIndex };
      case "use_metal":
        return { type: action.type, code, index: action.index, description: `Put metal towards abilities of ${action.card.name}`, cardId: action.card.id };
      case "burn_metal":
        return { type: action.type, code, index: action.index, description: `Burn ${METAL_NAMES[action.metalIndex]}`, metalIndex: action.metalIndex };
      case "flare_metal":
        return { type: action.type, code, index: action.index, description: `Flare ${METAL_NAMES[action.metalIndex]}`, metalIndex: action.metalIndex };
      case "buy":
        return { type: action.type, code, index: action.index, description: `Buy ${action.card.name}`, cardId: action.card.id };
      case "buy_eliminate":
        return { type: action.type, code, index: action.index, description: `Buy ${action.card.name} and eliminate (use first ability)`, cardId: action.card.id };
      case "ally_ability_1":
        return { type: action.type, code, index: action.index, description: `Use first ability of ally ${action.card.name}`, cardId: action.card.id };
      case "ally_ability_2":
        return { type: action.type, code, index: action.index, description: `Use second ability of ally ${action.card.name}`, cardId: action.card.id };
      case "char_ability_1":
        return { type: action.type, code, index: action.index, description: "Use first character ability" };
      case "char_ability_3":
        return { type: action.type, code, index: action.index, description: "Use third character ability" };
      case "use_atium":
        return { type: action.type, code, index: action.index, description: `Use atium token for ${METAL_NAMES[action.metalIndex]}`, metalIndex: action.metalIndex };
      case "buy_with_boxings":
        return { type: action.type, code, index: action.index, description: `Buy ${action.card.name} using all money and ${action.boxingsCost} boxings`, cardId: action.card.id, boxingsCost: action.boxingsCost };
      case "buy_elim_boxings":
        return { type: action.type, code, index: action.index, description: `Buy ${action.card.name} using all money and ${action.boxingsCost} boxings and eliminate`, cardId: action.card.id, boxingsCost: action.boxingsCost };
      case "buy_boxing":
        return { type: action.type, code, index: action.index, description: "Buy a boxing (2 money → 1 boxing)" };
      case "use_boxing":
        return { type: action.type, code, index: action.index, description: "Use a boxing (1 boxing → 1 money)" };
    }
  }

  serializeActions(game: Game): [SerializedGameAction[], GameActionInternal[]] {
    const actions = this.availableActions(game);
    const serialized = actions.map((a, i) => {
      a.index = i;
      const s = this.serializeAction(a, game);
      s.code = ACTION_TYPE_TO_CODE[s.type];
      return s;
    });
    return [serialized, actions];
  }

  // ── State serialization ──

  toJSON(revealHand = true, revealDeck = false) {
    return {
      name: this.name,
      character: this.character,
      turnOrder: this.turnOrder,
      alive: this.alive,
      health: this.curHealth,
      damage: this.curDamage,
      money: this.curMoney,
      mission: this.curMission,
      boxings: this.curBoxings,
      hand: revealHand ? this.deck.hand.map((c) => c.toJSON()) : [],
      handSize: this.deck.hand.length,
      deckSize: this.deck.cards.length,
      discardSize: this.deck.discard.length,
      discard: revealHand ? this.deck.discard.map((c) => c.toJSON()) : [],
      deck: revealDeck ? this.deck.cards.map((c) => c.toJSON()) : [],
      allies: this.allies.map((a) => a.toJSON()),
      metalTokens: [...this.metalTokens],
      metalAvailable: [...this.metalAvailable],
      metalBurned: [...this.metalBurned],
      metalNames: [...METAL_NAMES],
      burns: this.burns,
      atium: this.atium,
      training: this.training,
      maxHandSize: this.handSize,
      pDamage: this.pDamage,
      pMoney: this.pMoney,
      charAbility1: this.charAbility1,
      charAbility2: this.charAbility2,
      charAbility3: this.charAbility3,
      ability1metal: this.ability1metal,
      ability1effect: this.ability1effect,
      ability1amount: this.ability1amount,
    };
  }
}
