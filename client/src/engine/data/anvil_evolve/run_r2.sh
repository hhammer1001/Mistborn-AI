#!/bin/sh
# Round-2 Anvil evolution launcher. Continue the 4 replicated keepers from
# their checkpoints (fresh training seeds, bigger eval blocks); retry the 6
# rejected seat/chars from zero at a different seed base.
R=/Users/henryhammer/projects/Mistborn/Mistborn-AI
D=$R/client/src/engine/data/anvil_evolve
cd "$R" || exit 1

run() { # seat char gens pop games seedBase initFile
  npx tsx client/src/engine/anvilEvolve.ts "$1" "$2" "$3" "$4" "$5" "$6" "$7" r2 \
    > "$D/logs/${1}_${2}_r2.log" 2>&1
}

run first  Kelsier 20 16 50 31 "$D/first_Kelsier.json" &
run first  Marsh   20 16 50 31 "$D/first_Marsh.json" &
run second Shan    20 16 50 31 "$D/second_Shan.json" &
run second Prodigy 20 16 50 31 "$D/second_Prodigy.json" &
run second Kelsier 25 16 40 61 "" &
run second Vin     25 16 40 61 "" &
run second Marsh   25 16 40 61 "" &
run first  Vin     25 16 40 61 "" &
run first  Prodigy 25 16 40 61 "" &
run first  Shan    25 16 40 61 "" &
wait
echo "ROUND 2 FINISHED"
grep -h "DONE" "$D"/logs/*_r2.log
