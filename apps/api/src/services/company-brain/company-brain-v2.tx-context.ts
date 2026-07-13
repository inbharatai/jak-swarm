/**
 * company-brain-v2.tx-context.ts — PR E (Phase 10) single-transaction
 * atomicity for `mergeEntities`.
 *
 * The merge body rewrites claims/edges/aliases onto the target, hard-deletes
 * the source's rows, soft-deletes + `status='merged'` the source entity, and
 * inserts a merge-audit row + resolves open reviews. Pre-PR-E every statement
 * ran in its own autocommit (the `query`/`execute` helpers call
 * `db.$queryRawUnsafe` / `db.$executeRawUnsafe` directly), so a crash between
 * the source claim (CAS to `status='merging'`) and the final soft-delete left
 * the source stuck in the transient `merging` status with claims/edges/aliases
 * partially migrated onto the target — no automatic rollback.
 *
 * The fix wraps the whole body in one `db.$transaction(async (tx) => …)` and
 * routes EVERY `query`/`execute` (including those inside `upsertClaim` /
 * `upsertEdge` / `ensureAlias` / `addClaimEvidence` / `createReview`) through
 * the transaction client `tx`. Rather than thread a `tx` param through ~7
 * protected methods and every call site (large, noisy, error-prone), the tx
 * client is propagated via `AsyncLocalStorage` — a per-async-chain context
 * that is CONCURRENCY-SAFE: only the merge's own async chain sees the tx, so a
 * singleton service instance serving concurrent requests cannot clobber
 * another request's tx. This is the standard Node transaction-context pattern
 * (NestJS, Prisma extensions, etc.).
 *
 * `graphTxStorage.getStore()` returns the current tx runner or undefined. The
 * `query`/`execute` helpers in `company-brain-v2.store.ts` consult it and route
 * to `tx` when present, falling back to `this.db` otherwise — so every other
 * call site (non-merge) is unchanged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** The subset of the Prisma client the graph helpers need inside a tx. The
 *  Prisma transaction client (`Prisma.TransactionClient`) satisfies this. */
export interface GraphTxRunner {
  $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
}

/** Per-async-chain transaction context for the company-brain graph. */
export const graphTxStorage = new AsyncLocalStorage<GraphTxRunner>();

/** True when the current async chain is running inside a graph transaction. */
export function inGraphTx(): boolean {
  return graphTxStorage.getStore() !== undefined;
}

/**
 * Run `fn` with `tx` as the current graph transaction runner. Every
 * `query`/`execute` (and the upsert helpers they back) invoked within `fn`'s
 * async chain route through `tx`. Returns whatever `fn` returns. The tx is
 * committed/rolled back by the surrounding `db.$transaction` — this helper
 * only establishes the async context, it does NOT manage the transaction.
 */
export async function runInGraphTx<R>(tx: GraphTxRunner, fn: () => Promise<R>): Promise<R> {
  return graphTxStorage.run(tx, fn);
}