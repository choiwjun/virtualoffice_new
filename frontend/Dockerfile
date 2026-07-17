# 가상오피스 웹콘솔 (Next.js 14) — D29/D30 단일 통합 스택 (P0-1, 2026-07-17)
# NEXT_PUBLIC_* 는 빌드타임에 번들에 각인되므로 build-arg로 주입한다.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 공개 API/실시간 엔드포인트(브라우저가 접근할 공개 URL) — compose build.args로 주입
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_REALTIME_URL
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build            # output: 'standalone' → .next/standalone

FROM node:20-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
WORKDIR /app
# standalone 번들 + 정적 에셋
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/login',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
