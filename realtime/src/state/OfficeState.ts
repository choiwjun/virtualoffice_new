import { Schema, MapSchema, type } from "@colyseus/schema";
import { Player } from "./Player";

/**
 * OfficeState — the synced room state for one floor.
 *
 * `players` is keyed by Colyseus sessionId. Player.userId holds the stable ERP
 * identity used across reconnects.
 *
 * Colyseus broadcasts binary deltas of this state to all clients every tick,
 * which is the primary `world_update` channel (15-realtime-server-spec §3).
 */
export class OfficeState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();

  /** Monotonic server sequence, bumped each tick — mirrors 09 §5.3 server_seq. */
  @type("number") serverSeq = 0;
}

export { Player };
