/**
 * Dashboard-wide loading boundary.
 *
 * Catches the SSR-to-client hydration window for any dashboard page that
 * doesn't have its own `loading.tsx`. Shows a tasteful neutral skeleton
 * instead of a blank body — fixes the broader "page goes blank for 3-5s
 * during navigation" perception that the QA H4 audit surfaced.
 *
 * Per-page loading files (e.g. analytics/loading.tsx) override this with
 * a layout-shape-specific skeleton when the route warrants it.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-4 p-4 sm:p-6" data-testid="dashboard-loading">
      <div className="h-7 w-48 rounded bg-muted animate-pulse" />
      <div className="h-4 w-72 rounded bg-muted/60 animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted/70 animate-pulse" />
            <div className="h-20 w-full rounded bg-muted/50 animate-pulse mt-3" />
          </div>
        ))}
      </div>
    </div>
  );
}
