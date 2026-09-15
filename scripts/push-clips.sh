#!/usr/bin/env bash
# Compact the local clip bank and push it to the orphan `clips` branch, which is
# what CI pulls before rendering. Force-pushed each time, so main's history never
# carries video weight. Run after harvesting new clips:  bash scripts/push-clips.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SECS="${CLIP_SECONDS:-15}"
CRF="${CLIP_CRF:-31}"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/assets/clips"

echo "compacting $(ls assets/clips/*.mp4 | wc -l | tr -d ' ') clips (${SECS}s, crf ${CRF})..."
for f in assets/clips/*.mp4; do
  out="$STAGE/assets/clips/$(basename "$f")"
  ffmpeg -v error -y -i "$f" -t "$SECS" -an \
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" \
    -c:v libx264 -crf "$CRF" -preset veryfast -movflags +faststart "$out"
  printf '  %-42s %s\n' "$(basename "$f")" "$(du -h "$out" | cut -f1)"
done
cp assets/clips/sources.json "$STAGE/assets/clips/" 2>/dev/null || true
echo "total: $(du -sh "$STAGE/assets/clips" | cut -f1)"

BRANCH_DIR="$(mktemp -d)"
git worktree add -q --detach "$BRANCH_DIR"
(
  cd "$BRANCH_DIR"
  git checkout -q --orphan clips
  git rm -rq --cached . 2>/dev/null || true
  find . -maxdepth 1 ! -name '.git' ! -name '.' -exec rm -rf {} + 2>/dev/null || true
  mkdir -p assets/clips
  cp "$STAGE/assets/clips/"* assets/clips/
  git add -A
  git commit -qm "clip bank: $(ls assets/clips/*.mp4 | wc -l | tr -d ' ') clips"
  git push -qf origin clips
)
git worktree remove --force "$BRANCH_DIR"
echo "pushed to origin/clips"
