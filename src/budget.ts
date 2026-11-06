import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Published per-million-token prices in USD. A model without a price cannot be used. */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const price = PRICES_PER_MTOK[model];
  if (!price) throw new Error(`No price configured for model "${model}"`);
  return (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000;
}

/**
 * Worst case for one call, before it is made: a generous token estimate for the
 * prompt (one token per 3 characters) plus every output token we allow.
 */
export function worstCaseUsd(model: string, promptChars: number, maxOutputTokens: number): number {
  return costUsd(model, { input_tokens: Math.ceil(promptChars / 3), output_tokens: maxOutputTokens });
}

export interface BudgetState {
  month: string;
  spentUsd: number;
}

export interface BudgetStore {
  load(): BudgetState | undefined;
  save(state: BudgetState): void;
}

export class MemoryBudgetStore implements BudgetStore {
  constructor(private state?: BudgetState) {}
  load() {
    return this.state;
  }
  save(state: BudgetState) {
    this.state = state;
  }
}

/** Committed to the repo next to the ledger, so the cap holds across scheduled runs. */
export class FileBudgetStore implements BudgetStore {
  constructor(private readonly path: string) {}
  load() {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as BudgetState) : undefined;
  }
  save(state: BudgetState) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ ...state, spentUsd: Number(state.spentUsd.toFixed(6)) }, null, 2) + "\n");
  }
}

/**
 * Hard monthly spend cap. Each call is checked against its worst-case cost
 * before it is made and recorded at its real cost after, so the cap cannot be
 * overshot by a large final batch.
 */
export class BudgetGuard {
  constructor(
    private readonly limitUsd: number,
    private readonly store: BudgetStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private month(): string {
    return this.now().toISOString().slice(0, 7);
  }

  spentThisMonth(): number {
    const s = this.store.load();
    return s && s.month === this.month() ? s.spentUsd : 0;
  }

  canAfford(worstCase: number): boolean {
    return this.spentThisMonth() + worstCase <= this.limitUsd;
  }

  record(model: string, usage: TokenUsage): number {
    const cost = costUsd(model, usage);
    this.store.save({ month: this.month(), spentUsd: this.spentThisMonth() + cost });
    return cost;
  }
}
