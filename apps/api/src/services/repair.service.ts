/**
 * RepairService — re-export shim.
 *
 * The implementation moved to `packages/swarm/src/recovery/repair-service.ts`
 * during P1-3 of the launch-readiness audit so the LangGraph worker-node
 * (in @jak-swarm/swarm) can import + invoke it directly. Existing callers
 * inside apps/api keep this path; tests under tests/unit/services/repair-
 * service.test.ts continue to import from here unchanged.
 *
 * The swarm package re-exports `classifyError` as `classifyRepairError`
 * to avoid a collision with the (different) `classifyError` exported by
 * `coordination/execute-guarded.ts`. This shim re-aliases everything
 * back to the original public names.
 *
 * If you're adding a new caller, prefer importing from `@jak-swarm/swarm`
 * directly using the *Repair* prefix names — that's the canonical
 * location.
 */
export {
  classifyRepairError as classifyError,
  decideRepair,
  RepairService,
  defaultRepairService,
} from '@jak-swarm/swarm';
export type {
  RepairErrorClass as ErrorClass,
  RepairDecision,
  RepairClassifyOptions as ClassifyOptions,
  RepairContext,
} from '@jak-swarm/swarm';
