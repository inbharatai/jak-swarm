/**
 * _shared.tsx — re-exports the control-centre presentational components +
 * the API error-message helper so each page imports from one place.
 */
export { ViewShell, HonestEmpty, LoadingState, ErrorState, StatTile, BucketList, DataTable, SectionCard, RoadmapNote } from '@/components/hyperagent/ControlCentre';
export type { Column } from '@/components/hyperagent/ControlCentre';
export { getErrorMessage } from '@/lib/api-client';