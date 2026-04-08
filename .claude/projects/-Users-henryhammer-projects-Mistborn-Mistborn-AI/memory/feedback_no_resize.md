---
name: Don't resize icons or cards without asking
description: Never shrink metal token icons, card sizes, or other visual element sizes unless the user explicitly says "icons" or "cards" — only resize container boxes/padding/margins.
type: feedback
---

Do not change the size of metal token icons, card widths, or other content sizes unless the user explicitly requests it using words like "icons" or "cards". When asked to "shrink" something, shrink the container box (padding, margins, widths) — not the content inside.

**Why:** The user has reverted icon/card size changes multiple times. They want precise control over content sizing and get frustrated when sizes are changed as a side effect.

**How to apply:** When the user says "shrink the metals component" or "make the box smaller", reduce padding/gap/border on the zone container. Do NOT touch `.metal-icon-img` dimensions or `cardWidth` values.
