"""Extract individual card images from sprite sheets."""

from pathlib import Path
from PIL import Image

IMAGES = Path("Images")
OUT = Path("cards_extracted")
OUT.mkdir(exist_ok=True)

# Sheet definitions: (filename, cols, rows, pixel_w, pixel_h)
CREW_SHEET = (
    "httpssteamusercontentaakamaihdnetugc10307375962418354840C29207AC69F8AA63CF05D2C21F6DD4C08D8207E9.jpg",
    10, 3, 7680, 3212,
)
DECK_SHEET = (
    "httpssteamusercontentaakamaihdnetugc13135413059729423061344DC892AC987C52EB68024EB7CB51612AAEA7C8.jpg",
    10, 5, 7680, 5365,
)
TRAIN_SHEET = (
    "httpssteamusercontentaakamaihdnetugc115369065496175734263557006D91E26EC106890A39303332327D47F4DB.jpg",
    5, 4, 6517, 7244,
)

# (card_name, sheet, col, row, rotated)
CARDS = [
    # Allies (CREW_SHEET, rotated)
    ("Rebel",       CREW_SHEET, 0, 0, True),
    ("Pewterarm",   CREW_SHEET, 1, 0, True),
    ("Obligator",   CREW_SHEET, 2, 0, True),
    ("Noble",       CREW_SHEET, 3, 0, True),
    ("Mercenary",   CREW_SHEET, 4, 0, True),
    ("Lurcher",     CREW_SHEET, 5, 0, True),
    ("Keeper",      CREW_SHEET, 6, 0, True),
    ("Kandra",      CREW_SHEET, 7, 0, True),
    ("Rioter",      CREW_SHEET, 8, 0, True),
    ("Smoker",      CREW_SHEET, 9, 0, True),
    ("Pickpocket",  CREW_SHEET, 0, 1, True),
    ("Inquisitor",  CREW_SHEET, 1, 1, True),
    ("Informant",   CREW_SHEET, 2, 1, True),
    ("Houselord",   CREW_SHEET, 3, 1, True),
    ("Hazekillers", CREW_SHEET, 4, 1, True),
    ("Crewleader",  CREW_SHEET, 5, 1, True),
    ("Coinshot",    CREW_SHEET, 6, 1, True),
    ("Soldier",     CREW_SHEET, 7, 1, True),
    ("Soother",     CREW_SHEET, 8, 1, True),
    ("Tineye",      CREW_SHEET, 9, 1, True),
    ("Seeker",      CREW_SHEET, 0, 2, True),

    # Actions (DECK_SHEET)
    ("Unveil",          DECK_SHEET, 0, 0, False),
    ("Train In Secret", DECK_SHEET, 1, 0, False),
    ("Survive",         DECK_SHEET, 2, 0, False),
    ("Subdue",          DECK_SHEET, 3, 0, False),
    ("Strike",          DECK_SHEET, 4, 0, False),
    ("Strategize",      DECK_SHEET, 5, 0, False),
    ("Steelpush",       DECK_SHEET, 6, 0, False),
    ("Spy",             DECK_SHEET, 7, 0, False),
    ("Soar",            DECK_SHEET, 8, 0, False),
    ("Sneak",           DECK_SHEET, 9, 0, False),
    ("Ruin",            DECK_SHEET, 0, 1, False),
    ("Rescue",          DECK_SHEET, 1, 1, False),
    ("Reposition",      DECK_SHEET, 2, 1, False),
    ("Recover",         DECK_SHEET, 3, 1, False),
    ("Pursue",          DECK_SHEET, 4, 1, False),
    ("Preserve",        DECK_SHEET, 5, 1, False),
    ("Precise Shot",    DECK_SHEET, 6, 1, False),
    ("Pierce",          DECK_SHEET, 7, 1, False),
    ("Pacify",          DECK_SHEET, 8, 1, False),
    ("Maelstrom",       DECK_SHEET, 9, 1, False),
    ("Lookout",         DECK_SHEET, 0, 2, False),
    ("Ironpull",        DECK_SHEET, 1, 2, False),
    ("Investigate",     DECK_SHEET, 2, 2, False),
    ("Intimidate",      DECK_SHEET, 3, 2, False),
    ("Inspire",         DECK_SHEET, 4, 2, False),
    ("Infiltrate",      DECK_SHEET, 5, 2, False),
    ("Hyperaware",      DECK_SHEET, 6, 2, False),
    ("Hunt",            DECK_SHEET, 7, 2, False),
    ("House War",       DECK_SHEET, 8, 2, False),
    ("Hide",            DECK_SHEET, 9, 2, False),
    ("Con",             DECK_SHEET, 0, 3, False),
    ("Ascendant",       DECK_SHEET, 1, 3, False),
    ("Assassinate",     DECK_SHEET, 2, 3, False),
    ("Balance",         DECK_SHEET, 3, 3, False),
    ("Brawl",           DECK_SHEET, 4, 3, False),
    ("Charm",           DECK_SHEET, 5, 3, False),
    ("Confrontation",   DECK_SHEET, 6, 3, False),
    ("Coppercloud",     DECK_SHEET, 7, 3, False),
    ("Crash",           DECK_SHEET, 8, 3, False),
    ("Crushing Blow",   DECK_SHEET, 9, 3, False),
    ("Enrage",          DECK_SHEET, 0, 4, False),
    ("Eavesdrop",       DECK_SHEET, 1, 4, False),
    ("Dominate",        DECK_SHEET, 2, 4, False),
    ("Deceive",         DECK_SHEET, 3, 4, False),

    # Training cards + Funding (TRAIN_SHEET)
    ("Zinc Training",   TRAIN_SHEET, 0, 0, False),
    ("Tin Training",    TRAIN_SHEET, 1, 0, False),
    ("Copper Training", TRAIN_SHEET, 2, 0, False),
    ("Steel Training",  TRAIN_SHEET, 3, 0, False),
    ("Bronze Training", TRAIN_SHEET, 0, 1, False),
    ("Iron Training",   TRAIN_SHEET, 1, 1, False),
    ("Brass Training",  TRAIN_SHEET, 2, 1, False),
    ("Pewter Training", TRAIN_SHEET, 3, 1, False),
    ("Funding",         TRAIN_SHEET, 4, 0, False),
]

# Windows reserved device names must be mapped to safe filenames.
FILENAME_OVERRIDES = {
    "Con": "Con_card",
}

# Cache opened sheet images
_sheet_cache: dict[str, Image.Image] = {}


def get_sheet_image(filename: str) -> Image.Image:
    if filename not in _sheet_cache:
        _sheet_cache[filename] = Image.open(IMAGES / filename)
    return _sheet_cache[filename]


for name, (filename, cols, rows, w, h), col, row, rotated in CARDS:
    img = get_sheet_image(filename)
    cw = w / cols
    ch = h / rows

    left = int(col * cw)
    top = int(row * ch)
    right = int(left + cw)
    bottom = int(top + ch)

    card_img = img.crop((left, top, right, bottom))

    if rotated:
        card_img = card_img.rotate(90, expand=True)

    out_name = FILENAME_OVERRIDES.get(name, name)
    out_path = OUT / f"{out_name}.png"
    card_img.save(out_path)
    print(f"  {name} -> {out_path}")

print(f"\nExtracted {len(CARDS)} cards to {OUT}/")
