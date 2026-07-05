#!/bin/sh
# Round-4 Anvil campaign: league fitness (frozen committed Anvil + Hulk
# specialist + Squash), successive-halving evaluation, double validation
# gate, joint knob+delta evolution, init from the shipped roster.
R=/Users/henryhammer/projects/Mistborn/Mistborn-AI
D=$R/client/src/engine/data/anvil_evolve
cd "$R" || exit 1
export KNOBS=1

run() { # seat char
  npx tsx client/src/engine/anvilEvolve.ts "$1" "$2" 20 24 10 201 "$D/${1}_${2}.final.json" r4 \
    > "$D/logs/${1}_${2}_r4.log" 2>&1
}

for c in Kelsier Shan Vin Marsh Prodigy; do
  run first "$c" &
  run second "$c" &
done
wait
echo "ROUND 4 FINISHED"
grep -h "DONE" "$D"/logs/*_r4.log
