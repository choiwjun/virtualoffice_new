# 가상오피스 실시간 이동서버 (Colyseus/Node) — D29/D30 단일 통합 스택 (P0-1, 2026-07-17)
# 정본: 15-realtime-server-spec.md. WA 스택 폐기 후 이 서비스가 실시간 계층 담당.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build            # tsc → dist/

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

EXPOSE 2567
# 헬스체크: Colyseus는 HTTP GET /에 200 응답(monitor 미장착 시에도 소켓 오픈)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:2567/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
