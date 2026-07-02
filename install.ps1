#
# Claude Labs Installer for Windows
# PowerShell-based interactive installer
#

$ErrorActionPreference = "Continue"
$VERSION = "1.22.0"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$GLOBAL_CLAUDE_DIR = "$env:USERPROFILE\.claude"
$LOCAL_CLAUDE_DIR = ".\.claude"

# ============================================================================
# 실행 정책 확인 및 설정 (스크립트 시작 시 최우선 실행)
# ============================================================================

function Set-ExecutionPolicyIfNeeded {
    $currentPolicy = Get-ExecutionPolicy -Scope CurrentUser

    if ($currentPolicy -eq "Restricted" -or $currentPolicy -eq "AllSigned") {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Yellow
        Write-Host "  PowerShell 실행 정책 변경 필요" -ForegroundColor Yellow
        Write-Host "============================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  현재 실행 정책: $currentPolicy" -ForegroundColor Cyan
        Write-Host "  npm으로 설치되는 CLI 도구들(claude 등)을 사용하려면"
        Write-Host "  실행 정책을 'RemoteSigned'로 변경해야 합니다."
        Write-Host ""

        $changePolicy = Read-Host "실행 정책을 변경하시겠습니까? (Y/n)"
        if ($changePolicy -ne "n" -and $changePolicy -ne "N") {
            try {
                Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
                Write-Host ""
                Write-Host "[+] 실행 정책이 'RemoteSigned'로 변경되었습니다!" -ForegroundColor Green
                Write-Host ""
            } catch {
                Write-Host ""
                Write-Host "[!] 실행 정책 변경 실패: $_" -ForegroundColor Red
                Write-Host ""
                Write-Host "수동으로 다음 명령어를 실행하세요:" -ForegroundColor Yellow
                Write-Host "  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned" -ForegroundColor Cyan
                Write-Host ""
                exit 1
            }
        } else {
            Write-Host ""
            Write-Host "[!] 실행 정책을 변경하지 않으면 Claude Code CLI 등을 사용할 수 없습니다." -ForegroundColor Red
            Write-Host ""
            exit 1
        }
    } else {
        Write-Host "[+] PowerShell 실행 정책 OK: $currentPolicy" -ForegroundColor Green
    }
}

# 스크립트 시작 시 실행 정책 먼저 확인
Set-ExecutionPolicyIfNeeded

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Color {
    param([string]$Text, [string]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
}

function Check-Git {
    Write-Host ""
    Write-Host ">>> 의존성 체크: Git" -ForegroundColor Cyan
    if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Color "============================================" "Yellow"
        Write-Color "  Git이 설치되어 있지 않습니다!" "Yellow"
        Write-Color "============================================" "Yellow"
        Write-Host ""
        Write-Host "  Git은 Claude Code (Windows)와 Gemini MCP에 필요합니다."
        Write-Host ""

        # Check if winget is available
        if (Get-Command "winget" -ErrorAction SilentlyContinue) {
            $installGit = Read-Host "winget으로 Git을 자동 설치하시겠습니까? (Y/n)"
            if ($installGit -ne "n" -and $installGit -ne "N") {
                Write-Color "Git 설치 중... (몇 분 소요될 수 있습니다)" "Cyan"
                winget install --id Git.Git -e --source winget
                if ($LASTEXITCODE -eq 0) {
                    Write-Color "Git 설치 완료!" "Green"
                    Write-Host ""
                    Write-Color "중요: PowerShell을 재시작한 후 install.ps1을 다시 실행하세요." "Yellow"
                    Write-Host ""
                    exit 0
                } else {
                    Write-Color "Git 설치 실패" "Red"
                }
            }
        }

        Write-Host ""
        Write-Color "Git 수동 설치 방법:" "Yellow"
        Write-Host "  1. https://git-scm.com/downloads/win 에서 다운로드"
        Write-Host "  2. 또는 winget: winget install Git.Git"
        Write-Host "  3. 또는 scoop:  scoop install git"
        Write-Host "  4. 또는 choco:  choco install git"
        Write-Host ""
        Write-Color "Git 설치 후 PowerShell을 재시작하고 다시 실행하세요." "Cyan"
        Write-Host ""
        exit 1
    }
    $gitVersion = git --version
    Write-Color "$gitVersion 감지됨" "Green"
}

function Check-NodeJS {
    Write-Host ">>> 의존성 체크: Node.js" -ForegroundColor Cyan
    if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Color "============================================" "Red"
        Write-Color "  Node.js가 설치되어 있지 않습니다!" "Red"
        Write-Color "============================================" "Red"
        Write-Host ""
        Write-Color "Node.js 설치 방법:" "Yellow"
        Write-Host "  1. https://nodejs.org 에서 LTS 버전 다운로드"
        Write-Host "  2. 또는 winget: winget install OpenJS.NodeJS.LTS"
        Write-Host "  3. 또는 scoop:  scoop install nodejs-lts"
        Write-Host "  4. 또는 choco:  choco install nodejs-lts"
        Write-Host ""
        Write-Color "Node.js 설치 후 PowerShell을 재시작하고 다시 실행하세요." "Cyan"
        Write-Host ""
        exit 1
    }
    $nodeVersion = node --version
    Write-Color "Node.js $nodeVersion 감지됨" "Green"
}

function Check-ClaudeCLI {
    Write-Host ""
    Write-Host ""
    Write-Host "########################################" -ForegroundColor Magenta
    Write-Host "##                                    ##" -ForegroundColor Magenta
    Write-Host "##  [필수] Claude Code CLI 확인       ##" -ForegroundColor Magenta
    Write-Host "##                                    ##" -ForegroundColor Magenta
    Write-Host "########################################" -ForegroundColor Magenta
    Write-Host ""

    # Windows npm 전역 경로에서 claude 확인 (Parallels 공유 경로 제외)
    $npmGlobalPath = npm root -g 2>$null
    $windowsClaudePath = $null
    $isWindowsInstall = $false

    if ($npmGlobalPath -and $npmGlobalPath -like "*$env:APPDATA*") {
        # Windows npm 전역 경로 확인
        $claudeBinPath = Join-Path (Split-Path $npmGlobalPath -Parent) "claude.cmd"
        if (Test-Path $claudeBinPath) {
            $isWindowsInstall = $true
            $windowsClaudePath = $claudeBinPath
        }
    }

    # Get-Command로도 확인하되, 경로가 Windows인지 체크
    $claudeCmd = Get-Command "claude" -ErrorAction SilentlyContinue
    if ($claudeCmd -and $claudeCmd.Source) {
        $cmdPath = $claudeCmd.Source
        # Windows 경로인지 확인 (C:\ 또는 %APPDATA% 등)
        if ($cmdPath -match "^[A-Za-z]:\\" -and $cmdPath -notmatch "Parallels") {
            $isWindowsInstall = $true
        } else {
            Write-Host "[!] Mac/Parallels 경로의 claude 감지됨 (Windows용 아님)" -ForegroundColor Yellow
            Write-Host "    경로: $cmdPath" -ForegroundColor Gray
            $isWindowsInstall = $false
        }
    }

    if (-not $isWindowsInstall) {
        Write-Host "[!] Windows용 Claude Code CLI가 설치되어 있지 않습니다." -ForegroundColor Red
        Write-Host ""
        Write-Host "    Claude Code CLI는 스킬 실행에 필수입니다." -ForegroundColor Gray
        Write-Host ""

        $installClaude = Read-Host "    npm으로 Claude Code CLI를 설치하시겠습니까? (Y/n)"
        if ($installClaude -ne "n" -and $installClaude -ne "N") {
            Write-Host ""
            Write-Host "[*] Claude Code CLI 설치 중... (1-2분 소요)" -ForegroundColor Cyan
            Write-Host "    명령어: npm install -g @anthropic-ai/claude-code" -ForegroundColor Gray
            Write-Host ""

            npm install -g @anthropic-ai/claude-code

            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Host "[+] Claude Code CLI 설치 완료!" -ForegroundColor Green
                return $true
            } else {
                Write-Host ""
                Write-Host "[X] Claude Code CLI 설치 실패" -ForegroundColor Red
                Write-Host "    수동 설치: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
                return $false
            }
        } else {
            Write-Host ""
            Write-Host "[!] Claude Code CLI 없이 계속 진행합니다." -ForegroundColor Yellow
            Write-Host "    MCP 서버는 수동으로 등록해야 합니다." -ForegroundColor Gray
            return $false
        }
    }

    $claudeVersion = claude --version 2>$null | Select-Object -First 1
    Write-Host "[+] Claude Code $claudeVersion 감지됨 (Windows)" -ForegroundColor Green
    return $true
}

function Check-Gum {
    if (-not (Get-Command "gum" -ErrorAction SilentlyContinue)) {
        Write-Color "gum이 설치되어 있지 않습니다." "Yellow"
        Write-Color "설치 방법:" "Cyan"
        Write-Host "  scoop install charm-gum"
        Write-Host "  또는"
        Write-Host "  choco install gum"
        Write-Host ""

        $useSimple = Read-Host "gum 없이 간단한 설치를 진행하시겠습니까? (Y/n)"
        if ($useSimple -eq "n" -or $useSimple -eq "N") {
            Write-Color "gum을 먼저 설치해주세요." "Red"
            exit 1
        }
        return $false
    }
    return $true
}

function Print-Banner {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  🧪 Claude Labs v$VERSION" -ForegroundColor Magenta
    Write-Host "  아이디어만으로 풀스택 웹앱을 완성하는 AI 개발 파트너" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host ""
}

# ============================================================================
# Simple Mode (without gum)
# ============================================================================

function Simple-Install {
    Print-Banner

    # Step 1: Install scope
    Write-Color "Step 1: 설치 위치 선택" "Cyan"
    Write-Host "  1. 전역 설치 (~/.claude/) - 모든 프로젝트에서 사용"
    Write-Host "  2. 프로젝트 설치 (./.claude/) - 현재 프로젝트만"
    $scope = Read-Host "선택 (1 또는 2)"

    if ($scope -eq "1") {
        $script:TARGET_DIR = $GLOBAL_CLAUDE_DIR
        Write-Color "전역 설치 선택됨" "Green"
    } else {
        $script:TARGET_DIR = $LOCAL_CLAUDE_DIR
        Write-Color "프로젝트 설치 선택됨" "Green"
    }

    # Step 2: Skill categories
    Write-Host ""
    Write-Color "Step 2: 스킬 카테고리 선택" "Cyan"
    Write-Host "  1. Core - neurion, socrates, doubt, screen-spec, tasks-generator, spike (필수 추천)"
    Write-Host "  2. Orchestration - auto-orchestrate, harness, harness-forge, cmux-harness"
    Write-Host "  3. Quality - code-review, evaluation, audit, trinity"
    Write-Host "  4. Debug - systematic-debugging, reflection, reasoning"
    Write-Host "  5. Reference - fastapi-latest, react-19, rag"
    Write-Host "  7. Utility - memory, chrome-browser, session-report, skill-installer"
    Write-Host "  8. Hybrid - desktop-bridge (Desktop-CLI 연동)"
    Write-Host "  A. All - 모든 스킬 설치"
    $categories = Read-Host "선택 (쉼표로 구분, 예: 1,2,3 또는 A)"
    $script:INSTALL_ALL = $categories -match "A"
    $script:SELECTED_CATEGORIES = $categories

    # Step 3: Constitutions
    Write-Host ""
    Write-Color "Step 3: 프레임워크 헌법 선택" "Cyan"
    Write-Host "  1. FastAPI - Python 백엔드"
    Write-Host "  2. Next.js - React 프레임워크"
    Write-Host "  3. Supabase - BaaS"
    Write-Host "  4. Tailwind CSS - CSS 프레임워크"
    Write-Host "  5. Common - 공통 규칙"
    Write-Host "  A. All - 모든 헌법 설치"
    $constitutions = Read-Host "선택 (쉼표로 구분, 예: 1,2 또는 A)"
    $script:INSTALL_ALL_CONST = $constitutions -match "A"
    $script:SELECTED_CONSTITUTIONS = $constitutions

    # Step 4: Slack webhook
    Write-Host ""
    Write-Color "Step 4: Slack 웹훅 설정 (선택사항)" "Cyan"
    $setupSlack = Read-Host "Slack 알림을 설정하시겠습니까? (y/N)"
    if ($setupSlack -eq "y" -or $setupSlack -eq "Y") {
        $script:SLACK_WEBHOOK = Read-Host "Slack Webhook URL"
        $script:SETUP_SLACK = $true
    } else {
        $script:SETUP_SLACK = $false
    }

    # Step 5: GitHub MCP
    Write-Host ""
    Write-Color "Step 5: GitHub MCP 서버 설정 (선택사항)" "Cyan"
    Write-Host ""
    Write-Host "  GitHub MCP: Issue 생성/조회, PR 관리" -ForegroundColor Gray
    Write-Host "  → /desktop-bridge 스킬에서 사용" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  ※ GitHub Personal Access Token 필요" -ForegroundColor Yellow
    Write-Host ""

    $script:SETUP_GITHUB_MCP = $false
    $script:GITHUB_TOKEN = ""

    # gh CLI 확인
    $ghInstalled = Get-Command "gh" -ErrorAction SilentlyContinue

    if ($ghInstalled) {
        $ghAuth = gh auth status 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Color "gh CLI 인증됨 - GitHub MCP 대신 gh CLI 사용 가능" "Green"
            $setupGitHubMcp = Read-Host "gh CLI가 이미 설정되어 있습니다. GitHub MCP도 추가 설치하시겠습니까? (y/N)"
            if ($setupGitHubMcp -eq "y" -or $setupGitHubMcp -eq "Y") {
                $script:SETUP_GITHUB_MCP = $true
            }
        } else {
            Write-Color "gh CLI 설치됨, 인증 필요" "Yellow"
            $ghLogin = Read-Host "gh CLI로 GitHub 로그인하시겠습니까? (Y/n)"
            if ($ghLogin -ne "n" -and $ghLogin -ne "N") {
                gh auth login
            }
        }
    } else {
        Write-Host "gh CLI가 설치되어 있지 않습니다." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  1. gh CLI 설치 (권장) - winget으로 자동 설치"
        Write-Host "  2. GitHub MCP만 설치 - Token 입력 필요"
        Write-Host "  3. 건너뛰기"
        Write-Host ""
        $githubChoice = Read-Host "선택 (1/2/3)"

        switch ($githubChoice) {
            "1" {
                Write-Host ""
                Write-Color "gh CLI 설치 중..." "Cyan"
                if (Get-Command "winget" -ErrorAction SilentlyContinue) {
                    winget install --id GitHub.cli -e --source winget
                    if ($LASTEXITCODE -eq 0) {
                        Write-Color "gh CLI 설치 완료! PowerShell 재시작 후 gh auth login 실행하세요." "Green"
                    }
                } else {
                    Write-Host "winget을 사용할 수 없습니다. 수동 설치: https://cli.github.com" -ForegroundColor Yellow
                }
            }
            "2" {
                $script:SETUP_GITHUB_MCP = $true
            }
            default {
                Write-Color "GitHub 설정 건너뜀" "Yellow"
            }
        }
    }

    # GitHub MCP 설치를 선택한 경우 토큰 입력
    if ($script:SETUP_GITHUB_MCP) {
        Write-Host ""
        Write-Host "  GitHub Personal Access Token 생성 방법:" -ForegroundColor Cyan
        Write-Host "  1. https://github.com/settings/tokens?type=beta" -ForegroundColor Gray
        Write-Host "  2. 'Generate new token' 클릭" -ForegroundColor Gray
        Write-Host "  3. repo, issues 권한 선택" -ForegroundColor Gray
        Write-Host ""

        $script:GITHUB_TOKEN = Read-Host "  GitHub Token을 입력하세요 (ghp_xxxx)"

        if (-not $script:GITHUB_TOKEN) {
            Write-Color "Token 미입력 - GitHub MCP 설정 건너뜀" "Yellow"
            $script:SETUP_GITHUB_MCP = $false
        } else {
            Write-Color "GitHub Token 입력됨" "Green"
        }
    }

    # Step 6: Google MCP (Gemini + Stitch)
    Write-Host ""
    Write-Color "Step 6: Google MCP 서버 설정 (선택사항)" "Cyan"
    Write-Host ""
    Write-Host "  Stitch MCP: 디자인 목업 자동 생성" -ForegroundColor Gray
    Write-Host "  Gemini MCP: 프론트엔드 디자인 코딩 지원" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  ※ 둘 다 GCP 프로젝트 + gcloud 인증이 필요합니다" -ForegroundColor Yellow
    Write-Host ""

    $script:SETUP_STITCH = $false
    $script:SETUP_GEMINI = $false
    $script:STITCH_API_KEY = ""
    $script:GCP_PROJECT_ID = ""

    $setupGoogle = Read-Host "Google MCP를 설정하시겠습니까? (Y/n)"
    if ($setupGoogle -eq "n" -or $setupGoogle -eq "N") {
        Write-Color "Google MCP 설정 건너뜀" "Yellow"
    } else {
        # ─────────────────────────────────────────────────────────────
        # Step 5-1: GCP 프로젝트 ID 입력
        # ─────────────────────────────────────────────────────────────
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  Step 5-1: Google Cloud 프로젝트 ID" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  1. Google Cloud Console에서 프로젝트 ID를 확인하세요"
        Write-Host "     https://console.cloud.google.com" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  2. 상단 프로젝트 선택 -> 프로젝트 ID 복사"
        Write-Host "     (없으면 '새 프로젝트' 생성)"
        Write-Host ""

        $openGcp = Read-Host "브라우저에서 Google Cloud Console을 열까요? (Y/n)"
        if ($openGcp -ne "n" -and $openGcp -ne "N") {
            Start-Process "https://console.cloud.google.com"
        }

        Write-Host ""
        $script:GCP_PROJECT_ID = Read-Host "GCP 프로젝트 ID (예: my-project-123)"

        if (-not $GCP_PROJECT_ID) {
            Write-Color "프로젝트 ID 미입력 - Google MCP 설정 건너뜀" "Yellow"
        } else {
            Write-Color "프로젝트 ID: $GCP_PROJECT_ID" "Green"

            # ─────────────────────────────────────────────────────────────
            # Step 5-2: gcloud CLI 설치 및 인증
            # ─────────────────────────────────────────────────────────────
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host "  Step 5-2: gcloud CLI 인증" -ForegroundColor Yellow
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host ""

            # gcloud 설치 확인
            $gcloudExists = Get-Command gcloud -ErrorAction SilentlyContinue
            if (-not $gcloudExists) {
                Write-Color "gcloud CLI가 설치되어 있지 않습니다." "Yellow"
                $installGcloud = Read-Host "gcloud CLI를 설치하시겠습니까? (Y/n)"
                if ($installGcloud -ne "n" -and $installGcloud -ne "N") {
                    # Google 공식 인스톨러 직접 다운로드 (winget 인증서 오류 우회)
                    Write-Color "Google Cloud SDK 다운로드 중..." "Cyan"
                    $installerUrl = "https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe"
                    $installerPath = "$env:TEMP\GoogleCloudSDKInstaller.exe"

                    try {
                        # TLS 1.2 강제 (보안 연결용)
                        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

                        # 다운로드
                        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
                        Write-Color "다운로드 완료. 설치 시작..." "Green"

                        # 설치 실행 (사용자 상호작용 필요)
                        Write-Host ""
                        Write-Host "  ┌─────────────────────────────────────────────────┐" -ForegroundColor Yellow
                        Write-Host "  │  Google Cloud SDK 설치 창이 열립니다.          │" -ForegroundColor Yellow
                        Write-Host "  │  설치 완료 후 이 창으로 돌아오세요.            │" -ForegroundColor Yellow
                        Write-Host "  └─────────────────────────────────────────────────┘" -ForegroundColor Yellow
                        Write-Host ""

                        Start-Process -FilePath $installerPath -Wait

                        # PATH 새로고침
                        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

                        Write-Color "Google Cloud SDK 설치 완료" "Green"

                        # 임시 파일 삭제
                        Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
                    } catch {
                        Write-Color "다운로드 실패. 수동 설치하세요:" "Red"
                        Write-Host "  https://cloud.google.com/sdk/docs/install" -ForegroundColor Cyan
                    }
                }
            }

            # gcloud 인증
            $gcloudExists = Get-Command gcloud -ErrorAction SilentlyContinue
            if ($gcloudExists) {
                # gcloud CLI 인증 (gcloud 명령어 실행용)
                Write-Host ""
                Write-Color "gcloud CLI 인증을 시작합니다. 브라우저에서 로그인하세요..." "Cyan"
                gcloud auth login --quiet
                Write-Color "gcloud CLI 인증 완료" "Green"

                # 프로젝트 설정
                Write-Color "gcloud 프로젝트 설정 중..." "Cyan"
                gcloud config set project $GCP_PROJECT_ID 2>$null
                Write-Color "프로젝트 설정: $GCP_PROJECT_ID" "Green"

                # ADC 인증 (MCP 서버용)
                Write-Host ""
                Write-Color "ADC 인증을 시작합니다. 브라우저에서 로그인하세요..." "Cyan"
                gcloud auth application-default login --quiet
                Write-Color "ADC 인증 완료" "Green"
                $script:SETUP_GEMINI = $true

                # ─────────────────────────────────────────────────────────────
                # Step 5-3: Stitch API 활성화
                # ─────────────────────────────────────────────────────────────
                Write-Host ""
                Write-Host "========================================" -ForegroundColor Yellow
                Write-Host "  Step 5-3: Stitch API 활성화" -ForegroundColor Yellow
                Write-Host "========================================" -ForegroundColor Yellow
                Write-Host ""
                Write-Host "  GCP 프로젝트에서 Stitch API를 활성화합니다."
                Write-Host ""

                $enableStitch = Read-Host "Stitch API를 활성화하시겠습니까? (Y/n)"
                if ($enableStitch -ne "n" -and $enableStitch -ne "N") {
                    Write-Color "Stitch API 활성화 중..." "Cyan"
                    try {
                        gcloud beta services mcp enable stitch.googleapis.com --project="$GCP_PROJECT_ID" 2>$null
                        Write-Color "Stitch API 활성화 완료" "Green"
                    } catch {
                        try {
                            gcloud services enable stitch.googleapis.com --project="$GCP_PROJECT_ID" 2>$null
                            Write-Color "Stitch API 활성화 완료" "Green"
                        } catch {
                            Write-Color "Stitch API 활성화 실패 - 수동으로 활성화하세요" "Yellow"
                            Write-Host "  https://console.cloud.google.com/apis/library/stitch.googleapis.com" -ForegroundColor Cyan
                        }
                    }
                } else {
                    Write-Color "Stitch API 활성화 건너뜀" "Yellow"
                }

                # ─────────────────────────────────────────────────────────────
                # Step 5-4: IAM 권한 부여
                # ─────────────────────────────────────────────────────────────
                Write-Host ""
                Write-Host "========================================" -ForegroundColor Yellow
                Write-Host "  Step 5-4: IAM 권한 부여" -ForegroundColor Yellow
                Write-Host "========================================" -ForegroundColor Yellow
                Write-Host ""
                Write-Host "  Stitch MCP 사용에 필요한 IAM 권한을 부여합니다."
                Write-Host "  (roles/serviceusage.serviceUsageConsumer)"
                Write-Host ""

                # 현재 인증된 사용자 이메일 가져오기
                $currentUser = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null | Select-Object -First 1

                if ($currentUser) {
                    Write-Host "  현재 인증된 계정: $currentUser" -ForegroundColor Cyan
                    $grantIam = Read-Host "이 계정에 IAM 권한을 부여하시겠습니까? (Y/n)"
                    if ($grantIam -ne "n" -and $grantIam -ne "N") {
                        Write-Color "IAM 권한 부여 중..." "Cyan"
                        try {
                            gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" `
                                --member="user:$currentUser" `
                                --role="roles/serviceusage.serviceUsageConsumer" `
                                --quiet 2>$null
                            Write-Color "IAM 권한 부여 완료" "Green"
                        } catch {
                            Write-Color "IAM 권한 부여 실패 - 수동으로 설정하세요" "Yellow"
                            Write-Host "  gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \" -ForegroundColor Gray
                            Write-Host "    --member=`"user:$currentUser`" \" -ForegroundColor Gray
                            Write-Host "    --role=`"roles/serviceusage.serviceUsageConsumer`"" -ForegroundColor Gray
                        }
                    } else {
                        Write-Color "IAM 권한 부여 건너뜀" "Yellow"
                    }
                } else {
                    Write-Color "인증된 계정을 찾을 수 없습니다. 수동으로 IAM 권한을 설정하세요." "Yellow"
                }
            }

            # ─────────────────────────────────────────────────────────────
            # Step 5-5: Stitch API Key (선택)
            # ─────────────────────────────────────────────────────────────
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host "  Step 5-5: Stitch API Key (선택)" -ForegroundColor Yellow
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Stitch MCP로 디자인 목업을 자동 생성하려면"
            Write-Host "  API Key가 필요합니다 (없으면 Enter로 건너뛰기)"
            Write-Host ""
            Write-Host "  https://stitch.withgoogle.com/settings" -ForegroundColor Cyan
            Write-Host ""

            $openStitch = Read-Host "브라우저에서 Stitch Settings를 열까요? (Y/n)"
            if ($openStitch -ne "n" -and $openStitch -ne "N") {
                Start-Process "https://stitch.withgoogle.com/settings"
            }

            Write-Host ""
            $script:STITCH_API_KEY = Read-Host "Stitch API Key (없으면 Enter)"

            if ($STITCH_API_KEY) {
                $script:SETUP_STITCH = $true
                Write-Color "Stitch API Key 입력 완료" "Green"
            } else {
                Write-Color "Stitch API Key 건너뜀 (Gemini MCP만 설정)" "Yellow"
            }
        }
    }

    # Confirm
    Write-Host ""
    Write-Color "설치 요약:" "Cyan"
    Write-Host "  위치: $TARGET_DIR"
    Write-Host "  카테고리: $SELECTED_CATEGORIES"
    Write-Host "  헌법: $SELECTED_CONSTITUTIONS"
    if ($SETUP_SLACK) { Write-Host "  Slack: 설정됨" }
    if ($SETUP_GEMINI) { Write-Host "  Gemini MCP: 설치 예정" }
    if ($SETUP_STITCH) { Write-Host "  Stitch MCP: 등록 예정" }
    Write-Host ""

    $confirm = Read-Host "설치를 진행하시겠습니까? (Y/n)"
    if ($confirm -eq "n" -or $confirm -eq "N") {
        Write-Color "설치가 취소되었습니다." "Yellow"
        exit 0
    }

    # Install
    Install-Skills
    Install-Constitutions
    Setup-SlackWebhook
    Setup-GitHubMCP
    Setup-GeminiMCP
    Setup-StitchMCP
    Install-CLIApp
    Show-Completion
}

# ============================================================================
# Installation Logic
# ============================================================================

function Install-Skills {
    Write-Host ""
    Write-Color "Installing Skills..." "Cyan"

    # Create directories
    New-Item -ItemType Directory -Force -Path "$TARGET_DIR\skills" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TARGET_DIR\agents" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TARGET_DIR\constitutions" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TARGET_DIR\docs" | Out-Null
    New-Item -ItemType Directory -Force -Path "$TARGET_DIR\commands" | Out-Null

    # Copy skills based on selection
    $skillsToCopy = @()

    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "1") {
        $skillsToCopy += "neurion", "socrates", "doubt", "screen-spec", "tasks-generator", "spike", "forge", "council"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "2") {
        $skillsToCopy += "auto-orchestrate", "harness", "harness-builder", "harness-evaluator", "harness-forge", "cmux-harness", "auto-planner"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "3") {
        $skillsToCopy += "code-review", "evaluation", "verification-before-completion", "powerqa", "trinity", "sync", "vercel-review", "audit"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "4") {
        $skillsToCopy += "systematic-debugging", "reflection", "reasoning"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "5") {
        $skillsToCopy += "fastapi-latest", "react-19", "rag"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "7") {
        $skillsToCopy += "memory", "chrome-browser", "deep-research", "reverse", "session-report", "skill-installer"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "8") {
        $skillsToCopy += "desktop-bridge"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "9") {
        $skillsToCopy += "token-optimizer", "cost-router"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "10") {
        $skillsToCopy += "eros", "eureka", "cogito", "odysseus", "poietes"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "11") {
        $skillsToCopy += "golang-pro", "python-pro", "typescript-pro"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "12") {
        $skillsToCopy += "kubernetes-specialist", "terraform-engineer", "database-optimizer"
    }
    if ($INSTALL_ALL -or $SELECTED_CATEGORIES -match "13") {
        $skillsToCopy += "autoresearch", "autoresearch-frontend", "autoresearch-skills"
    }

    # Always include essential skills
    $skillsToCopy += "project-bootstrap", "project-bootstrap-supabase", "design-linker"
    $skillsToCopy = $skillsToCopy | Select-Object -Unique

    foreach ($skill in $skillsToCopy) {
        $source = "$SCRIPT_DIR\.claude\skills\$skill"
        if (Test-Path $source) {
            Write-Host "  Installing $skill..." -NoNewline
            Copy-Item -Recurse -Force $source "$TARGET_DIR\skills\$skill"
            Write-Color " Done" "Green"
        }
    }

    # Install agents, docs, commands
    Write-Host "  Installing agents..." -NoNewline
    Copy-Item -Recurse -Force "$SCRIPT_DIR\.claude\agents\*" "$TARGET_DIR\agents\"
    Write-Color " Done" "Green"

    Write-Host "  Installing docs..." -NoNewline
    Copy-Item -Recurse -Force "$SCRIPT_DIR\.claude\docs\*" "$TARGET_DIR\docs\"
    Write-Color " Done" "Green"

    Write-Host "  Installing commands..." -NoNewline
    Copy-Item -Recurse -Force "$SCRIPT_DIR\.claude\commands\*" "$TARGET_DIR\commands\"
    Write-Color " Done" "Green"

    # Install hooks
    if (Test-Path "$SCRIPT_DIR\.claude\hooks") {
        New-Item -ItemType Directory -Force -Path "$TARGET_DIR\hooks" | Out-Null
        Write-Host "  Installing hooks..." -NoNewline
        Copy-Item -Recurse -Force "$SCRIPT_DIR\.claude\hooks\*" "$TARGET_DIR\hooks\"
        Write-Color " Done" "Green"

        # Merge hooks settings from project settings.json into target settings.json
        Merge-HooksSettings
    }

    Write-Color "Skills installation complete!" "Green"
}

function Merge-HooksSettings {
    $srcSettings = "$SCRIPT_DIR\.claude\settings.json"
    $dstSettings = "$TARGET_DIR\settings.json"

    if (-not (Test-Path $srcSettings)) {
        return
    }

    Write-Host "  Merging hooks settings..." -NoNewline

    try {
        $srcJson = Get-Content $srcSettings -Raw | ConvertFrom-Json

        if (Test-Path $dstSettings) {
            # Backup existing
            $backup = "$dstSettings.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item $dstSettings $backup -ErrorAction SilentlyContinue

            # Load existing settings and replace hooks section (preserve other keys)
            $dstJson = Get-Content $dstSettings -Raw | ConvertFrom-Json
            if ($dstJson.PSObject.Properties.Name -contains "hooks") {
                $dstJson.hooks = $srcJson.hooks
            } else {
                $dstJson | Add-Member -NotePropertyName "hooks" -NotePropertyValue $srcJson.hooks -Force
            }
            $dstJson | ConvertTo-Json -Depth 20 | Set-Content $dstSettings -Encoding UTF8
            Write-Color " Merged" "Green"
        } else {
            # Create new settings.json with only hooks section
            @{ hooks = $srcJson.hooks } | ConvertTo-Json -Depth 20 | Set-Content $dstSettings -Encoding UTF8
            Write-Color " Created" "Green"
        }
    } catch {
        Write-Color " Failed: $_" "Yellow"
        Write-Host "    Manual merge required: $srcSettings -> $dstSettings" -ForegroundColor Yellow
    }
}

function Install-Constitutions {
    Write-Host ""
    Write-Color "Installing Constitutions..." "Cyan"

    $constToCopy = @()

    if ($INSTALL_ALL_CONST -or $SELECTED_CONSTITUTIONS -match "1") {
        $constToCopy += "fastapi"
    }
    if ($INSTALL_ALL_CONST -or $SELECTED_CONSTITUTIONS -match "2") {
        $constToCopy += "nextjs"
    }
    if ($INSTALL_ALL_CONST -or $SELECTED_CONSTITUTIONS -match "3") {
        $constToCopy += "supabase"
    }
    if ($INSTALL_ALL_CONST -or $SELECTED_CONSTITUTIONS -match "4") {
        $constToCopy += "tailwind"
    }
    if ($INSTALL_ALL_CONST -or $SELECTED_CONSTITUTIONS -match "5") {
        $constToCopy += "common"
    }

    foreach ($const in $constToCopy) {
        $source = "$SCRIPT_DIR\.claude\constitutions\$const"
        if (Test-Path $source) {
            Write-Host "  Installing $const constitution..." -NoNewline
            Copy-Item -Recurse -Force $source "$TARGET_DIR\constitutions\$const"
            Write-Color " Done" "Green"
        }
    }

    # Copy README
    Copy-Item -Force "$SCRIPT_DIR\.claude\constitutions\README.md" "$TARGET_DIR\constitutions\" -ErrorAction SilentlyContinue

    Write-Color "Constitutions installation complete!" "Green"
}

function Setup-SlackWebhook {
    if ($SETUP_SLACK -and $SLACK_WEBHOOK) {
        Write-Host ""
        Write-Color "Configuring Slack Webhook..." "Cyan"

        $settingsFile = "$TARGET_DIR\settings.json"

        if (Test-Path $settingsFile) {
            $settings = Get-Content $settingsFile | ConvertFrom-Json
            $settings | Add-Member -NotePropertyName "slack_webhook" -NotePropertyValue $SLACK_WEBHOOK -Force
            $settings | ConvertTo-Json | Set-Content $settingsFile
        } else {
            @{ slack_webhook = $SLACK_WEBHOOK } | ConvertTo-Json | Set-Content $settingsFile
        }

        Write-Color "Slack webhook configured!" "Green"
    }
}

function Setup-GitHubMCP {
    if ($SETUP_GITHUB_MCP -and $GITHUB_TOKEN) {
        Write-Host ""
        Write-Color "Setting up GitHub MCP Server..." "Cyan"
        Write-Host ""

        $settingsFile = "$GLOBAL_CLAUDE_DIR\settings.json"
        New-Item -ItemType Directory -Force -Path $GLOBAL_CLAUDE_DIR | Out-Null

        $githubMcpConfig = @{
            command = "npx"
            args = @("-y", "@modelcontextprotocol/server-github")
            env = @{
                GITHUB_PERSONAL_ACCESS_TOKEN = $GITHUB_TOKEN
            }
        }

        if (Test-Path $settingsFile) {
            $settings = Get-Content $settingsFile | ConvertFrom-Json
            if (-not $settings.mcpServers) {
                $settings | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
            }
            $settings.mcpServers | Add-Member -NotePropertyName "github" -NotePropertyValue $githubMcpConfig -Force
            $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsFile
        } else {
            @{
                mcpServers = @{
                    github = $githubMcpConfig
                }
            } | ConvertTo-Json -Depth 10 | Set-Content $settingsFile
        }

        Write-Color "GitHub MCP configured!" "Green"
    }
}

function Setup-GeminiMCP {
    if ($SETUP_GEMINI) {
        Write-Host ""
        Write-Color "Installing Gemini MCP Server (Node.js + OAuth)..." "Cyan"
        Write-Host ""

        # ⚠️ Gemini MCP는 OAuth 인증 사용 (API 키 절대 금지)
        # gemini CLI가 OAuth를 처리하고, Node.js MCP 서버가 이를 래핑함

        $mcpDir = "$GLOBAL_CLAUDE_DIR\mcp-servers\gemini-mcp"
        New-Item -ItemType Directory -Force -Path "$GLOBAL_CLAUDE_DIR\mcp-servers" | Out-Null

        # Step 1: Check gemini CLI (Google 공식 CLI - OAuth 담당)
        Write-Host "  [1/3] gemini CLI 확인..."
        $geminiCmd = Get-Command gemini -ErrorAction SilentlyContinue
        if (-not $geminiCmd) {
            Write-Color "  gemini CLI가 설치되어 있지 않습니다." "Yellow"
            Write-Host ""
            Write-Host "  Google gemini CLI 설치 방법:" -ForegroundColor Cyan
            Write-Host "    npm install -g @google/gemini-cli"
            Write-Host ""
            Write-Host "  또는 https://ai.google.dev/gemini-api/docs/downloads 에서 다운로드"
            Write-Host ""

            $installGemini = Read-Host "  npm으로 gemini CLI를 설치하시겠습니까? (Y/n)"
            if ($installGemini -ne "n" -and $installGemini -ne "N") {
                Write-Host "  gemini CLI 설치 중..."
                npm install -g @google/gemini-cli 2>$null
                if ($LASTEXITCODE -ne 0) {
                    Write-Color "  gemini CLI 설치 실패!" "Red"
                    Write-Host "  수동 설치 후 다시 시도하세요."
                    return
                }
                Write-Color "  gemini CLI 설치 완료!" "Green"
            } else {
                Write-Color "  gemini CLI 없이는 Gemini MCP를 사용할 수 없습니다." "Red"
                return
            }
        } else {
            Write-Color "  gemini CLI 발견!" "Green"
        }

        # Step 2: OAuth 인증 (gemini CLI가 처리)
        Write-Host "  [2/3] OAuth 인증..."
        Write-Host ""
        Write-Color "  Google OAuth 인증을 시작합니다." "Magenta"
        Write-Host "  브라우저가 열리면 Google 계정으로 로그인하세요."
        Write-Host "  (이미 인증했다면 바로 완료됩니다)"
        Write-Host ""

        $runAuth = Read-Host "  OAuth 인증을 진행하시겠습니까? (Y/n)"
        if ($runAuth -ne "n" -and $runAuth -ne "N") {
            # gemini --version으로 CLI 동작만 확인 (인터랙티브 모드 진입 방지)
            try {
                $versionResult = & gemini --version 2>&1 | Out-String
                if ($versionResult -and $versionResult.Trim()) {
                    Write-Color "  gemini CLI 확인: $($versionResult.Trim())" "Green"
                }
            } catch {
                Write-Color "  gemini CLI 버전 확인 실패" "Yellow"
            }

            Write-Host ""
            Write-Host "  새 터미널에서 gemini를 실행하여 OAuth 인증을 진행합니다." -ForegroundColor Cyan
            Write-Host "  브라우저에서 Google 로그인 후, gemini 창을 닫으세요." -ForegroundColor Cyan
            Write-Host ""

            # 새 터미널에서 gemini 실행 (현재 스크립트 차단 방지)
            Start-Process "cmd.exe" -ArgumentList "/k", "gemini"

            Read-Host "  인증 완료 후 Enter를 누르세요"
            Write-Color "  OAuth 인증 완료!" "Green"
        }

        # Step 3: Node.js MCP 서버 복사 및 등록
        Write-Host "  [3/3] MCP 서버 설치..."

        # 소스 복사 (여러 경로에서 탐색)
        $sourceDir = $null
        $path1 = "$PSScriptRoot\mcp-servers\gemini-mcp"
        $path2 = "$PSScriptRoot\.claude\mcp-servers\gemini-mcp"

        if (Test-Path $path1) {
            $sourceDir = $path1
        } elseif (Test-Path $path2) {
            $sourceDir = $path2
        }

        if ($sourceDir) {
            # 기존 설치 삭제
            if (Test-Path $mcpDir) {
                Remove-Item -Recurse -Force $mcpDir
            }
            Copy-Item -Recurse -Force $sourceDir $mcpDir
            Write-Color "  MCP 서버 복사 완료!" "Green"
        } else {
            Write-Color "  gemini-mcp 소스를 찾을 수 없습니다." "Red"
            Write-Host "  탐색 경로:"
            Write-Host "    - $path1"
            Write-Host "    - $path2"
            return
        }

        # MCP 등록
        $indexJs = "$mcpDir\index.js"
        if (-not (Test-Path $indexJs)) {
            Write-Color "  index.js를 찾을 수 없습니다." "Red"
            return
        }

        $claudeJsonPath = "$env:USERPROFILE\.claude.json"
        $geminiConfig = @{
            command = "node"
            args = @($indexJs)
        }

        $registered = $false
        try {
            if (Test-Path $claudeJsonPath) {
                $claudeConfig = Get-Content $claudeJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
            } else {
                $claudeConfig = @{}
            }

            if (-not $claudeConfig.mcpServers) {
                $claudeConfig | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
            }

            $claudeConfig.mcpServers | Add-Member -NotePropertyName "gemini" -NotePropertyValue $geminiConfig -Force
            $claudeConfig | ConvertTo-Json -Depth 10 | Set-Content $claudeJsonPath -Encoding UTF8
            $registered = $true
        } catch {
            Write-Color "JSON 파싱 실패 - CLI로 재시도..." "Yellow"
            try {
                claude mcp remove --scope user gemini 2>$null
                $geminiJson = $geminiConfig | ConvertTo-Json -Compress -Depth 3
                $escapedJson = $geminiJson -replace '"', '\"'
                $result = cmd /c "claude mcp add-json --scope user gemini `"$escapedJson`"" 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $registered = $true
                }
            } catch {
                # CLI fallback also failed
            }
        }

        if ($registered) {
            Write-Color "  Gemini MCP 등록 완료! (OAuth 인증 방식)" "Green"
        } else {
            Write-Color "  Gemini MCP 등록 실패 - 수동 등록이 필요합니다" "Red"
            Write-Host "  claude mcp add-json --scope user gemini '<config>'"
        }
    }
}

function Setup-StitchMCP {
    if ($SETUP_STITCH -and $GCP_PROJECT_ID) {
        Write-Host ""
        Write-Color "Configuring Stitch MCP Server..." "Cyan"

        # Register Stitch MCP directly to ~/.claude.json (PowerShell quote escaping issues with CLI)
        $claudeJsonPath = "$env:USERPROFILE\.claude.json"

        if ($STITCH_API_KEY) {
            $stitchConfig = @{
                command = "npx"
                args = @("-y", "stitch-mcp")
                env = @{
                    GOOGLE_CLOUD_PROJECT = $GCP_PROJECT_ID
                    STITCH_API_KEY = $STITCH_API_KEY
                }
            }
        } else {
            $stitchConfig = @{
                command = "npx"
                args = @("-y", "stitch-mcp")
                env = @{
                    GOOGLE_CLOUD_PROJECT = $GCP_PROJECT_ID
                }
            }
        }

        $registered = $false
        try {
            if (Test-Path $claudeJsonPath) {
                $claudeConfig = Get-Content $claudeJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
            } else {
                $claudeConfig = @{}
            }

            if (-not $claudeConfig.mcpServers) {
                $claudeConfig | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
            }

            $claudeConfig.mcpServers | Add-Member -NotePropertyName "stitch" -NotePropertyValue $stitchConfig -Force
            $claudeConfig | ConvertTo-Json -Depth 10 | Set-Content $claudeJsonPath -Encoding UTF8
            $registered = $true
        } catch {
            Write-Color "JSON 파싱 실패 - CLI로 재시도..." "Yellow"
            # Fallback: use claude mcp add-json CLI
            try {
                claude mcp remove --scope user stitch 2>$null
                $stitchJson = $stitchConfig | ConvertTo-Json -Compress -Depth 3
                # Windows에서 JSON 이스케이프
                $escapedJson = $stitchJson -replace '"', '\"'
                $result = cmd /c "claude mcp add-json --scope user stitch `"$escapedJson`"" 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $registered = $true
                }
            } catch {
                # Silent fail, will show manual instructions
            }
        }

        if ($registered) {
            if ($STITCH_API_KEY) {
                Write-Color "Stitch MCP 등록 완료 (API Key 포함, user scope)" "Green"
            } else {
                Write-Color "Stitch MCP 등록됨 (API Key 미설정, user scope)" "Yellow"
            }
        } else {
            Write-Color "자동 등록 실패 - 수동 등록 필요:" "Yellow"
            Write-Host "  claude mcp add --scope user stitch -- npx -y stitch-mcp"
            Write-Host "  그 후 ~/.claude.json에서 env 추가"
        }
        Write-Host ""
        Write-Host "  첫 사용 시 Google Cloud 인증이 필요합니다:" -ForegroundColor Yellow
        Write-Host "    1. gcloud auth login"
        Write-Host "    2. gcloud auth application-default login"
        Write-Host ""
        Write-Color "/screen-spec Phase 5 실행 시 자동 안내됩니다." "Cyan"
    }
}

function Install-CLIApp {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Step 7: clabs CLI 앱 설치 (선택사항)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    # Git Bash 설치 확인 (clabs 앱 실행에 필요)
    $gitBashPaths = @(
        "C:\Program Files\Git\bin\bash.exe",
        "C:\Program Files (x86)\Git\bin\bash.exe",
        "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe",
        "C:\Git\bin\bash.exe"
    )
    $gitFound = $false
    foreach ($path in $gitBashPaths) {
        if (Test-Path $path) {
            $gitFound = $true
            Write-Color "✅ Git Bash 발견: $path" "Green"
            break
        }
    }

    if (-not $gitFound) {
        Write-Color "⚠️  Git Bash가 설치되어 있지 않습니다!" "Yellow"
        Write-Host ""
        Write-Host "  clabs 앱은 Git Bash를 사용하여 터미널을 실행합니다." -ForegroundColor Gray
        Write-Host "  Git을 먼저 설치해주세요:" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  👉 https://git-scm.com/download/win" -ForegroundColor Cyan
        Write-Host ""

        $installGit = Read-Host "Git 다운로드 페이지를 열까요? (Y/n)"
        if ($installGit -ne "n" -and $installGit -ne "N") {
            Start-Process "https://git-scm.com/download/win"
            Write-Host ""
            Write-Color "⏸️  Git 설치 후 install.ps1을 다시 실행해주세요." "Yellow"
            return
        } else {
            Write-Color "⏭️  Git 없이 계속합니다 (앱이 제대로 작동하지 않을 수 있음)" "Yellow"
        }
    }
    Write-Host ""

    # CPU 아키텍처 감지 (ARM64 vs x64)
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq "ARM64") {
        $archSuffix = "arm64"
        Write-Color "🔍 ARM64 아키텍처 감지됨" "Cyan"
    } else {
        $archSuffix = "x64"
        Write-Color "🔍 x64 아키텍처 감지됨" "Cyan"
    }

    # 아키텍처별 설치 파일 경로
    $installerPath = "$SCRIPT_DIR\Claude-Labs-v$VERSION-Setup-$archSuffix.exe"

    # 아키텍처별 파일이 없으면 범용 파일 시도
    if (-not (Test-Path $installerPath)) {
        $installerPath = "$SCRIPT_DIR\Claude-Labs-v$VERSION-Setup.exe"
    }

    if (-not (Test-Path $installerPath)) {
        Write-Color "⏭️  EXE 파일을 찾을 수 없습니다" "Yellow"
        Write-Host "   - Claude-Labs-v$VERSION-Setup-$archSuffix.exe" -ForegroundColor Gray
        Write-Host "   - Claude-Labs-v$VERSION-Setup.exe" -ForegroundColor Gray
        return
    }

    Write-Color "📦 설치 파일: $(Split-Path $installerPath -Leaf)" "Gray"

    Write-Host "  clabs는 Claude Labs 스킬팩을 위한 GUI 앱입니다." -ForegroundColor Gray
    Write-Host "  터미널 없이도 스킬을 실행하고 관리할 수 있습니다." -ForegroundColor Gray
    Write-Host ""

    $installCli = Read-Host "clabs CLI 앱을 설치하시겠습니까? (Y/n)"
    if ($installCli -eq "n" -or $installCli -eq "N") {
        Write-Color "⏭️  CLI 앱 설치 건너뜀" "Yellow"
        return
    }

    Write-Host ""
    Write-Color "📦 clabs 앱 설치 중..." "Cyan"
    Write-Host ""

    # Run installer (silent mode)
    try {
        $process = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
        if ($process.ExitCode -eq 0) {
            Write-Color "✅ clabs가 설치되었습니다" "Green"
            Write-Host ""

            $launchApp = Read-Host "지금 Clabs를 실행하시겠습니까? (Y/n)"
            if ($launchApp -ne "n" -and $launchApp -ne "N") {
                # NSIS per-user install location (productName: Clabs)
                $appPath = "$env:LOCALAPPDATA\Programs\Clabs\Clabs.exe"
                if (Test-Path $appPath) {
                    Start-Process $appPath
                } else {
                    # per-machine install location
                    $altPath = "$env:ProgramFiles\Clabs\Clabs.exe"
                    if (Test-Path $altPath) {
                        Start-Process $altPath
                    } else {
                        # Try x86 Program Files
                        $altPath2 = "${env:ProgramFiles(x86)}\Clabs\Clabs.exe"
                        if (Test-Path $altPath2) {
                            Start-Process $altPath2
                        } else {
                            Write-Color "앱 경로를 찾을 수 없습니다. 시작 메뉴에서 Clabs를 검색하세요." "Yellow"
                        }
                    }
                }
            }
        } else {
            Write-Color "❌ 설치 실패 (Exit code: $($process.ExitCode))" "Red"
        }
    } catch {
        Write-Color "❌ 설치 중 오류 발생: $_" "Red"
    }
}

function Show-Completion {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Installation Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Location: $TARGET_DIR"

    $skillCount = (Get-ChildItem "$TARGET_DIR\skills" -Directory -ErrorAction SilentlyContinue).Count
    $constCount = (Get-ChildItem "$TARGET_DIR\constitutions" -Recurse -Filter "*.md" -ErrorAction SilentlyContinue).Count
    Write-Host "  Skills: $skillCount"
    Write-Host "  Constitutions: $constCount"

    # Check MCP status
    Write-Host ""
    Write-Color "MCP 설정 상태:" "Cyan"
    Write-Host ""

    $mcpStitch = "X 미설정"
    $mcpGemini = "X 미설정"
    $mcpContext7 = "X 미설정"

    # Check MCP status via claude mcp list (reads from ~/.claude.json)
    if ($script:HAS_CLAUDE_CLI) {
        $mcpList = claude mcp list 2>&1 | Out-String
        if ($mcpList -match 'stitch.*Connected') { $mcpStitch = "O 설정됨" }
        if ($mcpList -match 'gemini.*Connected') { $mcpGemini = "O 설정됨" }
        if ($mcpList -match 'context7.*Connected') { $mcpContext7 = "O 설정됨" }
    } else {
        $mcpStitch = "? CLI 없음"
        $mcpGemini = "? CLI 없음"
        $mcpContext7 = "? CLI 없음"
    }

    Write-Host "  Stitch MCP:   $mcpStitch" -ForegroundColor $(if ($mcpStitch -match "설정됨") { "Green" } else { "Yellow" })
    Write-Host "    -> /screen-spec Phase 5 디자인 자동 생성"
    Write-Host ""
    Write-Host "  Gemini MCP:   $mcpGemini" -ForegroundColor $(if ($mcpGemini -match "설정됨") { "Green" } else { "Yellow" })
    Write-Host "    -> 프론트엔드 디자인 코딩 지원"
    Write-Host ""
    Write-Host "  Context7 MCP: $mcpContext7" -ForegroundColor $(if ($mcpContext7 -match "설정됨") { "Green" } else { "Yellow" })
    Write-Host "    -> 최신 라이브러리 문서 검색"

    # Show Stitch setup guide (API Key - simple!)
    if ($mcpStitch -match "미설정") {
        Write-Host ""
        Write-Host "----------------------------------------" -ForegroundColor Yellow
        Write-Color "Stitch MCP 설정 (API Key로 간단!)" "Yellow"
        Write-Host "----------------------------------------" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  1. API Key 생성:"
        Write-Host "     https://stitch.withgoogle.com/settings" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  2. 인스톨러 재실행:"
        Write-Host "     > .\install.ps1 -> Stitch MCP 선택 -> API Key 입력"
        Write-Host ""
    }

    # Show Gemini setup guide (ADC required)
    if ($mcpGemini -match "미설정") {
        Write-Host ""
        Write-Host "----------------------------------------" -ForegroundColor Cyan
        Write-Color "Gemini MCP 설정 가이드 (gcloud 필요)" "Cyan"
        Write-Host "----------------------------------------" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Step 1: gcloud CLI 설치"
        Write-Host "    https://cloud.google.com/sdk/docs/install"
        Write-Host ""
        Write-Host "  Step 2: ADC 인증"
        Write-Host "    > gcloud auth application-default login"
        Write-Host "    -> 브라우저에서 Google 로그인"
        Write-Host ""
        Write-Host "  Step 3: 인스톨러 재실행"
        Write-Host "    > .\install.ps1 -> Gemini MCP 선택"
        Write-Host ""
    }

    Write-Host ""
    Write-Color "Next Steps:" "Cyan"
    Write-Host ""
    Write-Host "  1. Claude Code 실행:"
    Write-Host "     > claude"
    Write-Host ""
    Write-Host "  2. 소크라테스로 기획 시작:"
    Write-Host "     > /socrates"
    Write-Host ""
    Write-Host "  3. 기획 완료 후 화면 명세:"
    Write-Host "     > /screen-spec"
    Write-Host ""
    Write-Host "  4. 태스크 생성 및 실행:"
    Write-Host "     > /tasks-generator"
    Write-Host "     > /auto-orchestrate"
    Write-Host ""

    # Copy to clipboard
    Set-Clipboard -Value "/socrates"
    Write-Color "/socrates 가 클립보드에 복사되었습니다." "Cyan"
}

# ============================================================================
# Gum Mode (with gum)
# ============================================================================

function Gum-Install {
    Clear-Host

    # Banner
    gum style --foreground 212 --border-foreground 212 --border double `
        --align center --width 60 --margin "1 2" --padding "1 2" `
        "🧪 Claude Labs v$VERSION" "" "아이디어만으로 풀스택 웹앱을 완성하는 AI 개발 파트너"

    # Step 1: Install scope
    Write-Host ""
    gum style --foreground 39 "Step 1: 설치 위치 선택"

    $scope = gum choose --cursor.foreground 212 `
        "전역 설치 (~/.claude/) - 모든 프로젝트에서 사용" `
        "프로젝트 설치 (./.claude/) - 현재 프로젝트만"

    if ($scope -match "전역") {
        $script:TARGET_DIR = $GLOBAL_CLAUDE_DIR
    } else {
        $script:TARGET_DIR = $LOCAL_CLAUDE_DIR
    }

    # Step 2: Skill categories
    Write-Host ""
    gum style --foreground 39 "Step 2: 스킬 카테고리 선택"

    $categories = gum choose --no-limit --cursor.foreground 212 `
        "Core - neurion, socrates, doubt, screen-spec, tasks-generator, spike (필수 추천)" `
        "Orchestration - auto-orchestrate, harness, harness-forge, cmux-harness" `
        "Quality - code-review, evaluation, audit, trinity" `
        "Debug - systematic-debugging, reflection, reasoning" `
        "Reference - fastapi-latest, react-19, rag" `
        "Utility - memory, chrome-browser, session-report, skill-installer" `
        "All - 모든 스킬 설치"

    $script:INSTALL_ALL = $categories -match "All"
    $script:SELECTED_CATEGORIES = $categories

    # Step 3: Constitutions
    Write-Host ""
    gum style --foreground 39 "Step 3: 프레임워크 헌법 선택"

    $constitutions = gum choose --no-limit --cursor.foreground 212 `
        "FastAPI - Python 백엔드" `
        "Next.js - React 프레임워크" `
        "Supabase - BaaS" `
        "Tailwind CSS - CSS 프레임워크" `
        "Common - 공통 규칙" `
        "All - 모든 헌법 설치"

    $script:INSTALL_ALL_CONST = $constitutions -match "All"
    $script:SELECTED_CONSTITUTIONS = $constitutions

    # Step 4: Slack
    Write-Host ""
    gum style --foreground 39 "Step 4: Slack 웹훅 설정 (선택사항)"

    $slackAnswer = Read-Host "Slack 알림을 설정하시겠습니까? (y/n)"
    if ($slackAnswer -eq "y") {
        $script:SLACK_WEBHOOK = gum input --placeholder "https://hooks.slack.com/services/..."
        $script:SETUP_SLACK = $true
    } else {
        $script:SETUP_SLACK = $false
    }

    # Step 5: Gemini
    Write-Host ""
    gum style --foreground 39 "Step 5: Gemini MCP 서버 설정 (선택사항)"
    gum style --foreground 252 --italic "Gemini MCP는 OAuth 인증을 사용합니다."

    $geminiAnswer = Read-Host "Gemini MCP를 설치하시겠습니까? (y/n)"
    $script:SETUP_GEMINI = ($geminiAnswer -eq "y")

    # Step 6: Stitch
    Write-Host ""
    gum style --foreground 39 "Step 6: Google Stitch MCP 서버 설정 (선택사항)"
    gum style --foreground 252 --italic "Stitch MCP는 YAML 화면 명세에서 디자인 목업을 자동 생성합니다."

    $stitchAnswer = Read-Host "Stitch MCP를 설치하시겠습니까? (y/n)"
    $script:SETUP_STITCH = ($stitchAnswer -eq "y")

    # Confirm and install
    Write-Host ""
    $installAnswer = Read-Host "설치를 진행하시겠습니까? (y/n)"
    if ($installAnswer -eq "y") {
        Install-Skills
        Install-Constitutions
        Setup-SlackWebhook
        Setup-GeminiMCP
        Setup-StitchMCP
        Install-CLIApp
        Show-Completion
    } else {
        Write-Color "설치가 취소되었습니다." "Yellow"
    }
}

# ============================================================================
# Main
# ============================================================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Claude Labs v$VERSION 인스톨러 시작" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

# 필수 의존성 체크
Write-Host "[DEBUG] Check-Git 호출..." -ForegroundColor Gray
Check-Git

Write-Host "[DEBUG] Check-NodeJS 호출..." -ForegroundColor Gray
Check-NodeJS

Write-Host "[DEBUG] Check-ClaudeCLI 호출..." -ForegroundColor Gray
$script:HAS_CLAUDE_CLI = Check-ClaudeCLI
Write-Host "[DEBUG] Check-ClaudeCLI 완료. 결과: $script:HAS_CLAUDE_CLI" -ForegroundColor Gray

Write-Host "[DEBUG] Check-Gum 호출..." -ForegroundColor Gray
$hasGum = Check-Gum

if ($hasGum) {
    Gum-Install
} else {
    Simple-Install
}
