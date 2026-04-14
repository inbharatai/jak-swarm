'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap,
  ArrowRight,
  ArrowLeft,
  Check,
  Users,
  Plug,
  Rocket,
} from 'lucide-react';
import { onboardingApi } from '@/lib/api-client';
import { Button, Card, CardContent } from '@/components/ui';
import { ConnectModal } from '@/components/integrations/ConnectModal';
import type { JobFunction, IntegrationProvider } from '@/types';

// ─── Step data ──────────────────────────────────────────────────────────────

const ROLES: { value: JobFunction; label: string; emoji: string }[] = [
  { value: 'CEO', label: 'CEO / Founder', emoji: '\uD83C\uDFAF' },
  { value: 'CTO', label: 'CTO / Tech Lead', emoji: '\uD83D\uDCBB' },
  { value: 'CMO', label: 'CMO / Marketing', emoji: '\uD83D\uDCE3' },
  { value: 'ENGINEER', label: 'Engineer', emoji: '\u2699\uFE0F' },
  { value: 'HR', label: 'HR / People', emoji: '\uD83D\uDC65' },
  { value: 'FINANCE', label: 'Finance', emoji: '\uD83D\uDCB0' },
  { value: 'SALES', label: 'Sales', emoji: '\uD83E\uDD1D' },
  { value: 'OPERATIONS', label: 'Operations', emoji: '\uD83D\uDD27' },
  { value: 'OTHER', label: 'Other', emoji: '\u2728' },
];

const ONBOARDING_PROVIDERS: { provider: IntegrationProvider; name: string; emoji: string }[] = [
  { provider: 'GMAIL', name: 'Gmail', emoji: '\u2709\uFE0F' },
  { provider: 'GCAL', name: 'Google Calendar', emoji: '\uD83D\uDCC5' },
  { provider: 'SLACK', name: 'Slack', emoji: '\uD83D\uDCAC' },
  { provider: 'GITHUB', name: 'GitHub', emoji: '\uD83D\uDC19' },
];

const STEP_LABELS = ['Your Role', 'Invite Team', 'Connect Tools', 'Ready!'];

// ─── Component ──────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selectedRole, setSelectedRole] = useState<JobFunction | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [connectingProvider, setConnectingProvider] = useState<{ provider: IntegrationProvider; name: string; emoji: string } | null>(null);

  // Load existing onboarding state
  useEffect(() => {
    onboardingApi.getState().then((state) => {
      if (state.dismissed) {
        router.replace('/workspace');
        return;
      }
      setCompletedSteps(state.completedSteps);
    }).catch(() => {
      // ignore — fresh onboarding
    });
  }, [router]);

  const markStep = async (stepName: string) => {
    const updated = [...new Set([...completedSteps, stepName])];
    setCompletedSteps(updated);
    try {
      await onboardingApi.updateState({ completedSteps: updated });
    } catch {
      // ignore
    }
  };

  const handleRoleSelect = (role: JobFunction) => {
    setSelectedRole(role);
  };

  const handleNext = async () => {
    if (step === 0 && selectedRole) {
      await markStep('role_selected');
    }
    if (step === 1) {
      await markStep('team_invite');
    }
    if (step === 2) {
      await markStep('tools_connected');
    }
    setStep((s) => Math.min(s + 1, 3));
  };

  const handleFinish = async () => {
    await onboardingApi.updateState({ dismissed: true });
    router.push('/workspace');
  };

  const handleConnect = (provider: IntegrationProvider) => {
    const providerInfo = ONBOARDING_PROVIDERS.find((p) => p.provider === provider);
    if (providerInfo) {
      setConnectingProvider(providerInfo);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary/5 to-background px-4 py-8">
      <div className="w-full max-w-xl">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">Welcome to JAK Swarm</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Let&apos;s set up your workspace in a few quick steps
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEP_LABELS.map((label, i) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 text-xs font-medium ${
                  i <= step ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    i < step
                      ? 'bg-primary text-primary-foreground'
                      : i === step
                        ? 'border-2 border-primary text-primary'
                        : 'border border-muted-foreground/30 text-muted-foreground'
                  }`}
                >
                  {i < step ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className="hidden sm:inline">{label}</span>
              </div>
            ))}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${((step + 1) / STEP_LABELS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <Card>
          <CardContent className="p-6">
            {/* Step 0: Role selection */}
            {step === 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-1">What&apos;s your role?</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  We&apos;ll tailor your quick actions and agent priorities
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {ROLES.map((role) => (
                    <button
                      key={role.value}
                      onClick={() => handleRoleSelect(role.value)}
                      className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all hover:border-primary/50 ${
                        selectedRole === role.value
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : ''
                      }`}
                    >
                      <span className="text-2xl">{role.emoji}</span>
                      <span className="text-xs font-medium">{role.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Team invite */}
            {step === 1 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Invite your team</h2>
                    <p className="text-sm text-muted-foreground">
                      You can invite team members later from the Admin page
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Users className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Team invites are available in Settings &gt; Team Members.
                    <br />
                    You can skip this step for now.
                  </p>
                </div>
              </div>
            )}

            {/* Step 2: Connect tools */}
            {step === 2 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Plug className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Connect your tools</h2>
                    <p className="text-sm text-muted-foreground">
                      Enable agents to work across your stack
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {ONBOARDING_PROVIDERS.map((p) => (
                    <button
                      key={p.provider}
                      onClick={() => handleConnect(p.provider)}
                      className="flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/50"
                    >
                      <span className="text-2xl">{p.emoji}</span>
                      <div className="text-left">
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">Click to connect</p>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground text-center">
                  You can connect more tools later from the Integrations page.
                </p>
              </div>
            )}

            {/* Step 3: Done */}
            {step === 3 && (
              <div className="text-center py-6">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <Rocket className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-xl font-bold mb-2">You&apos;re all set!</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Your workspace is ready. Start by submitting your first task
                  or explore the quick actions on your dashboard.
                </p>
                <Button size="lg" onClick={handleFinish} className="gap-2">
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Navigation */}
            {step < 3 && (
              <div className="mt-6 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(s - 1, 0))}
                  className="gap-1"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={handleNext}
                  disabled={step === 0 && !selectedRole}
                  className="gap-1"
                >
                  {step === 2 ? 'Finish' : 'Next'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Connect Modal */}
      {connectingProvider && (
        <ConnectModal
          provider={connectingProvider.provider}
          providerName={connectingProvider.name}
          providerEmoji={connectingProvider.emoji}
          onClose={() => setConnectingProvider(null)}
          onConnected={() => setConnectingProvider(null)}
        />
      )}
    </div>
  );
}
