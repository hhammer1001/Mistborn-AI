const P = "/cards/httpssteamusercontentaakamaihdnetugc";

// ── Sprite sheet definitions ───────────────────────────────────────────────

interface Sheet {
  src: string;
  cols: number;
  rows: number;
  w: number;
  h: number;
}

const MISSIONS_SHEET: Sheet = {
  src: "/cards/Missions.jpg",
  cols: 4, rows: 2, w: 8826, h: 7543,
};
const CREW_SHEET: Sheet = {
  src: `${P}10307375962418354840C29207AC69F8AA63CF05D2C21F6DD4C08D8207E9.jpg`,
  cols: 10, rows: 3, w: 7680, h: 3212,
};
const DECK_SHEET: Sheet = {
  src: `${P}13135413059729423061344DC892AC987C52EB68024EB7CB51612AAEA7C8.jpg`,
  cols: 10, rows: 5, w: 7680, h: 5365,
};
const TRAIN_SHEET: Sheet = {
  src: `${P}115369065496175734263557006D91E26EC106890A39303332327D47F4DB.jpg`,
  cols: 5, rows: 4, w: 6517, h: 7244,
};

// ── Card data ──────────────────────────────────────────────────────────────

interface Sprite { name: string; sheet: Sheet; col: number; row: number }
interface Single { name: string; src: string }

const HEROES: Single[] = [
  { name: "Kelsier — The Survivor",  src: `${P}96933575893836348543557D24AEEE1F012C3CAD29954EF6814E760FC9D.jpg` },
  { name: "Vin — The Warrior",       src: `${P}1345520488082639487110C19C4ACDC3BB4A6DED9A5BF2E459BE380AC1E6.jpg` },
  { name: "Marsh — The Spy",         src: `${P}109539518916106846249A7A17D9C6BE1C03FF4CA5B6C5F9A8955B0722D3.jpg` },
  { name: "Shan — The Noble",        src: `${P}175380882799496743833A2ED5F67A4F055DBA77817F4E1E3182320AC66E.jpg` },
  { name: "Vin — The Prodigy",       src: "/cards/Vin%20Prodigy%20copy.png" },
];

const MISSIONS: Sprite[] = [
  { name: "Canton of Orthodoxy", sheet: MISSIONS_SHEET, col: 0, row: 0 },
  { name: "Skaa Caverns",       sheet: MISSIONS_SHEET, col: 1, row: 0 },
  { name: "Pits of Hathsin",    sheet: MISSIONS_SHEET, col: 2, row: 0 },
  { name: "Luthadel Rooftops",  sheet: MISSIONS_SHEET, col: 3, row: 0 },
  { name: "Luthadel Garrison",  sheet: MISSIONS_SHEET, col: 0, row: 1 },
  { name: "Kredik Shaw",        sheet: MISSIONS_SHEET, col: 1, row: 1 },
  { name: "Keep Venture",       sheet: MISSIONS_SHEET, col: 2, row: 1 },
  { name: "Crew Hideout",       sheet: MISSIONS_SHEET, col: 3, row: 1 },
];

// Metal tokens (flat style)
const TOKEN: Record<string, string> = {
  Pewter:  `${P}1598958658154238427236780A0304448BC99EA15AC1380D7C5859F2DCB2.png`,
  Tin:     `${P}154097187689763098126B8DD89DB7D785E635727C62C6B7ED4B94AD5220.png`,
  Bronze:  `${P}150373823894300107515DB97B7388642C6F7E3EBE7350C6AFC082EC9E9D.png`,
  Copper:  `${P}10692479332250892161C17C084A256B625D2040EDAE850A94F5806F2734.png`,
  Zinc:    `${P}17724904315381067032F672C60E78C09702585114D12742803DEFE9D902.png`,
  Brass:   `${P}1124839757447266920854A8646844E3B53192217D4607377F4DCF3BAE4C.png`,
  Iron:    `${P}1303750385876009098596698E744BE69E17D972553284565DEBA68A5EC9.png`,
  Steel:   `${P}164351476684827681864E9FED63C006D386B77AAD24F31727F6A70DA722.png`,
};

// ── Verified ally positions (10×3 grid, cards rotated 90° CW in sheet) ─────

interface MetalSection {
  metal: string;
  allies: Sprite[];
  actions: Sprite[];
}

const METAL_SECTIONS: MetalSection[] = [
  {
    metal: "No Metal",
    allies: [
      { name: "Noble",       sheet: CREW_SHEET, col: 3, row: 0 },
      { name: "Hazekillers", sheet: CREW_SHEET, col: 4, row: 1 },
      { name: "Crewleader",  sheet: CREW_SHEET, col: 5, row: 1 },
    ],
    actions: [],
  },
  {
    metal: "Pewter",
    allies: [
      { name: "Soldier",   sheet: CREW_SHEET, col: 7, row: 1 },
      { name: "Pewterarm", sheet: CREW_SHEET, col: 1, row: 0 },
    ],
    actions: [
      { name: "Recover",       sheet: DECK_SHEET, col: 3, row: 1 },
      { name: "Strike",        sheet: DECK_SHEET, col: 4, row: 0 },
      { name: "Brawl",         sheet: DECK_SHEET, col: 4, row: 3 },
      { name: "Survive",       sheet: DECK_SHEET, col: 2, row: 0 },
      { name: "Crushing Blow", sheet: DECK_SHEET, col: 9, row: 3 },
    ],
  },
  {
    metal: "Tin",
    allies: [
      { name: "Houselord", sheet: CREW_SHEET, col: 3, row: 1 },
      { name: "Tineye",    sheet: CREW_SHEET, col: 9, row: 1 },
    ],
    actions: [
      { name: "Investigate", sheet: DECK_SHEET, col: 2, row: 2 },
      { name: "Eavesdrop",   sheet: DECK_SHEET, col: 1, row: 4 },
      { name: "Lookout",     sheet: DECK_SHEET, col: 0, row: 2 },
      { name: "Spy",         sheet: DECK_SHEET, col: 7, row: 0 },
      { name: "Hyperaware",  sheet: DECK_SHEET, col: 6, row: 2 },
    ],
  },
  {
    metal: "Bronze",
    allies: [
      { name: "Obligator", sheet: CREW_SHEET, col: 2, row: 0 },
      { name: "Seeker",    sheet: CREW_SHEET, col: 0, row: 2 },
    ],
    actions: [
      { name: "Hunt",       sheet: DECK_SHEET, col: 7, row: 2 },
      { name: "Pursue",     sheet: DECK_SHEET, col: 4, row: 1 },
      { name: "Infiltrate", sheet: DECK_SHEET, col: 5, row: 2 },
      { name: "Unveil",     sheet: DECK_SHEET, col: 0, row: 0 },
      { name: "Pierce",     sheet: DECK_SHEET, col: 7, row: 1 },
    ],
  },
  {
    metal: "Copper",
    allies: [
      { name: "Keeper", sheet: CREW_SHEET, col: 6, row: 0 },
      { name: "Smoker", sheet: CREW_SHEET, col: 9, row: 0 },
    ],
    actions: [
      { name: "Coppercloud",     sheet: DECK_SHEET, col: 7, row: 3 },
      { name: "Sneak",           sheet: DECK_SHEET, col: 9, row: 0 },
      { name: "Hide",            sheet: DECK_SHEET, col: 9, row: 2 },
      { name: "Train In Secret", sheet: DECK_SHEET, col: 1, row: 0 },
      { name: "Strategize",      sheet: DECK_SHEET, col: 5, row: 0 },
    ],
  },
  {
    metal: "Zinc",
    allies: [
      { name: "Rebel",  sheet: CREW_SHEET, col: 0, row: 0 },
      { name: "Rioter", sheet: CREW_SHEET, col: 8, row: 0 },
    ],
    actions: [
      { name: "Enrage",     sheet: DECK_SHEET, col: 0, row: 4 },
      { name: "Charm",      sheet: DECK_SHEET, col: 5, row: 3 },
      { name: "Inspire",    sheet: DECK_SHEET, col: 4, row: 2 },
      { name: "Intimidate", sheet: DECK_SHEET, col: 3, row: 2 },
      { name: "House War",  sheet: DECK_SHEET, col: 8, row: 2 },
    ],
  },
  {
    metal: "Brass",
    allies: [
      { name: "Informant", sheet: CREW_SHEET, col: 2, row: 1 },
      { name: "Soother",   sheet: CREW_SHEET, col: 8, row: 1 },
    ],
    actions: [
      { name: "Con",      sheet: DECK_SHEET, col: 0, row: 3 },
      { name: "Subdue",   sheet: DECK_SHEET, col: 3, row: 0 },
      { name: "Deceive",  sheet: DECK_SHEET, col: 3, row: 4 },
      { name: "Pacify",   sheet: DECK_SHEET, col: 8, row: 1 },
      { name: "Dominate", sheet: DECK_SHEET, col: 2, row: 4 },
    ],
  },
  {
    metal: "Iron",
    allies: [
      { name: "Pickpocket", sheet: CREW_SHEET, col: 0, row: 1 },
      { name: "Lurcher",    sheet: CREW_SHEET, col: 5, row: 0 },
    ],
    actions: [
      { name: "Ironpull",   sheet: DECK_SHEET, col: 1, row: 2 },
      { name: "Reposition", sheet: DECK_SHEET, col: 2, row: 1 },
      { name: "Crash",      sheet: DECK_SHEET, col: 8, row: 3 },
      { name: "Rescue",     sheet: DECK_SHEET, col: 1, row: 1 },
      { name: "Ascendant",  sheet: DECK_SHEET, col: 1, row: 3 },
    ],
  },
  {
    metal: "Steel",
    allies: [
      { name: "Mercenary", sheet: CREW_SHEET, col: 4, row: 0 },
      { name: "Coinshot",  sheet: CREW_SHEET, col: 6, row: 1 },
    ],
    actions: [
      { name: "Soar",         sheet: DECK_SHEET, col: 8, row: 0 },
      { name: "Assassinate",  sheet: DECK_SHEET, col: 2, row: 3 },
      { name: "Precise Shot", sheet: DECK_SHEET, col: 6, row: 1 },
      { name: "Steelpush",    sheet: DECK_SHEET, col: 6, row: 0 },
      { name: "Maelstrom",    sheet: DECK_SHEET, col: 9, row: 1 },
    ],
  },
  {
    metal: "Atium",
    allies: [
      { name: "Kandra",     sheet: CREW_SHEET, col: 7, row: 0 },
      { name: "Inquisitor", sheet: CREW_SHEET, col: 1, row: 1 },
    ],
    actions: [
      { name: "Balance",       sheet: DECK_SHEET, col: 3, row: 3 },
      { name: "Preserve",      sheet: DECK_SHEET, col: 5, row: 1 },
      { name: "Ruin",          sheet: DECK_SHEET, col: 0, row: 1 },
      { name: "Confrontation", sheet: DECK_SHEET, col: 6, row: 3 },
    ],
  },
];

// ── Training card positions (5×4 grid, upright) ────────────────────────────

const TRAINING: Record<string, Sprite> = {
  "Zinc Training":   { name: "Zinc Training",   sheet: TRAIN_SHEET, col: 0, row: 0 },
  "Tin Training":    { name: "Tin Training",     sheet: TRAIN_SHEET, col: 1, row: 0 },
  "Copper Training": { name: "Copper Training",  sheet: TRAIN_SHEET, col: 2, row: 0 },
  "Steel Training":  { name: "Steel Training",   sheet: TRAIN_SHEET, col: 3, row: 0 },
  "Bronze Training": { name: "Bronze Training",  sheet: TRAIN_SHEET, col: 0, row: 1 },
  "Iron Training":   { name: "Iron Training",    sheet: TRAIN_SHEET, col: 1, row: 1 },
  "Brass Training":  { name: "Brass Training",   sheet: TRAIN_SHEET, col: 2, row: 1 },
  "Pewter Training": { name: "Pewter Training",  sheet: TRAIN_SHEET, col: 3, row: 1 },
};

const FUNDING: Sprite = { name: "Funding", sheet: TRAIN_SHEET, col: 4, row: 0 };

// Starter deck assignments (from engine/deck.py)
const STARTER_DECKS = [
  {
    label: "Kelsier & Shan",
    training: ["Tin Training", "Copper Training", "Zinc Training", "Steel Training"],
  },
  {
    label: "Vin, Marsh & Prodigy",
    training: ["Pewter Training", "Bronze Training", "Brass Training", "Iron Training"],
  },
];

// ── Rendering helpers ──────────────────────────────────────────────────────

/** Standard upright sprite card */
function SpriteCard({ card, displayWidth }: { card: Sprite; displayWidth: number }) {
  const cw = card.sheet.w / card.sheet.cols;
  const ch = card.sheet.h / card.sheet.rows;
  // Trim: a bit on left/bottom, more on top/right
  const trimL = cw * 0.006;
  const trimR = cw * 0.007;
  const trimT = ch * 0.004;
  const trimB = ch * 0.004;
  const cwTrimmed = cw - trimL - trimR;
  const chTrimmed = ch - trimT - trimB;
  const scale = displayWidth / cwTrimmed;
  return (
    <div className="gallery-item">
      <div
        className="gallery-sprite"
        style={{
          width: displayWidth,
          height: chTrimmed * scale,
          backgroundImage: `url(${card.sheet.src})`,
          backgroundSize: `${card.sheet.w * scale}px ${card.sheet.h * scale}px`,
          backgroundPosition: `-${(card.col * cw + trimL) * scale}px -${(card.row * ch + trimT) * scale}px`,
        }}
      />
      <span className="gallery-label">{card.name}</span>
    </div>
  );
}

/** Ally sprite card — rotated 90° CW in the sheet, displayed landscape */
function RotatedSpriteCard({ card, displayWidth }: { card: Sprite; displayWidth: number }) {
  const cw = card.sheet.w / card.sheet.cols;   // 768 (portrait width in sheet)
  const ch = card.sheet.h / card.sheet.rows;   // ~1070 (portrait height in sheet)
  // Trim a tiny bit off all edges (in portrait orientation)
  const inset = ch * 0.008;  // ~0.8% uniform inset
  const trimBottom = ch * 0.008;  // extra trim on bottom (= right side after rotation)
  const cwTrimmed = cw - inset * 2;
  const chTrimmed = ch - inset - (inset + trimBottom);
  // After -90° rotation, the card is landscape: chTrimmed wide × cwTrimmed tall
  const scale = displayWidth / chTrimmed;
  const displayH = cwTrimmed * scale;
  const spriteW = cwTrimmed * scale;
  const spriteH = chTrimmed * scale;
  return (
    <div className="gallery-item">
      <div style={{
        width: displayWidth,
        height: displayH,
        position: "relative",
        overflow: "hidden",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}>
        <div style={{
          width: spriteW,
          height: spriteH,
          backgroundImage: `url(${card.sheet.src})`,
          backgroundSize: `${card.sheet.w * scale}px ${card.sheet.h * scale}px`,
          backgroundPosition: `-${(card.col * cw + inset) * scale}px -${(card.row * ch + inset) * scale}px`,
          backgroundRepeat: "no-repeat",
          transform: "rotate(-90deg)",
          transformOrigin: "top left",
          position: "absolute",
          top: displayH,
          left: 0,
        }} />
      </div>
      <span className="gallery-label">{card.name}</span>
    </div>
  );
}

function ImageCard({ card, width }: { card: Single; width: number }) {
  return (
    <div className="gallery-item">
      <img
        className="gallery-img"
        src={card.src}
        alt={card.name}
        style={{ width, height: "auto" }}
      />
      <span className="gallery-label">{card.name}</span>
    </div>
  );
}

// ── Main gallery component ─────────────────────────────────────────────────

export function CardGallery({ onBack }: { onBack: () => void }) {
  return (
    <div className="card-gallery">
      <div className="gallery-header">
        <button className="gallery-back-btn" onClick={onBack}>← Back to Menu</button>
        <h1>Card Gallery</h1>
      </div>

      {/* Heroes */}
      <section className="gallery-section">
        <h2>Heroes</h2>
        <div className="gallery-grid">
          {HEROES.map((h) => (
            <ImageCard key={h.name} card={h} width={280} />
          ))}
        </div>
      </section>

      {/* Missions */}
      <section className="gallery-section">
        <h2>Missions</h2>
        <div className="gallery-grid">
          {MISSIONS.map((m) => (
            <SpriteCard key={m.name} card={m} displayWidth={160} />
          ))}
        </div>
      </section>

      {/* Allies & Actions by Metal */}
      {METAL_SECTIONS.map((ms) => (
        <section key={ms.metal} className="gallery-section gallery-metal-section">
          <h2>
            {TOKEN[ms.metal] && (
              <img className="gallery-token" src={TOKEN[ms.metal]} alt={ms.metal} />
            )}
            {ms.metal}
          </h2>

          {ms.allies.length > 0 && (
            <>
              <h3>Allies</h3>
              <div className="gallery-grid">
                {ms.allies.map((a) => (
                  <RotatedSpriteCard key={a.name} card={a} displayWidth={190} />
                ))}
              </div>
            </>
          )}

          {ms.actions.length > 0 && (
            <>
              <h3>Actions</h3>
              <div className="gallery-grid">
                {ms.actions.map((a) => (
                  <SpriteCard key={a.name} card={a} displayWidth={140} />
                ))}
              </div>
            </>
          )}
        </section>
      ))}

      {/* Starter Decks */}
      <section className="gallery-section">
        <h2>Starter Decks</h2>
        {STARTER_DECKS.map((sd) => (
          <div key={sd.label} className="gallery-starter">
            <h3>{sd.label}</h3>
            <div className="gallery-grid">
              <SpriteCard card={{ ...FUNDING, name: "Funding ×6" }} displayWidth={110} />
              {sd.training.map((t) => (
                <SpriteCard key={t} card={TRAINING[t]} displayWidth={110} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
