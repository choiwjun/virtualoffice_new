@echo off
cd /d "%~dp0..\..\realtime"
rem 클라 씬 정본(D35 V3)과 같은 층. horizon은 구 다이아 legacy — 대응 렌더가 없어 좌표가 어긋난다.
set SCENE_FLOOR=v3
set LAYOUT_SOURCE_URL=http://127.0.0.1:8000
set PRESENCE_SINK_URL=http://127.0.0.1:8000
set PRESENCE_SINK_TOKEN=dev-internal-token-CHANGE-IN-PRODUCTION
call npm run dev
