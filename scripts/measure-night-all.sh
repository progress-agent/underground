#!/bin/sh
# measure-night-all.sh: the whole render-cost matrix for the night proof (sprint 02Oct26f, lane R). THROWAWAY.
#
#   PROOF=http://localhost:5251 BASE=http://localhost:5250 OUT=<dir> sh scripts/measure-night-all.sh
#
#   PROOF   dev server of the proof worktree (~/repos/ug-s02-r-night, branch s02/r-night)
#   BASE    dev server of the comparison base (~/repos/ug-s02-livebase, detached at e0675d7); optional
#   OUT     directory for one JSON per run (measure-night.mjs output)
#   SETUPS  default "weak as-lived"      ROUNDS  default 2      FRAMES  default 60
#   GPU     path to ug-gpu.sh (every browser run goes through it; default: the sprint 02Oct26f one)
#
# Variants (each its own browser, its own GPU-lock hold; rounds alternate the order to cancel drift):
#   base            the comparison base, no proof code at all (BASE origin)
#   day             the proof branch with no ?night flag (proves the flag-off path is free)
#   night           ?night=1 (all four terms)
#   nostars         ?night=1&nparts=wgm      no star canopy
#   nowin           ?night=1&nparts=gsm      no lit windows
#   noglow          ?night=1&nparts=wsm      no streetlight glow
#   nomoon          ?night=1&nparts=wgs      night terms on, day sun and sky state
#   night-noshadow  ?night=1, shadow toggle off
#   day-noshadow    day, shadow toggle off
# Then summarise: node scripts/summarise-night.mjs $OUT [--md]
set -u
export PATH=/Users/macstudio_1/.nvm/versions/node/v22.17.0/bin:/opt/homebrew/bin:/Users/macstudio_1/Wisdom/SYSTEM/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"
PROOF="${PROOF:-http://localhost:5251}"; BASE="${BASE:-}"; OUT="${OUT:?set OUT}"
SETUPS="${SETUPS:-weak as-lived}"; ROUNDS="${ROUNDS:-2}"; FRAMES="${FRAMES:-60}"
GPU="${GPU:-/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/sprint-02Oct26f/ug-gpu.sh}"
export UG_GPU_WAIT_S="${UG_GPU_WAIT_S:-7200}"
mkdir -p "$OUT"
run() { # setup round label origin query [extra args]
  setup=$1; rnd=$2; label=$3; origin=$4; q=$5; shift 5
  $GPU "night-$setup-$label-r$rnd" node "$HERE/measure-night.mjs" "$origin" --setup "$setup" --label "$label" --query "$q" \
    --frames "$FRAMES" --out "$OUT/$setup-$label-r$rnd.json" "$@"
}
for setup in $SETUPS; do
  r=1
  while [ $r -le $ROUNDS ]; do
    if [ $((r % 2)) = 1 ]; then ORDER="base day night nostars nowin noglow nomoon night-noshadow day-noshadow"
    else ORDER="day-noshadow night-noshadow nomoon noglow nowin nostars night day base"; fi
    for v in $ORDER; do
      case $v in
        base) [ -n "$BASE" ] && run $setup $r base "$BASE" "" ;;
        day) run $setup $r day "$PROOF" "" ;;
        night) run $setup $r night "$PROOF" "night=1" ;;
        nostars) run $setup $r nostars "$PROOF" "night=1&nparts=wgm" ;;
        nowin) run $setup $r nowin "$PROOF" "night=1&nparts=gsm" ;;
        noglow) run $setup $r noglow "$PROOF" "night=1&nparts=wsm" ;;
        nomoon) run $setup $r nomoon "$PROOF" "night=1&nparts=wgs" ;;
        night-noshadow) run $setup $r night-noshadow "$PROOF" "night=1" --shadows 0 ;;
        day-noshadow) run $setup $r day-noshadow "$PROOF" "" --shadows 0 ;;
      esac
    done
    r=$((r + 1))
  done
done
echo "measure-night-all: done -> $OUT"
