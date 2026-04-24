import { BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui';

/**
 * Next.js App Router loading boundary for /analytics.
 *
 * Renders during the route navigation transition AND during the
 * SSR-to-client hydration window — exactly the period where the page's
 * own `isLoading` SWR state is still `false` (request hasn't started yet)
 * and the user would otherwise see a fully blank body.
 *
 * QA H4 follow-up fix: the page-level skeleton I added earlier only
 * showed when `useSWR().isLoading === true`. SWR doesn't set that flag
 * until `useEffect` runs, which leaves a 3-5s gap on cold loads. This
 * file closes that gap because Next.js mounts it BEFORE the page
 * component begins hydrating.
 */
export default function AnalyticsLoading() {
  return (
    <div className="space-y-6" data-testid="analytics-loading">
      {/* Header — same shape as the real page so the transition feels stable */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Usage, cost, and performance insights
          </p>
        </div>
        <div className="flex rounded-lg border overflow-hidden">
          {['7 Days', '30 Days', '90 Days'].map((label) => (
            <span
              key={label}
              className="px-3 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Summary card placeholders */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="analytics-skeleton">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-6 w-16 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="h-4 w-40 rounded bg-muted animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="h-40 w-full rounded bg-muted/50 animate-pulse" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="h-24 w-full rounded bg-muted/50 animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
