#!/bin/bash
# Hook runner - Node.js 탐색 후 JS 스크립트 실행
# stdin/stdout은 Claude Code ↔ Node.js 직접 패스스루
# Node 미설치 시 조용히 종료 (exit 0)

SCRIPT="$1"
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Node.js 탐색: PATH → NVM → Homebrew
NODE=$(command -v node 2>/dev/null)
if [ -z "$NODE" ]; then
  for p in "$HOME/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$p" ] && NODE="$p" && break
  done
fi
[ -z "$NODE" ] && exit 0

# stdin/stdout 직접 패스스루 — cat으로 캡처하지 않음
"$NODE" "$HOOKS_DIR/$SCRIPT" 2>/dev/null
exit 0
