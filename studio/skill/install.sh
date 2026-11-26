#!/usr/bin/env bash
# 把 code-animation-video 技能装进本机 DSH（默认 ~/.dsh/skills）
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/code-animation-video"
DEST="${DSH_SKILLS_DIR:-$HOME/.dsh/skills}"
mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/code-animation-video/"
echo "已安装 → $DEST/code-animation-video"
echo "重启会话或新开一轮后，技能列表里会出现 code-animation-video"
