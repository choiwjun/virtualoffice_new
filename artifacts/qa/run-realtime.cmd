@echo off
cd /d "%~dp0..\..\realtime"
set SCENE_FLOOR=horizon
set LAYOUT_SOURCE_URL=http://127.0.0.1:8000
set PRESENCE_SINK_URL=http://127.0.0.1:8000
set PRESENCE_SINK_TOKEN=dev-internal-token-CHANGE-IN-PRODUCTION
call npm run dev
