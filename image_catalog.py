"""
Catalog and splitter for Mistborn card game images.

All images live in the Images/ directory. This module:
  - Labels every image by type and content
  - For batched grid images, defines the grid layout so individual cards
    can be extracted via crop coordinates
  - Provides extract_card() and extract_all_cards() helpers
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from PIL import Image

IMAGES_DIR = Path(__file__).parent / "Images"

# ── Short aliases for the unwieldy Steam filenames ──────────────────────────

_S = "httpssteamusercontentaakamaihdnetugc"  # common prefix


def _steam(suffix: str) -> str:
    return f"{_S}{suffix}"


# ── Data classes ────────────────────────────────────────────────────────────


@dataclass
class CardRegion:
    """A single card's location within a batched image."""
    label: str
    col: int
    row: int
    x: int
    y: int
    width: int
    height: int

    @property
    def box(self) -> tuple[int, int, int, int]:
        """PIL crop box (left, upper, right, lower)."""
        return (self.x, self.y, self.x + self.width, self.y + self.height)


@dataclass
class ImageEntry:
    """Metadata for a single image file."""
    filename: str
    category: str          # "metal_token", "hero_card", "card_back", "icon", "batch_grid", "reference"
    label: str             # human-readable name
    sublabel: str = ""     # e.g. "flat" vs "ringed" style for tokens
    grid: Optional[tuple[int, int]] = None  # (cols, rows) if this is a batch
    cards: list[CardRegion] = field(default_factory=list)
    notes: str = ""


# ── Individual metal tokens (288x288 or 256x256) ───────────────────────────
# Two art styles per metal: "flat" (no border ring) and "ringed" (black rim)

METAL_TOKENS: list[ImageEntry] = [
    # Flat style
    ImageEntry(_steam("10692479332250892161C17C084A256B625D2040EDAE850A94F5806F2734.png"),
               "metal_token", "Copper", "flat"),
    ImageEntry(_steam("1124839757447266920854A8646844E3B53192217D4607377F4DCF3BAE4C.png"),
               "metal_token", "Brass", "flat"),
    ImageEntry(_steam("1303750385876009098596698E744BE69E17D972553284565DEBA68A5EC9.png"),
               "metal_token", "Iron", "flat"),
    ImageEntry(_steam("150373823894300107515DB97B7388642C6F7E3EBE7350C6AFC082EC9E9D.png"),
               "metal_token", "Bronze", "flat"),
    ImageEntry(_steam("1598958658154238427236780A0304448BC99EA15AC1380D7C5859F2DCB2.png"),
               "metal_token", "Pewter", "flat"),
    ImageEntry(_steam("164351476684827681864E9FED63C006D386B77AAD24F31727F6A70DA722.png"),
               "metal_token", "Steel", "flat"),
    ImageEntry(_steam("17724904315381067032F672C60E78C09702585114D12742803DEFE9D902.png"),
               "metal_token", "Zinc", "flat"),
    ImageEntry(_steam("154097187689763098126B8DD89DB7D785E635727C62C6B7ED4B94AD5220.png"),
               "metal_token", "Tin", "flat"),

    # Ringed style (black border)
    ImageEntry(_steam("101902480597744182486AE2711C2E965B4CCEB4F8FDA15ED0429635CFAF.png"),
               "metal_token", "Bronze", "ringed"),
    ImageEntry(_steam("11806335712946964000A44B95674F45246E333A53C5E918746C02AE9F9B.png"),
               "metal_token", "Brass", "ringed"),
    ImageEntry(_steam("1637873565214040644002CBF1CC74E3643D1365B820DF70F468FC6ABA7E.png"),
               "metal_token", "Pewter", "ringed"),
    ImageEntry(_steam("16597811636567368277B5796D7B718C2504BB78ED586AD54CC03B6A65F9.png"),
               "metal_token", "Copper", "ringed"),
    ImageEntry(_steam("170368720702519769598E2F346C2742BAA72559EF4DAEA7FB83E103E139.png"),
               "metal_token", "Zinc", "ringed"),
    ImageEntry(_steam("1704881107112737333888C9C77EDF9C43F60445F9051BCDE3935ECEF56D.png"),
               "metal_token", "Iron", "ringed"),
    ImageEntry(_steam("174524143667332688473B0EEB1BE9AB1CD989B351216750B8F0135CCDE0.png"),
               "metal_token", "Tin", "ringed"),
    ImageEntry(_steam("94284474843701516508DF4B15AAF7E7B006590C3DF66304E1FE33AD043.png"),
               "metal_token", "Steel", "ringed"),
]

# ── Hero cards (1892x1092, landscape, individual) ──────────────────────────

HERO_CARDS: list[ImageEntry] = [
    ImageEntry(_steam("96933575893836348543557D24AEEE1F012C3CAD29954EF6814E760FC9D.jpg"),
               "hero_card", "Kelsier - The Survivor", notes="Steel / Atium"),
    ImageEntry(_steam("1345520488082639487110C19C4ACDC3BB4A6DED9A5BF2E459BE380AC1E6.jpg"),
               "hero_card", "Vin - The Warrior", notes="Pewter / Atium"),
    ImageEntry(_steam("109539518916106846249A7A17D9C6BE1C03FF4CA5B6C5F9A8955B0722D3.jpg"),
               "hero_card", "Marsh - The Spy", notes="Bronze / Atium"),
    ImageEntry(_steam("175380882799496743833A2ED5F67A4F055DBA77817F4E1E3182320AC66E.jpg"),
               "hero_card", "Shan - The Noble", notes="Zinc / Atium"),
    ImageEntry("Vin Prodigy copy.png",
               "hero_card", "Vin - The Prodigy", notes="Brass / Atium"),
]

# ── Card backs & reference art ──────────────────────────────────────────────

CARD_BACKS: list[ImageEntry] = [
    ImageEntry(_steam("11291666620697414189897F3C03797E6D59AD56E39143746877B51C7B60.jpg"),
               "card_back", "Allomantic Wheel - Landscape"),
    ImageEntry(_steam("12546146140478435680BB74716AC001E390C114E303DE3A05541293F04C.jpg"),
               "card_back", "Allomantic Wheel - Portrait"),
    ImageEntry(_steam("18333770475773332171DC2EF7CE4E6B762F0ED18EB98EB4D3A92ACB3B80.jpg"),
               "card_back", "Allomantic Wheel - Gold Center"),
]

ICONS: list[ImageEntry] = [
    ImageEntry(_steam("11054541884187123151C26FFB48D8813FB848414BFD3EE00C2DBB4D3091.jpg"),
               "icon", "Eliminate (Red X)"),
    ImageEntry(_steam("16643112729620038269AFB2FEA0E65C7552A48370B8ED8BA4B29818E574.png"),
               "icon", "Gold Coin (1)"),
    ImageEntry(_steam("173759646445244310512A09A2CECDC158B3A8790A585CFBBA368314228B.png"),
               "icon", "Allomantic Compass"),
]

REFERENCE: list[ImageEntry] = [
    ImageEntry(_steam("13128880221722747986DE201B2C43E682175ED52BCBDB643C9194511DCF.png"),
               "reference", "Metal Reference Strip",
               notes="Pewter, Tin, Bronze, Copper, Zinc, Brass, Iron, Steel with descriptions"),
]


# ── Batched grid images ────────────────────────────────────────────────────
# Each defines the grid layout and the labels for every card position.
# Cards are listed left-to-right, top-to-bottom.  Empty slots use None.

def _build_grid_cards(
    labels: list[Optional[str]],
    cols: int,
    img_width: int,
    img_height: int,
    rows: Optional[int] = None,
) -> list[CardRegion]:
    """Compute crop regions for a uniform grid of cards."""
    if rows is None:
        rows = (len(labels) + cols - 1) // cols
    cell_w = img_width // cols
    cell_h = img_height // rows
    cards = []
    for i, label in enumerate(labels):
        if label is None:
            continue
        c = i % cols
        r = i // cols
        cards.append(CardRegion(
            label=label,
            col=c,
            row=r,
            x=c * cell_w,
            y=r * cell_h,
            width=cell_w,
            height=cell_h,
        ))
    return cards


# 1) Missions.jpg — 8826x7543, 4 cols × 2 rows = 8 mission cards
_mission_labels = [
    "Canton of Orthodoxy", "Skaa Caverns", "Pits of Hathsin", "Luthadel Rooftops",
    "Luthadel Garrison", "Kredik Shaw", "Keep Venture", "Crew Hideout",
]
MISSIONS = ImageEntry(
    "Missions.jpg", "batch_grid", "Mission / Location Cards",
    grid=(4, 2),
    cards=_build_grid_cards(_mission_labels, cols=4, img_width=8826, img_height=7543, rows=2),
)

# 2) Crew/ally cards — 7680x3212, 10 cols × 3 rows (cards rotated 90° CW)
# Positions verified by visual inspection of each cell.
_crew_labels = [
    # Row 0
    "Rebel", "Pewterarm", "Obligator", "Noble", "Mercenary", "Lurcher", "Keeper", "Kandra", "Rioter", "Smoker",
    # Row 1
    "Pickpocket", "Inquisitor", "Informant", "Houselord", "Hazekillers", "Crewleader", "Coinshot", "Soldier", "Soother", "Tineye",
    # Row 2
    "Seeker",
    None, None, None, None, None, None, None, None, None,
]
CREW_CARDS = ImageEntry(
    _steam("10307375962418354840C29207AC69F8AA63CF05D2C21F6DD4C08D8207E9.jpg"),
    "batch_grid", "Crew / Ally Cards",
    grid=(10, 3),
    cards=_build_grid_cards(_crew_labels, cols=10, img_width=7680, img_height=3212, rows=3),
    notes="Cards are rotated 90° CW in the sprite sheet",
)

# 3) Starter deck cards — 6517x7244, 5 cols × 4 rows
# Positions verified by visual inspection.
_training_labels = [
    # Row 0
    "Zinc Training", "Tin Training", "Copper Training", "Steel Training", "Funding",
    # Row 1
    "Bronze Training", "Iron Training", "Brass Training", "Pewter Training", None,
    # Rows 2-3 empty
    None, None, None, None, None,
    None, None, None, None, None,
]
TRAINING_CARDS = ImageEntry(
    _steam("115369065496175734263557006D91E26EC106890A39303332327D47F4DB.jpg"),
    "batch_grid", "Starter Deck Cards",
    grid=(5, 4),
    cards=_build_grid_cards(_training_labels, cols=5, img_width=6517, img_height=7244, rows=4),
)

# 5) Main deck action cards — 7680x5365, 10 cols × 5 rows
# Positions verified by visual inspection.
_main_deck_labels = [
    # Row 0
    "Unveil", "Train In Secret", "Survive", "Subdue", "Strike", "Strategize", "Steelpush", "Spy", "Soar", "Sneak",
    # Row 1
    "Ruin", "Rescue", "Reposition", "Recover", "Pursue", "Preserve", "Precise Shot", "Pierce", "Pacify", "Maelstrom",
    # Row 2
    "Lookout", "Ironpull", "Investigate", "Intimidate", "Inspire", "Infiltrate", "Hyperaware", "Hunt", "House War", "Hide",
    # Row 3
    "Con", "Ascendant", "Assassinate", "Balance", "Brawl", "Charm", "Confrontation", "Coppercloud", "Crash", "Crushing Blow",
    # Row 4
    "Enrage", "Eavesdrop", "Dominate", "Deceive",
    None, None, None, None, None, None,
]
MAIN_DECK = ImageEntry(
    _steam("13135413059729423061344DC892AC987C52EB68024EB7CB51612AAEA7C8.jpg"),
    "batch_grid", "Main Deck Action Cards",
    grid=(10, 5),
    cards=_build_grid_cards(_main_deck_labels, cols=10, img_width=7680, img_height=5365, rows=5),
)

# ── Master catalog ──────────────────────────────────────────────────────────

ALL_ENTRIES: list[ImageEntry] = [
    *METAL_TOKENS,
    *HERO_CARDS,
    *CARD_BACKS,
    *ICONS,
    *REFERENCE,
    MISSIONS,
    CREW_CARDS,
    TRAINING_CARDS,
    MAIN_DECK,
]

BATCH_ENTRIES: list[ImageEntry] = [
    e for e in ALL_ENTRIES if e.category == "batch_grid"
]


# ── Extraction helpers ──────────────────────────────────────────────────────


def extract_card(entry: ImageEntry, card: CardRegion) -> Image.Image:
    """Crop a single card from a batched image and return as a PIL Image."""
    img = Image.open(IMAGES_DIR / entry.filename)
    return img.crop(card.box)


def extract_all_cards(entry: ImageEntry) -> dict[str, Image.Image]:
    """Extract every card from a batched image. Returns {label: Image}."""
    img = Image.open(IMAGES_DIR / entry.filename)
    return {card.label: img.crop(card.box) for card in entry.cards}


def save_all_cards(entry: ImageEntry, output_dir: Path) -> list[Path]:
    """Extract and save every card from a batched image to output_dir."""
    output_dir.mkdir(parents=True, exist_ok=True)
    img = Image.open(IMAGES_DIR / entry.filename)
    paths = []
    for card in entry.cards:
        cropped = img.crop(card.box)
        # Sanitize filename
        safe_name = card.label.replace(" ", "_").replace("/", "-").replace(":", "")
        fname = f"{safe_name}_r{card.row}_c{card.col}.png"
        path = output_dir / fname
        cropped.save(path)
        paths.append(path)
    return paths


# ── Lookup helpers ──────────────────────────────────────────────────────────


def find_by_label(query: str) -> list[ImageEntry]:
    """Find all entries whose label contains the query (case-insensitive)."""
    q = query.lower()
    return [e for e in ALL_ENTRIES if q in e.label.lower()]


def find_by_category(category: str) -> list[ImageEntry]:
    """Get all entries of a given category."""
    return [e for e in ALL_ENTRIES if e.category == category]


def get_token(metal: str, style: str = "flat") -> Optional[ImageEntry]:
    """Get a specific metal token image. style is 'flat' or 'ringed'."""
    metal_lower = metal.lower()
    for e in METAL_TOKENS:
        if e.label.lower() == metal_lower and e.sublabel == style:
            return e
    return None


# ── Summary printer ─────────────────────────────────────────────────────────


def print_catalog():
    """Print a human-readable summary of all cataloged images."""
    print("=" * 70)
    print("MISTBORN CARD IMAGE CATALOG")
    print("=" * 70)

    categories = [
        ("metal_token", "Metal Tokens"),
        ("hero_card", "Hero Cards"),
        ("card_back", "Card Backs"),
        ("icon", "Icons"),
        ("reference", "Reference"),
        ("batch_grid", "Batched Card Sheets"),
    ]

    for cat_key, cat_name in categories:
        entries = find_by_category(cat_key)
        if not entries:
            continue
        print(f"\n── {cat_name} ({len(entries)}) ──")
        for e in entries:
            extra = ""
            if e.sublabel:
                extra += f" [{e.sublabel}]"
            if e.grid:
                extra += f" ({e.grid[0]}x{e.grid[1]} grid, {len(e.cards)} cards)"
            if e.notes:
                extra += f" — {e.notes}"
            print(f"  • {e.label}{extra}")

            if e.cards:
                for card in e.cards:
                    print(f"      [{card.row},{card.col}] {card.label}"
                          f"  ({card.x},{card.y} {card.width}x{card.height})")


if __name__ == "__main__":
    print_catalog()
