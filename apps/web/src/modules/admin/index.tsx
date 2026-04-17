'use client';

import { ArrowRight, Shield } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';

export default function AdminModule() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Admin Console Moved
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            The module workspace no longer hosts a separate admin implementation. Use the dedicated Admin Console so settings, users, and skill review stay aligned with the live backend contract.
          </p>
          <Button asChild>
            <a href="/admin">
              Open Admin Console
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}