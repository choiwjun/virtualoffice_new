/**
 * index.ts — realtime office server bootstrap.
 *
 * Creates a Colyseus Server on the ws transport, registers OfficeRoom (keyed by
 * {officeId, floorId} so each floor is its own room), and listens on PORT
 * (default 2567, internal WSS behind Caddy — 15-realtime-server-spec §8).
 */

import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { OfficeRoom } from "./rooms/OfficeRoom";
import { PORT, assertProductionSafe } from "./config";

// 운영 기동 가드(P1-4): production + 무인증 join/dev 시크릿 조합은 fail-fast.
assertProductionSafe();

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: createServer(),
  }),
});

// Room = one floor of one company. filterBy가 클라이언트를 맞는 방으로 라우팅하고,
// 없으면 Colyseus가 즉석 생성한다.
//
// companyId를 키에 포함하는 이유(22 T0-1): floorId가 어떤 경로로든 새어나가도 서로 다른
// 테넌트가 같은 방에 합류하지 않는다. 클라가 companyId를 위조해 남의 방으로 라우팅되더라도
// OfficeRoom.onAuth가 JWT의 company_id와 방의 회사를 대조해 거부한다(2중 방어).
gameServer
  .define("office", OfficeRoom)
  .filterBy(["companyId", "officeId", "floorId"]);

gameServer
  .listen(PORT)
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`[realtime] OfficeRoom server listening on ws://0.0.0.0:${PORT} (room=office, keyed by office_id+floor_id)`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[realtime] failed to start:", err);
    process.exit(1);
  });

export { gameServer };
