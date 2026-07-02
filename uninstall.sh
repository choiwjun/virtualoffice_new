#!/bin/bash
#
# Claude Labs Uninstaller
#

set -e

GLOBAL_CLAUDE_DIR="$HOME/.claude"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_gum() {
    if ! command -v gum &> /dev/null; then
        echo "gum이 설치되어 있지 않습니다. 기본 모드로 진행합니다."
        USE_GUM=false
    else
        USE_GUM=true
    fi
}

main() {
    check_gum

    echo ""
    echo "🗑️  Claude Labs Uninstaller"
    echo ""

    if [[ "$USE_GUM" == true ]]; then
        SCOPE=$(gum choose \
            "전역 설치 제거 (~/.claude/skills, agents, constitutions, docs)" \
            "프로젝트 설치 제거 (./.claude/)" \
            "취소")
    else
        echo "제거할 위치를 선택하세요:"
        echo "1) 전역 설치 제거"
        echo "2) 프로젝트 설치 제거"
        echo "3) 취소"
        read -p "선택: " choice
        case $choice in
            1) SCOPE="전역";;
            2) SCOPE="프로젝트";;
            *) SCOPE="취소";;
        esac
    fi

    if [[ "$SCOPE" == *"취소"* ]]; then
        echo -e "${YELLOW}취소되었습니다.${NC}"
        exit 0
    fi

    if [[ "$SCOPE" == *"전역"* ]]; then
        echo ""
        echo "다음 디렉토리가 제거됩니다:"
        echo "  - $GLOBAL_CLAUDE_DIR/skills/"
        echo "  - $GLOBAL_CLAUDE_DIR/agents/"
        echo "  - $GLOBAL_CLAUDE_DIR/constitutions/"
        echo "  - $GLOBAL_CLAUDE_DIR/docs/"
        echo "  - $GLOBAL_CLAUDE_DIR/commands/"
        echo ""

        if [[ "$USE_GUM" == true ]]; then
            gum confirm "정말 제거하시겠습니까?" || exit 0
        else
            read -p "정말 제거하시겠습니까? (y/N) " confirm
            [[ "$confirm" != "y" && "$confirm" != "Y" ]] && exit 0
        fi

        rm -rf "$GLOBAL_CLAUDE_DIR/skills"
        rm -rf "$GLOBAL_CLAUDE_DIR/agents"
        rm -rf "$GLOBAL_CLAUDE_DIR/constitutions"
        rm -rf "$GLOBAL_CLAUDE_DIR/docs"
        rm -rf "$GLOBAL_CLAUDE_DIR/commands"

        echo -e "${GREEN}✓ 전역 설치가 제거되었습니다.${NC}"

    else
        if [[ ! -d "./.claude" ]]; then
            echo -e "${RED}현재 디렉토리에 .claude 폴더가 없습니다.${NC}"
            exit 1
        fi

        echo ""
        echo "다음 디렉토리가 제거됩니다:"
        echo "  - ./.claude/"
        echo ""

        if [[ "$USE_GUM" == true ]]; then
            gum confirm "정말 제거하시겠습니까?" || exit 0
        else
            read -p "정말 제거하시겠습니까? (y/N) " confirm
            [[ "$confirm" != "y" && "$confirm" != "Y" ]] && exit 0
        fi

        rm -rf "./.claude"

        echo -e "${GREEN}✓ 프로젝트 설치가 제거되었습니다.${NC}"
    fi
}

main "$@"
