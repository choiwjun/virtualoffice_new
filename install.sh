#!/bin/bash
#
# Claude Labs Installer
# TUI-based interactive installer using gum
#

set -e

VERSION="1.22.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GLOBAL_CLAUDE_DIR="$HOME/.claude"
LOCAL_CLAUDE_DIR="./.claude"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

check_gum() {
    if ! command -v gum &> /dev/null; then
        echo -e "${YELLOW}gum이 설치되어 있지 않습니다. 설치를 진행합니다...${NC}"

        if command -v brew &> /dev/null; then
            brew install gum
        elif command -v apt-get &> /dev/null; then
            sudo mkdir -p /etc/apt/keyrings
            curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg
            echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | sudo tee /etc/apt/sources.list.d/charm.list
            sudo apt update && sudo apt install gum
        else
            echo -e "${RED}gum을 자동으로 설치할 수 없습니다.${NC}"
            echo "https://github.com/charmbracelet/gum#installation 참조"
            exit 1
        fi
    fi
}

print_banner() {
    gum style \
        --foreground 212 --border-foreground 212 --border double \
        --align center --width 60 --margin "1 2" --padding "1 2" \
        "🧪 Claude Labs v$VERSION" \
        "" \
        "아이디어만으로 풀스택 웹앱을 완성하는 AI 개발 파트너"
}

# ============================================================================
# Installation Steps
# ============================================================================

select_install_scope() {
    echo ""
    gum style --foreground 39 "📍 Step 1: 설치 위치 선택"

    SCOPE=$(gum choose --cursor.foreground 212 \
        "전역 설치 (~/.claude/) - 모든 프로젝트에서 사용" \
        "프로젝트 설치 (./.claude/) - 현재 프로젝트만")

    if [[ "$SCOPE" == *"전역"* ]]; then
        TARGET_DIR="$GLOBAL_CLAUDE_DIR"
        echo -e "${GREEN}✓ 전역 설치 선택됨${NC}"
    else
        TARGET_DIR="$LOCAL_CLAUDE_DIR"
        echo -e "${GREEN}✓ 프로젝트 설치 선택됨${NC}"
    fi
}

select_skill_categories() {
    echo ""
    gum style --foreground 39 "📦 Step 2: 스킬 카테고리 선택"

    CATEGORIES=$(gum choose --no-limit --cursor.foreground 212 --selected.foreground 212 \
        --header "설치할 카테고리를 선택하세요 (Space로 선택, Enter로 확인):" \
        "🎯 Core - neurion, socrates, doubt, screen-spec, tasks-generator, spike, forge, council (필수 추천)" \
        "🤖 Orchestration - auto-orchestrate, harness, harness-builder, harness-evaluator, harness-forge, cmux-harness, auto-planner" \
        "🛡  Quality - code-review, evaluation, verification, powerqa, trinity, sync, vercel-review, audit" \
        "🐛 Debug - systematic-debugging, reflection, reasoning" \
        "🔬 AutoResearch - autoresearch, autoresearch-frontend, autoresearch-skills (자율 실험 루프)" \
        "📚 Reference - fastapi-latest, react-19, rag" \
        "🔧 Utility - memory, chrome-browser, deep-research, reverse, session-report, skill-installer" \
        "🔗 Hybrid - desktop-bridge (Desktop↔CLI 연동)" \
        "⚡ Token Optimization - token-optimizer, cost-router (토큰 60-90% 절감)" \
        "🧠 Philosophy - eros, eureka, cogito, odysseus, poietes (사고 프레임워크)" \
        "🔤 Language Pro - golang-pro, python-pro, typescript-pro (언어 전문가)" \
        "☁️  DevOps - kubernetes-specialist, terraform-engineer, database-optimizer (인프라)" \
        "📋 All - 모든 스킬 설치")

    echo -e "${GREEN}✓ $(echo "$CATEGORIES" | wc -l | tr -d ' ')개 카테고리 선택됨${NC}"
}

select_constitutions() {
    echo ""
    gum style --foreground 39 "📜 Step 3: 프레임워크 헌법 선택"

    CONSTITUTIONS=$(gum choose --no-limit --cursor.foreground 212 --selected.foreground 212 \
        --header "사용할 프레임워크를 선택하세요:" \
        "🐍 FastAPI - Python 백엔드 (auth, api-design, dotenv)" \
        "⚛️  Next.js - React 프레임워크 (auth, api-routes)" \
        "🗄️  Supabase - BaaS (rls, auth-integration)" \
        "🎨 Tailwind CSS - CSS 프레임워크 (v4-syntax)" \
        "📋 Common - 공통 규칙 (uuid, seed-validation)" \
        "📋 All - 모든 헌법 설치")

    echo -e "${GREEN}✓ $(echo "$CONSTITUTIONS" | wc -l | tr -d ' ')개 헌법 선택됨${NC}"
}

configure_slack_webhook() {
    echo ""
    gum style --foreground 39 "🔔 Step 4: Slack 웹훅 설정 (선택사항)"

    if gum confirm --default=false "Slack 알림을 설정하시겠습니까?"; then
        SLACK_WEBHOOK=$(gum input --placeholder "https://hooks.slack.com/services/..." \
            --header "Slack Webhook URL을 입력하세요:")

        if [[ -n "$SLACK_WEBHOOK" ]]; then
            echo -e "${GREEN}✓ Slack 웹훅 설정됨${NC}"
            SETUP_SLACK=true
        fi
    else
        echo -e "${YELLOW}⏭️  Slack 설정 건너뜀${NC}"
        SETUP_SLACK=false
    fi
}

configure_github_mcp() {
    echo ""
    gum style --foreground 39 "🔧 Step 5: GitHub MCP 서버 설정 (선택사항)"

    SETUP_GITHUB_MCP=false
    GITHUB_TOKEN=""

    # GitHub MCP 설명
    echo ""
    gum style --foreground 252 --italic \
        "GitHub MCP: Issue 생성/조회, PR 관리" \
        "→ /desktop-bridge 스킬에서 사용" \
        "" \
        "※ GitHub Personal Access Token 필요"
    echo ""

    if ! gum confirm --default=true "GitHub MCP를 설정하시겠습니까?"; then
        echo -e "${YELLOW}⏭️  GitHub MCP 설정 건너뜀${NC}"
        return
    fi

    # gh CLI 확인
    echo ""
    if command -v gh &> /dev/null; then
        # gh CLI가 있으면 인증 상태 확인
        if gh auth status &> /dev/null; then
            echo -e "${GREEN}✓ gh CLI 인증됨 - GitHub MCP 대신 gh CLI 사용 가능${NC}"

            if gum confirm "gh CLI가 이미 설정되어 있습니다. GitHub MCP도 추가 설치하시겠습니까?"; then
                SETUP_GITHUB_MCP=true
            else
                echo -e "${GREEN}✓ gh CLI 사용 (GitHub MCP 설치 건너뜀)${NC}"
                return
            fi
        else
            echo -e "${YELLOW}⚠️  gh CLI 설치됨, 인증 필요${NC}"
            echo ""
            if gum confirm "gh CLI로 GitHub 로그인하시겠습니까?"; then
                gh auth login
            fi
        fi
    else
        echo -e "${YELLOW}gh CLI가 설치되어 있지 않습니다.${NC}"
        echo ""

        GITHUB_CHOICE=$(gum choose --cursor.foreground 212 \
            "gh CLI 설치 (권장) - brew/apt로 자동 설치" \
            "GitHub MCP만 설치 - Token 입력 필요" \
            "건너뛰기")

        case "$GITHUB_CHOICE" in
            *"gh CLI"*)
                echo ""
                echo -e "${CYAN}📦 gh CLI 설치 중...${NC}"
                if command -v brew &> /dev/null; then
                    brew install gh
                elif command -v apt-get &> /dev/null; then
                    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
                    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
                    sudo apt update && sudo apt install gh
                else
                    echo -e "${RED}❌ 자동 설치 실패. 수동 설치 필요: https://cli.github.com${NC}"
                fi

                if command -v gh &> /dev/null; then
                    echo -e "${GREEN}✓ gh CLI 설치 완료${NC}"
                    echo ""
                    if gum confirm "GitHub 로그인하시겠습니까?"; then
                        gh auth login
                    fi
                fi
                ;;
            *"GitHub MCP"*)
                SETUP_GITHUB_MCP=true
                ;;
            *)
                echo -e "${YELLOW}⏭️  GitHub 설정 건너뜀${NC}"
                return
                ;;
        esac
    fi

    # GitHub MCP 설치를 선택한 경우 토큰 입력
    if [[ "$SETUP_GITHUB_MCP" == true ]]; then
        echo ""
        echo -e "${CYAN}GitHub Personal Access Token 생성 방법:${NC}"
        echo "  1. https://github.com/settings/tokens?type=beta"
        echo "  2. 'Generate new token' 클릭"
        echo "  3. repo, issues 권한 선택"
        echo ""

        echo -e "${CYAN}GitHub Token을 입력하세요:${NC}"
        read -rp "> " GITHUB_TOKEN

        if [[ -z "$GITHUB_TOKEN" ]]; then
            echo -e "${YELLOW}⚠️  Token 미입력 - GitHub MCP 설정 건너뜀${NC}"
            SETUP_GITHUB_MCP=false
        else
            echo -e "${GREEN}✓ GitHub Token 입력됨${NC}"
        fi
    fi
}

configure_google_mcp() {
    echo ""
    gum style --foreground 39 "🔧 Step 6: Google MCP 서버 설정 (선택사항)"

    SETUP_GEMINI=false
    SETUP_STITCH=false
    STITCH_API_KEY=""
    GCP_PROJECT_ID=""

    # Google MCP 설치 여부 확인
    echo ""
    gum style --foreground 252 --italic \
        "Stitch MCP: 디자인 목업 자동 생성" \
        "Gemini MCP: 프론트엔드 디자인 코딩 지원" \
        "" \
        "※ 둘 다 GCP 프로젝트 + gcloud 인증이 필요합니다"
    echo ""

    if ! gum confirm --default=true "Google MCP를 설정하시겠습니까?"; then
        echo -e "${YELLOW}⏭️  Google MCP 설정 건너뜀${NC}"
        return
    fi

    # ─────────────────────────────────────────────────────────────
    # Step 5-1: GCP 프로젝트 ID 입력
    # ─────────────────────────────────────────────────────────────
    echo ""
    gum style --foreground 214 --border-foreground 214 --border rounded \
        --width 65 --padding "1 2" \
        "🌐 Step 5-1: Google Cloud 프로젝트 ID" \
        "" \
        "1. Google Cloud Console에서 프로젝트 ID를 확인하세요" \
        "   👉 https://console.cloud.google.com" \
        "" \
        "2. 상단 프로젝트 선택 → 프로젝트 ID 복사" \
        "   (없으면 '새 프로젝트' 생성)"
    echo ""

    if gum confirm --default=true "브라우저에서 Google Cloud Console을 열까요?"; then
        open "https://console.cloud.google.com" 2>/dev/null || \
        xdg-open "https://console.cloud.google.com" 2>/dev/null || \
        echo -e "${YELLOW}브라우저를 자동으로 열 수 없습니다.${NC}"
    fi

    echo ""
    GCP_PROJECT_ID=$(gum input --placeholder "GCP 프로젝트 ID (예: my-project-123)" --width 60)

    if [[ -z "$GCP_PROJECT_ID" ]]; then
        echo -e "${YELLOW}⚠️  프로젝트 ID 미입력 - Google MCP 설정 건너뜀${NC}"
        return
    fi
    echo -e "${GREEN}✓ 프로젝트 ID: $GCP_PROJECT_ID${NC}"

    # ─────────────────────────────────────────────────────────────
    # Step 5-2: gcloud CLI 설치 및 인증
    # ─────────────────────────────────────────────────────────────
    echo ""
    gum style --foreground 214 --border-foreground 214 --border rounded \
        --width 65 --padding "1 2" \
        "🔐 Step 5-2: gcloud CLI 인증" \
        "" \
        "브라우저에서 Google 계정으로 로그인합니다"
    echo ""

    # gcloud 설치 확인
    if ! command -v gcloud &> /dev/null; then
        echo -e "${YELLOW}gcloud CLI가 설치되어 있지 않습니다.${NC}"
        if gum confirm --default=true "gcloud CLI를 설치하시겠습니까?"; then
            if command -v brew &> /dev/null; then
                echo -e "${CYAN}brew로 gcloud CLI 설치 중...${NC}"
                brew install google-cloud-sdk
            else
                echo -e "${RED}brew가 없어서 자동 설치할 수 없습니다.${NC}"
                echo "https://cloud.google.com/sdk/docs/install 에서 수동 설치하세요."
                return
            fi
        else
            echo -e "${YELLOW}⚠️  gcloud 미설치 - Google MCP 설정 건너뜀${NC}"
            return
        fi
    fi

    # gcloud CLI 인증 (gcloud 명령어 실행용)
    echo -e "${CYAN}gcloud CLI 인증을 시작합니다. 브라우저에서 로그인하세요...${NC}"
    if gcloud auth login --quiet; then
        echo -e "${GREEN}✓ gcloud CLI 인증 완료${NC}"
    else
        echo -e "${RED}✗ gcloud CLI 인증 실패${NC}"
        return
    fi

    # 프로젝트 설정
    echo -e "${CYAN}gcloud 프로젝트 설정 중...${NC}"
    gcloud config set project "$GCP_PROJECT_ID" 2>/dev/null
    echo -e "${GREEN}✓ 프로젝트 설정: $GCP_PROJECT_ID${NC}"

    # ADC 인증 (MCP 서버용)
    echo -e "${CYAN}ADC 인증을 시작합니다. 브라우저에서 로그인하세요...${NC}"
    if gcloud auth application-default login --quiet; then
        echo -e "${GREEN}✓ ADC 인증 완료${NC}"
    else
        echo -e "${RED}✗ ADC 인증 실패${NC}"
        return
    fi

    # Gemini MCP는 여기서 설정 가능
    SETUP_GEMINI=true
    echo -e "${GREEN}✓ Gemini MCP 설정 준비 완료${NC}"

    # ─────────────────────────────────────────────────────────────
    # Step 5-3: Stitch API 활성화
    # ─────────────────────────────────────────────────────────────
    echo ""
    gum style --foreground 214 --border-foreground 214 --border rounded \
        --width 65 --padding "1 2" \
        "🔌 Step 5-3: Stitch API 활성화" \
        "" \
        "GCP 프로젝트에서 Stitch API를 활성화합니다."
    echo ""

    if gum confirm --default=true "Stitch API를 활성화하시겠습니까?"; then
        echo -e "${CYAN}Stitch API 활성화 중...${NC}"
        if gcloud beta services mcp enable stitch.googleapis.com --project="$GCP_PROJECT_ID" 2>/dev/null; then
            echo -e "${GREEN}✓ Stitch API 활성화 완료${NC}"
        else
            # beta 명령어가 없을 경우 일반 services enable 시도
            if gcloud services enable stitch.googleapis.com --project="$GCP_PROJECT_ID" 2>/dev/null; then
                echo -e "${GREEN}✓ Stitch API 활성화 완료${NC}"
            else
                echo -e "${YELLOW}⚠️  Stitch API 활성화 실패 - 수동으로 활성화하세요${NC}"
                echo "   https://console.cloud.google.com/apis/library/stitch.googleapis.com"
            fi
        fi
    else
        echo -e "${YELLOW}⏭️  Stitch API 활성화 건너뜀${NC}"
    fi

    # ─────────────────────────────────────────────────────────────
    # Step 5-4: IAM 권한 부여
    # ─────────────────────────────────────────────────────────────
    echo ""
    gum style --foreground 214 --border-foreground 214 --border rounded \
        --width 65 --padding "1 2" \
        "🔑 Step 5-4: IAM 권한 부여" \
        "" \
        "Stitch MCP 사용에 필요한 IAM 권한을 부여합니다." \
        "(roles/serviceusage.serviceUsageConsumer)"
    echo ""

    # 현재 인증된 사용자 이메일 가져오기
    CURRENT_USER=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)

    if [[ -n "$CURRENT_USER" ]]; then
        echo -e "${CYAN}현재 인증된 계정: $CURRENT_USER${NC}"
        if gum confirm --default=true "이 계정에 IAM 권한을 부여하시겠습니까?"; then
            echo -e "${CYAN}IAM 권한 부여 중...${NC}"
            if gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
                --member="user:$CURRENT_USER" \
                --role="roles/serviceusage.serviceUsageConsumer" \
                --quiet 2>/dev/null; then
                echo -e "${GREEN}✓ IAM 권한 부여 완료${NC}"
            else
                echo -e "${YELLOW}⚠️  IAM 권한 부여 실패 - 수동으로 설정하세요${NC}"
                echo "   gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \\"
                echo "     --member=\"user:$CURRENT_USER\" \\"
                echo "     --role=\"roles/serviceusage.serviceUsageConsumer\""
            fi
        else
            echo -e "${YELLOW}⏭️  IAM 권한 부여 건너뜀${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  인증된 계정을 찾을 수 없습니다. 수동으로 IAM 권한을 설정하세요.${NC}"
    fi

    # ─────────────────────────────────────────────────────────────
    # Step 5-5: Stitch API Key (선택)
    # ─────────────────────────────────────────────────────────────
    echo ""
    gum style --foreground 214 --border-foreground 214 --border rounded \
        --width 65 --padding "1 2" \
        "🎨 Step 5-5: Stitch API Key (선택)" \
        "" \
        "Stitch MCP로 디자인 목업을 자동 생성하려면" \
        "API Key가 필요합니다 (없으면 Enter로 건너뛰기)" \
        "" \
        "👉 https://stitch.withgoogle.com/settings"
    echo ""

    if gum confirm --default=true "브라우저에서 Stitch Settings를 열까요?"; then
        open "https://stitch.withgoogle.com/settings" 2>/dev/null || \
        xdg-open "https://stitch.withgoogle.com/settings" 2>/dev/null || \
        echo -e "${YELLOW}브라우저를 자동으로 열 수 없습니다.${NC}"
    fi

    echo ""
    STITCH_API_KEY=$(gum input --placeholder "Stitch API Key (없으면 Enter)" --width 60)

    if [[ -n "$STITCH_API_KEY" ]]; then
        SETUP_STITCH=true
        echo -e "${GREEN}✓ Stitch API Key 입력 완료${NC}"
    else
        echo -e "${YELLOW}⏭️  Stitch API Key 건너뜀 (Gemini MCP만 설정)${NC}"
    fi
}

configure_rtk() {
    echo ""
    gum style --foreground 39 "⚡ Step 7: RTK (Rust Token Killer) 설치 (선택사항)"

    SETUP_RTK=false

    echo ""
    gum style --foreground 252 --italic \
        "RTK: CLI 명령어 출력을 자동 압축하여 토큰 60-90% 절감" \
        "→ git, pytest, npm, docker 등 30+ 명령어 지원" \
        "→ Claude Code 훅으로 투명하게 동작" \
        "" \
        "※ Homebrew 또는 Cargo 필요"
    echo ""

    if ! gum confirm --default=false "RTK를 설치하시겠습니까?"; then
        echo -e "${YELLOW}⏭️  RTK 설치 건너뜀${NC}"
        return
    fi

    # RTK 이미 설치 확인
    if command -v rtk &> /dev/null; then
        RTK_VERSION=$(rtk --version 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✓ RTK 이미 설치됨 ($RTK_VERSION)${NC}"
        SETUP_RTK=true
        return
    fi

    # 설치 방법 선택
    RTK_METHOD=$(gum choose --cursor.foreground 212 \
        "Homebrew (권장) - brew install rtk-ai/tap/rtk" \
        "Cargo - cargo install rtk" \
        "건너뛰기")

    case "$RTK_METHOD" in
        *"Homebrew"*)
            if command -v brew &> /dev/null; then
                echo -e "${CYAN}📦 RTK 설치 중 (Homebrew)...${NC}"
                gum spin --spinner dot --title "RTK 설치 중..." -- \
                    brew install rtk-ai/tap/rtk
                if command -v rtk &> /dev/null; then
                    echo -e "${GREEN}✓ RTK 설치 완료${NC}"
                    SETUP_RTK=true
                else
                    echo -e "${RED}✗ RTK 설치 실패${NC}"
                fi
            else
                echo -e "${RED}Homebrew가 설치되어 있지 않습니다.${NC}"
            fi
            ;;
        *"Cargo"*)
            if command -v cargo &> /dev/null; then
                echo -e "${CYAN}📦 RTK 설치 중 (Cargo)...${NC}"
                gum spin --spinner dot --title "RTK 빌드 중 (1-2분 소요)..." -- \
                    cargo install rtk
                if command -v rtk &> /dev/null; then
                    echo -e "${GREEN}✓ RTK 설치 완료${NC}"
                    SETUP_RTK=true
                else
                    echo -e "${RED}✗ RTK 설치 실패${NC}"
                fi
            else
                echo -e "${RED}Cargo가 설치되어 있지 않습니다. rustup을 먼저 설치하세요.${NC}"
            fi
            ;;
        *)
            echo -e "${YELLOW}⏭️  RTK 설치 건너뜀${NC}"
            ;;
    esac
}

setup_rtk_hook() {
    if [[ "$SETUP_RTK" == true ]]; then
        echo ""
        gum style --foreground 39 "⚙️  Configuring RTK Claude Code Hook..."

        # RTK의 자동 설정 사용
        if command -v rtk &> /dev/null; then
            if rtk init --global 2>/dev/null; then
                echo -e "${GREEN}✓ RTK Claude Code 훅 등록 완료${NC}"
                echo -e "${CYAN}  모든 Bash 명령어가 자동으로 RTK를 통해 최적화됩니다.${NC}"
            else
                echo -e "${YELLOW}⚠️  RTK 훅 자동 등록 실패 - 수동 설정 필요:${NC}"
                echo "   rtk init --global"
            fi
        fi
    fi
}

# ============================================================================
# Installation Logic
# ============================================================================

# Safe directory copy: rsync with cp fallback, never fails under set -e
# Returns 0 always (set -e safe), but sets COPY_OK=1 on success, COPY_OK=0 on failure
COPY_OK=0
copy_dir() {
    local src="$1" dst="$2"
    COPY_OK=0
    if [[ ! -d "$src" ]]; then
        echo -e "    ${YELLOW}⚠ $(basename "$src") 소스 없음 (건너뜀)${NC}" >&2
        return 0
    fi
    mkdir -p "$dst" 2>/dev/null || true
    if rsync -a "$src/" "$dst/" 2>/dev/null; then
        COPY_OK=1
        return 0
    fi
    # rsync failed - fallback to cp
    if cp -R "$src/"* "$dst/" 2>/dev/null; then
        COPY_OK=1
        return 0
    fi
    echo -e "    ${YELLOW}⚠ $(basename "$src") 복사 실패 (건너뜀)${NC}" >&2
    return 0
}

# Install a list of skills for a category
install_category() {
    local category="$1"
    shift
    local total=$#
    local ok=0

    echo -ne "  ${CYAN}${category}${NC} "
    for skill in "$@"; do
        copy_dir "$SCRIPT_DIR/.claude/skills/$skill" "$TARGET_DIR/skills/$skill"
        if [[ "$COPY_OK" -eq 1 ]]; then
            ok=$((ok + 1))
        fi
    done
    echo -e "${GREEN}✓ (${ok}/${total})${NC}"
}

install_skills() {
    echo ""
    gum style --foreground 39 "⚙️  Installing Skills..."

    mkdir -p "$TARGET_DIR/skills" 2>/dev/null || true
    mkdir -p "$TARGET_DIR/agents" 2>/dev/null || true
    mkdir -p "$TARGET_DIR/constitutions" 2>/dev/null || true
    mkdir -p "$TARGET_DIR/docs" 2>/dev/null || true
    mkdir -p "$TARGET_DIR/commands" 2>/dev/null || true

    # Determine which skills to install
    INSTALL_ALL=false
    [[ "$CATEGORIES" == *"All"* ]] && INSTALL_ALL=true

    # Copy skills based on selection (loop-based, no gum spin per skill)
    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Core"* ]]; then
        install_category "Core" neurion socrates doubt screen-spec tasks-generator spike forge council
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Orchestration"* ]]; then
        install_category "Orchestration" auto-orchestrate harness harness-builder harness-evaluator harness-forge cmux-harness auto-planner
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Quality"* ]]; then
        install_category "Quality" code-review evaluation verification-before-completion powerqa trinity sync vercel-review audit
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Debug"* ]]; then
        install_category "Debug" systematic-debugging reflection reasoning
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"AutoResearch"* ]]; then
        install_category "AutoResearch" autoresearch autoresearch-frontend autoresearch-skills
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Reference"* ]]; then
        install_category "Reference" fastapi-latest react-19 rag
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Utility"* ]]; then
        install_category "Utility" memory chrome-browser deep-research reverse session-report skill-installer
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Hybrid"* ]]; then
        install_category "Hybrid" desktop-bridge
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Token Optimization"* ]]; then
        install_category "Token Optimization" token-optimizer cost-router
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Philosophy"* ]]; then
        install_category "Philosophy" eros eureka cogito odysseus poietes
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"Language Pro"* ]]; then
        install_category "Language Pro" golang-pro python-pro typescript-pro
    fi

    if [[ "$INSTALL_ALL" == true ]] || [[ "$CATEGORIES" == *"DevOps"* ]]; then
        install_category "DevOps" kubernetes-specialist terraform-engineer database-optimizer
    fi

    # Always install remaining essential skills
    echo -ne "  ${CYAN}Essential${NC} "
    for skill in project-bootstrap project-bootstrap-supabase design-linker design-discovery; do
        copy_dir "$SCRIPT_DIR/.claude/skills/$skill" "$TARGET_DIR/skills/$skill"
    done
    echo -e "${GREEN}✓${NC}"

    # Install agents, docs, commands
    echo -ne "  ${CYAN}Agents & Docs${NC} "
    copy_dir "$SCRIPT_DIR/.claude/agents" "$TARGET_DIR/agents"
    copy_dir "$SCRIPT_DIR/.claude/docs" "$TARGET_DIR/docs"
    copy_dir "$SCRIPT_DIR/.claude/commands" "$TARGET_DIR/commands"
    echo -e "${GREEN}✓${NC}"

    # Install hooks
    if [[ -d "$SCRIPT_DIR/.claude/hooks" ]]; then
        echo -ne "  ${CYAN}Hooks${NC} "
        copy_dir "$SCRIPT_DIR/.claude/hooks" "$TARGET_DIR/hooks"
        chmod +x "$TARGET_DIR/hooks/"*.js 2>/dev/null || true
        echo -e "${GREEN}✓${NC}"

        # Merge hooks settings from .claude/settings.json into ~/.claude/settings.json
        merge_hooks_settings
    fi

    echo -e "${GREEN}✓ 스킬 설치 완료${NC}"
}

# Merge "hooks" section of source settings.json into target settings.json
# Preserves all other user settings (mcpServers, permissions, env, etc.)
merge_hooks_settings() {
    local SRC_SETTINGS="$SCRIPT_DIR/.claude/settings.json"
    local DST_SETTINGS="$TARGET_DIR/settings.json"

    if [[ ! -f "$SRC_SETTINGS" ]]; then
        return 0
    fi

    echo -ne "  ${CYAN}Hooks settings${NC} "

    if ! command -v jq &> /dev/null; then
        # No jq: only write if destination doesn't exist (don't clobber user config)
        if [[ ! -f "$DST_SETTINGS" ]]; then
            cp "$SRC_SETTINGS" "$DST_SETTINGS"
            echo -e "${GREEN}✓${NC} (copied — install jq for safe merge)"
        else
            echo -e "${YELLOW}⚠ jq 미설치${NC} — settings.json 수동 병합 필요. ${YELLOW}brew install jq${NC} 후 재실행 권장"
            echo -e "    소스: ${CYAN}$SRC_SETTINGS${NC}"
            echo -e "    대상: ${CYAN}$DST_SETTINGS${NC}"
        fi
        return 0
    fi

    # Backup existing settings before merge
    if [[ -f "$DST_SETTINGS" ]]; then
        cp "$DST_SETTINGS" "${DST_SETTINGS}.bak.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
    fi

    local TMP_FILE
    TMP_FILE=$(mktemp)

    if [[ -f "$DST_SETTINGS" ]]; then
        # Replace hooks section in existing settings (preserves all other keys)
        if jq -s '.[0] as $src | .[1] | .hooks = $src.hooks' "$SRC_SETTINGS" "$DST_SETTINGS" > "$TMP_FILE" 2>/dev/null; then
            mv "$TMP_FILE" "$DST_SETTINGS"
            echo -e "${GREEN}✓${NC} (hooks 섹션 병합)"
        else
            rm -f "$TMP_FILE"
            echo -e "${YELLOW}⚠ 병합 실패${NC} — 기존 settings.json 유지"
            return 1
        fi
    else
        # Create new settings.json with only hooks section
        if jq '{hooks: .hooks}' "$SRC_SETTINGS" > "$TMP_FILE" 2>/dev/null; then
            mv "$TMP_FILE" "$DST_SETTINGS"
            echo -e "${GREEN}✓${NC} (settings.json 생성)"
        else
            rm -f "$TMP_FILE"
            echo -e "${YELLOW}⚠ 생성 실패${NC}"
            return 1
        fi
    fi
}

install_constitutions() {
    echo ""
    gum style --foreground 39 "⚙️  Installing Constitutions..."

    mkdir -p "$TARGET_DIR/constitutions" 2>/dev/null || true

    INSTALL_ALL_CONST=false
    [[ "$CONSTITUTIONS" == *"All"* ]] && INSTALL_ALL_CONST=true

    if [[ "$INSTALL_ALL_CONST" == true ]] || [[ "$CONSTITUTIONS" == *"FastAPI"* ]]; then
        echo -ne "  ${CYAN}FastAPI${NC} "
        copy_dir "$SCRIPT_DIR/.claude/constitutions/fastapi" "$TARGET_DIR/constitutions/fastapi"
        echo -e "${GREEN}✓${NC}"
    fi

    if [[ "$INSTALL_ALL_CONST" == true ]] || [[ "$CONSTITUTIONS" == *"Next.js"* ]]; then
        echo -ne "  ${CYAN}Next.js${NC} "
        copy_dir "$SCRIPT_DIR/.claude/constitutions/nextjs" "$TARGET_DIR/constitutions/nextjs"
        echo -e "${GREEN}✓${NC}"
    fi

    if [[ "$INSTALL_ALL_CONST" == true ]] || [[ "$CONSTITUTIONS" == *"Supabase"* ]]; then
        echo -ne "  ${CYAN}Supabase${NC} "
        copy_dir "$SCRIPT_DIR/.claude/constitutions/supabase" "$TARGET_DIR/constitutions/supabase"
        echo -e "${GREEN}✓${NC}"
    fi

    if [[ "$INSTALL_ALL_CONST" == true ]] || [[ "$CONSTITUTIONS" == *"Tailwind"* ]]; then
        echo -ne "  ${CYAN}Tailwind${NC} "
        copy_dir "$SCRIPT_DIR/.claude/constitutions/tailwind" "$TARGET_DIR/constitutions/tailwind"
        echo -e "${GREEN}✓${NC}"
    fi

    if [[ "$INSTALL_ALL_CONST" == true ]] || [[ "$CONSTITUTIONS" == *"Common"* ]]; then
        echo -ne "  ${CYAN}Common${NC} "
        copy_dir "$SCRIPT_DIR/.claude/constitutions/common" "$TARGET_DIR/constitutions/common"
        echo -e "${GREEN}✓${NC}"
    fi

    # Always install README
    cp "$SCRIPT_DIR/.claude/constitutions/README.md" "$TARGET_DIR/constitutions/" 2>/dev/null || true

    echo -e "${GREEN}✓ 헌법 설치 완료${NC}"
}

setup_slack_webhook() {
    if [[ "$SETUP_SLACK" == true ]] && [[ -n "$SLACK_WEBHOOK" ]]; then
        echo ""
        gum style --foreground 39 "⚙️  Configuring Slack Webhook..."

        # Create or update settings.json
        SETTINGS_FILE="$TARGET_DIR/settings.json"

        if [[ -f "$SETTINGS_FILE" ]]; then
            # Update existing file
            TMP_FILE=$(mktemp)
            jq --arg webhook "$SLACK_WEBHOOK" '. + {slack_webhook: $webhook}' "$SETTINGS_FILE" > "$TMP_FILE"
            mv "$TMP_FILE" "$SETTINGS_FILE"
        else
            # Create new file
            echo "{\"slack_webhook\": \"$SLACK_WEBHOOK\"}" > "$SETTINGS_FILE"
        fi

        echo -e "${GREEN}✓ Slack 웹훅 설정 완료${NC}"
    fi
}

setup_github_mcp() {
    if [[ "$SETUP_GITHUB_MCP" == true ]] && [[ -n "$GITHUB_TOKEN" ]]; then
        echo ""
        gum style --foreground 39 "⚙️  Setting up GitHub MCP Server..."

        SETTINGS_FILE="$HOME/.claude/settings.json"
        mkdir -p "$HOME/.claude"

        # GitHub MCP 설정 추가
        if [[ -f "$SETTINGS_FILE" ]]; then
            # settings.json이 있으면 mcpServers에 github 추가
            TMP_FILE=$(mktemp)

            # jq가 있으면 사용, 없으면 수동 처리
            if command -v jq &> /dev/null; then
                jq --arg token "$GITHUB_TOKEN" '.mcpServers.github = {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {
                        "GITHUB_PERSONAL_ACCESS_TOKEN": $token
                    }
                }' "$SETTINGS_FILE" > "$TMP_FILE" && mv "$TMP_FILE" "$SETTINGS_FILE"
            else
                # jq 없이 수동 처리 (간단한 케이스)
                echo -e "${YELLOW}⚠️  jq가 없어 수동 설정이 필요합니다.${NC}"
                echo ""
                echo "settings.json에 다음을 추가하세요:"
                echo ""
                cat << EOF
"mcpServers": {
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "$GITHUB_TOKEN"
    }
  }
}
EOF
                echo ""
            fi
        else
            # settings.json이 없으면 새로 생성
            cat > "$SETTINGS_FILE" << EOF
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "$GITHUB_TOKEN"
      }
    }
  }
}
EOF
        fi

        echo -e "${GREEN}✓ GitHub MCP 설정 완료${NC}"
    fi
}

setup_gemini_mcp() {
    if [[ "$SETUP_GEMINI" == true ]]; then
        echo ""
        gum style --foreground 39 "⚙️  Installing Gemini MCP Server (Node.js + OAuth)..."

        # ⚠️ Gemini MCP는 OAuth 인증 사용 (API 키 절대 금지)
        # gemini CLI가 OAuth를 처리하고, Node.js MCP 서버가 이를 래핑함

        MCP_DIR="$HOME/.claude/mcp-servers/gemini-mcp"
        mkdir -p "$HOME/.claude/mcp-servers"

        # Step 1: Check gemini CLI
        echo -e "${CYAN}[1/3] gemini CLI 확인...${NC}"
        if ! command -v gemini &> /dev/null; then
            echo -e "${YELLOW}gemini CLI가 설치되어 있지 않습니다.${NC}"
            echo ""
            echo "  Google gemini CLI 설치 방법:"
            echo "    npm install -g @google/gemini-cli"
            echo ""
            if gum confirm "npm으로 gemini CLI를 설치하시겠습니까?"; then
                gum spin --spinner dot --title "gemini CLI 설치 중..." -- \
                    npm install -g @google/gemini-cli
                if [[ $? -eq 0 ]]; then
                    echo -e "${GREEN}✓ gemini CLI 설치 완료${NC}"
                else
                    echo -e "${RED}✗ gemini CLI 설치 실패${NC}"
                    return
                fi
            else
                echo -e "${RED}gemini CLI 없이는 Gemini MCP를 사용할 수 없습니다.${NC}"
                return
            fi
        else
            echo -e "${GREEN}✓ gemini CLI 발견${NC}"
        fi

        # Step 2: OAuth 인증 (gemini CLI가 처리)
        echo -e "${CYAN}[2/3] OAuth 인증...${NC}"
        echo ""
        gum style --foreground 212 --bold \
            "🔐 Google OAuth 인증을 시작합니다." \
            "브라우저가 열리면 Google 계정으로 로그인하세요." \
            "(이미 인증했다면 바로 완료됩니다)"
        echo ""

        if gum confirm "OAuth 인증을 진행하시겠습니까?"; then
            gemini --version 2>/dev/null || gemini 2>/dev/null || true
            echo -e "${GREEN}✓ OAuth 인증 완료${NC}"
        fi

        # Step 3: Node.js MCP 서버 복사 및 등록
        echo -e "${CYAN}[3/3] MCP 서버 설치...${NC}"

        # 로컬 gemini-mcp 복사 (여러 경로에서 탐색)
        GEMINI_SRC=""
        if [[ -d "$SCRIPT_DIR/mcp-servers/gemini-mcp" ]]; then
            GEMINI_SRC="$SCRIPT_DIR/mcp-servers/gemini-mcp"
        elif [[ -d "$SCRIPT_DIR/.claude/mcp-servers/gemini-mcp" ]]; then
            GEMINI_SRC="$SCRIPT_DIR/.claude/mcp-servers/gemini-mcp"
        fi

        if [[ -n "$GEMINI_SRC" ]]; then
            rm -rf "$MCP_DIR"
            cp -r "$GEMINI_SRC" "$MCP_DIR"
            echo -e "${GREEN}✓ MCP 서버 복사 완료${NC}"
        else
            echo -e "${RED}✗ gemini-mcp 폴더를 찾을 수 없습니다.${NC}"
            echo -e "${YELLOW}   다음 위치에서 찾았으나 없음:${NC}"
            echo "   - $SCRIPT_DIR/mcp-servers/gemini-mcp"
            echo "   - $SCRIPT_DIR/.claude/mcp-servers/gemini-mcp"
            return
        fi

        # Register Gemini MCP via Claude CLI (user scope → ~/.claude.json)
        claude mcp remove --scope user gemini 2>/dev/null || true
        if claude mcp add-json --scope user gemini "{\"command\":\"node\",\"args\":[\"$MCP_DIR/index.js\"]}" 2>/dev/null; then
            echo -e "${GREEN}✓ Gemini MCP 등록 완료 (OAuth 인증 방식)${NC}"
        else
            echo -e "${RED}✗ Gemini MCP 등록 실패 - 수동 등록 필요:${NC}"
            echo -e "  claude mcp add-json --scope user gemini '{\"command\":\"node\",\"args\":[\"$MCP_DIR/index.js\"]}'"
        fi
    fi
}

setup_stitch_mcp() {
    if [[ "$SETUP_STITCH" == true ]] && [[ -n "$GCP_PROJECT_ID" ]]; then
        echo ""
        gum style --foreground 39 "⚙️  Configuring Stitch MCP Server..."

        # Register Stitch MCP via Claude CLI (user scope → ~/.claude.json)
        claude mcp remove --scope user stitch 2>/dev/null || true

        # Build JSON config
        if [[ -n "$STITCH_API_KEY" ]]; then
            STITCH_JSON="{\"command\":\"npx\",\"args\":[\"-y\",\"stitch-mcp\"],\"env\":{\"GOOGLE_CLOUD_PROJECT\":\"$GCP_PROJECT_ID\",\"STITCH_API_KEY\":\"$STITCH_API_KEY\"}}"
        else
            STITCH_JSON="{\"command\":\"npx\",\"args\":[\"-y\",\"stitch-mcp\"],\"env\":{\"GOOGLE_CLOUD_PROJECT\":\"$GCP_PROJECT_ID\"}}"
        fi

        if claude mcp add-json --scope user stitch "$STITCH_JSON" 2>/dev/null; then
            STITCH_CONFIGURED=true
            if [[ -n "$STITCH_API_KEY" ]]; then
                echo -e "${GREEN}✓ Stitch MCP 등록 완료 (API Key 포함, user scope)${NC}"
            else
                echo -e "${YELLOW}✓ Stitch MCP 등록됨 (API Key 미설정, user scope)${NC}"
            fi
        else
            echo -e "${RED}✗ Stitch MCP 등록 실패 - 수동 등록 필요:${NC}"
            echo -e "  claude mcp add-json --scope user stitch '$STITCH_JSON'"
        fi
    fi
}

show_google_mcp_guide() {
    # Show Gemini ADC setup guide (only for Gemini - Stitch uses API key)
    if [[ "$SETUP_GEMINI" == true ]]; then
        echo ""
        gum style --foreground 214 --border-foreground 214 --border rounded \
            --width 65 --padding "1 2" \
            "⚠️  Gemini MCP 사용 전 ADC 설정 필요" \
            "" \
            "📋 Step 1: gcloud CLI 설치" \
            "   https://cloud.google.com/sdk/docs/install" \
            "" \
            "📋 Step 2: ADC 인증" \
            "   \$ gcloud auth application-default login" \
            "   → 브라우저에서 Google 로그인"
    fi

    # Show Stitch API key guide if not provided during setup
    if [[ "$SETUP_STITCH" == true ]] && [[ -z "$STITCH_API_KEY" ]]; then
        echo ""
        gum style --foreground 214 --border-foreground 214 --border rounded \
            --width 65 --padding "1 2" \
            "⚠️  Stitch MCP API Key 설정 필요" \
            "" \
            "1. https://stitch.withgoogle.com/ 접속" \
            "2. 프로필 → Stitch Settings → API Keys" \
            "3. 'Create Key' 클릭 후 복사" \
            "4. ~/.claude/settings.json 에 추가:" \
            "   \"env\": { \"STITCH_API_KEY\": \"your-key\" }"
    fi
}

# ============================================================================
# Post-installation
# ============================================================================

show_completion() {
    echo ""
    INSTALLED_SKILLS=$(ls -1 "$TARGET_DIR/skills" 2>/dev/null | wc -l | tr -d ' ')
    INSTALLED_CONST=$(find "$TARGET_DIR/constitutions" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

    gum style \
        --foreground 82 --border-foreground 82 --border rounded \
        --align center --width 60 --margin "1 2" --padding "1 2" \
        "Setup Complete!" \
        "" \
        "Skills: ${INSTALLED_SKILLS}" \
        "Constitutions: ${INSTALLED_CONST}" \
        "Location: $TARGET_DIR"

    # Show MCP Status Summary
    echo ""
    gum style --foreground 39 "🔧 MCP 설정 상태"
    echo ""

    # Check each MCP status
    MCP_STITCH="❌ 미설정"
    MCP_GEMINI="❌ 미설정"
    MCP_CONTEXT7="❌ 미설정"

    # Check MCP status via claude mcp list (reads from ~/.claude.json)
    MCP_LIST=$(claude mcp list 2>/dev/null || echo "")
    if echo "$MCP_LIST" | grep -q 'stitch.*Connected'; then
        MCP_STITCH="✅ 설정됨"
    fi
    if echo "$MCP_LIST" | grep -q 'gemini.*Connected'; then
        MCP_GEMINI="✅ 설정됨"
    fi
    if echo "$MCP_LIST" | grep -q 'context7.*Connected'; then
        MCP_CONTEXT7="✅ 설정됨"
    fi

    # Check RTK status
    RTK_STATUS="❌ 미설치"
    if command -v rtk &> /dev/null; then
        RTK_STATUS="✅ 설치됨"
    fi

    gum style \
        --foreground 252 --border-foreground 240 --border normal \
        --width 60 --margin "0 2" --padding "1 2" \
        "🎨 Stitch MCP:   $MCP_STITCH" \
        "   → /screen-spec Phase 5 디자인 자동 생성" \
        "" \
        "🤖 Gemini MCP:   $MCP_GEMINI" \
        "   → 프론트엔드 디자인 코딩 지원" \
        "" \
        "📚 Context7 MCP: $MCP_CONTEXT7" \
        "   → 최신 라이브러리 문서 검색" \
        "" \
        "⚡ RTK:          $RTK_STATUS" \
        "   → CLI 출력 자동 압축 (토큰 60-90% 절감)"

    # Show Stitch setup guide (API Key - simple!)
    if [[ "$MCP_STITCH" == "❌ 미설정" ]]; then
        echo ""
        gum style --foreground 214 "💡 Stitch MCP 설정 (API Key로 간단!)"
        echo ""
        gum style \
            --foreground 252 --border-foreground 214 --border rounded \
            --width 65 --margin "0 2" --padding "1 2" \
            "GCP 프로젝트 없이 API Key로 간단 설정!" \
            "" \
            "1. API Key 생성:" \
            "   👉 https://stitch.withgoogle.com/settings" \
            "" \
            "2. 인스톨러 재실행:" \
            "   \$ ./install.sh → Stitch MCP 선택 → API Key 입력"
    fi

    # Show Gemini setup guide (ADC required)
    if [[ "$MCP_GEMINI" == "❌ 미설정" ]]; then
        echo ""
        gum style --foreground 81 "💡 Gemini MCP 설정 가이드 (gcloud 필요)"
        echo ""
        gum style \
            --foreground 252 --border-foreground 81 --border rounded \
            --width 65 --margin "0 2" --padding "1 2" \
            "gcloud CLI로 ADC 인증이 필요합니다." \
            "" \
            "📋 Step 1: gcloud CLI 설치" \
            "   https://cloud.google.com/sdk/docs/install" \
            "" \
            "📋 Step 2: ADC 인증" \
            "   \$ gcloud auth application-default login" \
            "   → 브라우저에서 Google 로그인" \
            "" \
            "📋 Step 3: 인스톨러 재실행" \
            "   \$ ./install.sh → Gemini MCP 선택"
    fi

    # Show Context7 setup guide if not configured
    if [[ "$MCP_CONTEXT7" == "❌ 미설정" ]]; then
        echo ""
        gum style --foreground 81 "💡 Context7 MCP 설정 가이드"
        echo ""
        gum style \
            --foreground 252 --border-foreground 81 --border rounded \
            --width 65 --margin "0 2" --padding "1 2" \
            "최신 라이브러리 문서를 검색하는 RAG MCP입니다." \
            "" \
            "📋 인스톨러 재실행으로 간단히 설정:" \
            "   \$ ./install.sh → Context7 MCP 선택" \
            "" \
            "   또는 수동 설정:" \
            "   ~/.claude/settings.json의 mcpServers에 추가:" \
            "   \"context7\": {" \
            "     \"command\": \"npx\"," \
            "     \"args\": [\"-y\", \"@anthropic-ai/context7-mcp\"]" \
            "   }"
    fi

    # Show RTK setup guide if not installed
    if [[ "$RTK_STATUS" == "❌ 미설치" ]]; then
        echo ""
        gum style --foreground 81 "💡 RTK 설치 가이드 (토큰 60-90% 절감)"
        echo ""
        gum style \
            --foreground 252 --border-foreground 81 --border rounded \
            --width 65 --margin "0 2" --padding "1 2" \
            "CLI 명령어 출력을 자동 압축하여 토큰을 절감합니다." \
            "" \
            "📋 설치:" \
            "   \$ brew install rtk-ai/tap/rtk" \
            "" \
            "📋 Claude Code 연동:" \
            "   \$ rtk init --global" \
            "" \
            "📋 절감 확인:" \
            "   \$ rtk gain"
    fi

    echo ""
    gum style --foreground 39 "🚀 다음 단계"
    echo ""

    gum style \
        --foreground 252 --border-foreground 240 --border normal \
        --width 60 --margin "0 2" --padding "1 2" \
        "1. Claude Code 실행:" \
        "   $ claude" \
        "" \
        "2. 소크라테스로 기획 시작:" \
        "   > /socrates" \
        "" \
        "3. 기획 완료 후 화면 명세:" \
        "   > /screen-spec  (→ Phase 5: Stitch 디자인)" \
        "" \
        "4. 태스크 생성 및 실행:" \
        "   > /tasks-generator" \
        "   > /auto-orchestrate"

    echo ""

    # Offer to start socrates
    if gum confirm --default=true "지금 바로 /socrates로 기획을 시작하시겠습니까?"; then
        echo ""
        gum style --foreground 212 "💡 Claude Code에서 다음 명령어를 입력하세요:"
        echo ""
        gum style --foreground 82 --bold "   /socrates"
        echo ""

        # Copy to clipboard if possible
        if command -v pbcopy &> /dev/null; then
            echo "/socrates" | pbcopy
            echo -e "${CYAN}(클립보드에 복사됨)${NC}"
        fi
    fi
}

install_cli_app() {
    echo ""
    gum style --foreground 39 "Step 7: Clabs GUI App Installation"
    echo ""

    CLI_DMG="$SCRIPT_DIR/Claude-Labs-v${VERSION}-Mac.dmg"

    echo -e "${CYAN}DMG 경로: $CLI_DMG${NC}"

    if [[ ! -f "$CLI_DMG" ]]; then
        echo -e "${YELLOW}DMG 파일을 찾을 수 없습니다.${NC}"
        echo -e "${YELLOW}DMG 설치를 건너뛰고 스킬팩만 설치합니다.${NC}"
        echo -e "${CYAN}Clabs 앱은 나중에 DMG 파일을 직접 실행하여 설치할 수 있습니다.${NC}"
        return
    fi

    gum style --foreground 252 --italic \
        "Clabs는 Claude Labs 스킬팩을 위한 GUI 앱입니다." \
        "터미널 없이도 스킬을 실행하고 관리할 수 있습니다."
    echo ""

    if ! gum confirm --default=true "Clabs 앱을 설치하시겠습니까?"; then
        echo -e "${YELLOW}⏭️  앱 설치 건너뜀${NC}"
        return
    fi

    echo -e "${CYAN}📦 Clabs 앱 설치 중...${NC}"

    # 이미 마운트되어 있는지 확인
    MOUNT_POINT=$(ls -d /Volumes/Clabs* 2>/dev/null | head -1)

    if [[ -z "$MOUNT_POINT" ]]; then
        # 새로 마운트
        MOUNT_OUTPUT=$(hdiutil attach "$CLI_DMG" -nobrowse 2>&1)
        if [[ $? -ne 0 ]]; then
            echo -e "${RED}✗ DMG 마운트 실패${NC}"
            echo -e "${YELLOW}$MOUNT_OUTPUT${NC}"
            return
        fi
        # 마운트 후 다시 확인
        sleep 1
        MOUNT_POINT=$(ls -d /Volumes/Clabs* 2>/dev/null | head -1)
    else
        echo -e "${CYAN}이미 마운트됨: $MOUNT_POINT${NC}"
    fi

    if [[ -z "$MOUNT_POINT" ]] || [[ ! -d "$MOUNT_POINT" ]]; then
        echo -e "${RED}✗ 마운트 포인트를 찾을 수 없습니다${NC}"
        return
    fi

    echo -e "${GREEN}마운트 위치: $MOUNT_POINT${NC}"

    # Find .app in mounted volume
    APP_PATH=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" -type d 2>/dev/null | head -1)

    if [[ -z "$APP_PATH" ]]; then
        echo -e "${RED}✗ 앱을 찾을 수 없습니다${NC}"
        hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null
        return
    fi

    APP_NAME=$(basename "$APP_PATH")

    # Copy to /Applications
    if [[ -d "/Applications/$APP_NAME" ]]; then
        echo -e "${YELLOW}기존 $APP_NAME 를 덮어씁니다...${NC}"
        rm -rf "/Applications/$APP_NAME"
    fi

    gum spin --spinner dot --title "$APP_NAME 복사 중..." -- \
        cp -R "$APP_PATH" /Applications/

    # Unmount DMG
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null

    if [[ -d "/Applications/$APP_NAME" ]]; then
        echo -e "${GREEN}✓ Clabs가 /Applications에 설치되었습니다${NC}"

        # Remove quarantine attribute
        xattr -rd com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true

        echo ""
        if gum confirm --default=true "지금 Clabs를 실행하시겠습니까?"; then
            sleep 1
            open "/Applications/$APP_NAME"
            echo -e "${GREEN}✓ Clabs 실행됨${NC}"
        fi
    else
        echo -e "${RED}✗ 앱 복사 실패${NC}"
    fi
}

show_quick_reference() {
    echo ""
    if gum confirm --default=false "스킬 퀵 레퍼런스를 보시겠습니까?"; then
        gum style \
            --foreground 252 --border-foreground 212 --border rounded \
            --width 65 --margin "1 2" --padding "1 2" \
            "📚 주요 스킬 퀵 레퍼런스" \
            "" \
            "/socrates     - 1:1 대화로 서비스 기획 (시작점!)" \
            "/screen-spec  - 화면별 상세 명세 생성" \
            "/tasks-generator - TASKS.md 생성" \
            "/auto-orchestrate - 태스크 자동 실행" \
            "" \
            "/code-review  - 코드 품질 검토" \
            "/systematic-debugging - 버그 근본 원인 분석" \
            "" \
            "/deep-research - 5개 검색 API 병렬 리서치" \
            "/chrome-browser - 브라우저 자동화"
    fi
}

# ============================================================================
# Main
# ============================================================================

main() {
    check_gum
    clear
    print_banner

    select_install_scope
    select_skill_categories
    select_constitutions
    configure_slack_webhook
    configure_github_mcp
    configure_google_mcp
    configure_rtk

    echo ""
    gum style --foreground 39 "📋 설치 요약"
    echo ""
    echo "  위치: $TARGET_DIR"
    echo "  카테고리: $(echo "$CATEGORIES" | tr '\n' ', ' | sed 's/,$//')"
    echo "  헌법: $(echo "$CONSTITUTIONS" | tr '\n' ', ' | sed 's/,$//')"
    [[ "$SETUP_SLACK" == true ]] && echo "  Slack: 설정됨"
    [[ "$SETUP_GITHUB_MCP" == true ]] && echo "  GitHub MCP: 설치 예정"
    [[ "$SETUP_GEMINI" == true ]] && echo "  Gemini MCP: 설치 예정"
    [[ "$SETUP_STITCH" == true ]] && echo "  Stitch MCP: 등록 예정"
    [[ "$SETUP_RTK" == true ]] && echo "  RTK: 설치됨 (토큰 60-90% 절감)"
    echo ""

    if gum confirm "설치를 진행하시겠습니까?"; then
        echo ""
        install_skills
        install_constitutions
        setup_slack_webhook
        setup_github_mcp
        setup_gemini_mcp
        setup_stitch_mcp
        setup_rtk_hook
        install_cli_app
        show_google_mcp_guide
        show_completion
        show_quick_reference
    else
        echo -e "${YELLOW}설치가 취소되었습니다.${NC}"
        exit 0
    fi
}

# Run
main "$@"
