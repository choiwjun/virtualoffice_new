# 가상오피스 백엔드 (FastAPI) — 사내 로컬 서버 PC용 컨테이너
# 정본: 11-tech-stack.md (Python 3.11, uvicorn), 배포=Docker Compose(사내 온프렘)

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 의존성 레이어 캐시: requirements 먼저 복사
COPY requirements.txt ./
RUN pip install -r requirements.txt

# 앱 소스
COPY app ./app

EXPOSE 8000

# 헬스체크 (slim 이미지에 curl 없음 → python 표준 라이브러리 사용)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
