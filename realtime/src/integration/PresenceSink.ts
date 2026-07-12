/**
 * PresenceSink — the seam that pushes presence deltas from Colyseus (memory
 * authority) to FastAPI for persistence.
 *
 * Spec seam: 15-realtime-server-spec §6 / D3 — Colyseus batches changed presence
 * every 1–5s and POSTs to FastAPI `/api/presence/batch`, which alone writes the
 * DB. Colyseus never touches the DB directly.
 *
 * Default impl = ConsolePresenceSink (logs the batch). HttpPresenceSink is
 * enabled only when PRESENCE_SINK_URL is set.
 */

export interface PresenceRecord {
  userId: string;
  officeId: string;
  floorId: string;
  x: number;
  y: number;
  status: string;
  seatId: string;
  timestamp: number;
}

export interface PresenceSink {
  /** Push a batch of changed presence records. Must not throw fatally. */
  push(batch: PresenceRecord[]): Promise<void>;
}

/** Default no-op-ish sink: logs the batch to console. */
export class ConsolePresenceSink implements PresenceSink {
  async push(batch: PresenceRecord[]): Promise<void> {
    if (batch.length === 0) return;
    // eslint-disable-next-line no-console
    console.log(
      `[PresenceSink:console] batch of ${batch.length}:`,
      batch.map((r) => `${r.userId}=${r.status}@(${r.x.toFixed(1)},${r.y.toFixed(1)})`).join(", ")
    );
  }
}

/**
 * HttpPresenceSink — POSTs to FastAPI `POST /api/presence/batch`.
 * Uses Node 18+ global fetch. Failures are logged, not thrown, so a flaky
 * backend never crashes the realtime tick loop (fault isolation, 09 risk note).
 */
export class HttpPresenceSink implements PresenceSink {
  constructor(private readonly url: string) {}

  async push(batch: PresenceRecord[]): Promise<void> {
    if (batch.length === 0) return;
    try {
      const res = await fetch(`${this.url}/api/presence/batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: batch }),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[PresenceSink:http] non-OK ${res.status} for batch of ${batch.length}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[PresenceSink:http] push failed (batch of ${batch.length}):`, (err as Error).message);
    }
  }
}

/** Factory: HttpPresenceSink when PRESENCE_SINK_URL set, else ConsolePresenceSink. */
export function createPresenceSink(url: string): PresenceSink {
  return url ? new HttpPresenceSink(url) : new ConsolePresenceSink();
}
