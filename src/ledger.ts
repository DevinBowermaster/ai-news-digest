import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { LedgerChanges } from "./types.js";

export interface LedgerData {
  watermarks: Record<string, string>;
  items: Record<string, { source: string; title: string; firstSeen: string }>;
}

/**
 * Dedupe ledger and per-source watermarks. Plain JSON, committed to the repo,
 * so every change shows up as a readable diff.
 *
 * Reads are free; writes only happen through apply(), which the pipeline calls
 * after the digest is written. A crash halfway through a run never marks an
 * item as seen that nobody actually read about.
 */
export class Ledger {
  constructor(private data: LedgerData = { watermarks: {}, items: {} }) {}

  static load(path: string): Ledger {
    if (!existsSync(path)) return new Ledger();
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<LedgerData>;
    return new Ledger({ watermarks: data.watermarks ?? {}, items: data.items ?? {} });
  }

  has(id: string): boolean {
    return id in this.data.items;
  }

  watermark(key: string): string | undefined {
    return this.data.watermarks[key];
  }

  apply(changes: LedgerChanges, today: string): void {
    for (const [id, item] of Object.entries(changes.seen)) {
      if (!this.has(id)) this.data.items[id] = { ...item, firstSeen: today };
    }
    for (const [key, value] of Object.entries(changes.watermarks)) {
      const current = this.data.watermarks[key];
      // Watermarks only move forward, even if a feed starts serving older entries.
      if (!current || value > current) this.data.watermarks[key] = value;
    }
  }

  /** Forget items first seen more than `days` ago, so the file does not grow forever. */
  prune(today: string, days: number): number {
    const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    let removed = 0;
    for (const [id, item] of Object.entries(this.data.items)) {
      if (item.firstSeen < cutoff) {
        delete this.data.items[id];
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return Object.keys(this.data.items).length;
  }

  toJSON(): LedgerData {
    return this.data;
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const sorted: LedgerData = {
      watermarks: Object.fromEntries(Object.entries(this.data.watermarks).sort(([a], [b]) => a.localeCompare(b))),
      items: Object.fromEntries(Object.entries(this.data.items).sort(([a], [b]) => a.localeCompare(b))),
    };
    writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
  }
}

export function mergeChanges(...parts: LedgerChanges[]): LedgerChanges {
  const out: LedgerChanges = { seen: {}, watermarks: {} };
  for (const p of parts) {
    Object.assign(out.seen, p.seen);
    Object.assign(out.watermarks, p.watermarks);
  }
  return out;
}
