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
import { PORT } from "./config";

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: createServer(),
  }),
});

// Room = one floor. filterBy({officeId, floorId}) routes clients to the room
// that matches their floor; if none exists Colyseus creates one on demand.
gameServer
  .define("office", OfficeRoom)
  .filterBy(["officeId", "floorId"]);

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
