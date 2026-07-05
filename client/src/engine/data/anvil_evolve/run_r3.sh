#!/bin/sh
# Round-3 (final) Anvil evolution: joint knob + card-delta evolution.
# KNOBS=1 unlocks the 19 heuristic-assumption / lookahead-shape knobs so the
# ES moves core constants together with the acquisition deltas. Init from the
# promoted best-of-round genome where one exists, zero otherwise.
R=/Users/henryhammer/projects/Mistborn/Mistborn-AI
D=$R/client/src/engine/data/anvil_evolve
cd "$R" || exit 1
export KNOBS=1

run() { # seat char initFile
  npx tsx client/src/engine/anvilEvolve.ts "$1" "$2" 25 16 50 101 "$3" r3 \
    > "$D/logs/${1}_${2}_r3.log" 2>&1
}

run first  Kelsier "$D/promoted_first_Kelsier.json" &
run first  Shan    "$D/promoted_first_Shan.json" &
run first  Vin     "" &
run first  Marsh   "$D/promoted_first_Marsh.json" &
run first  Prodigy "" &
run second Kelsier "$D/promoted_second_Kelsier.json" &
run second Shan    "$D/promoted_second_Shan.json" &
run second Vin     "$D/promoted_second_Vin.json" &
run second Marsh   "$D/promoted_second_Marsh.json" &
run second Prodigy "$D/promoted_second_Prodigy.json" &
wait
echo "ROUND 3 FINISHED"
grep -h "DONE" "$D"/logs/*_r3.log
