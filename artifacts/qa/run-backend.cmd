@echo off
cd /d "%~dp0..\..\backend"
set DATABASE_URL=sqlite+aiosqlite:///./dev_qa.db
set INTERNAL_API_TOKEN=dev-internal-token-CHANGE-IN-PRODUCTION
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
