'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Send,
  Mic,
  ChevronDown,
  Sparkles,
  Plug,
} from 'lucide-react';
import useSWR from 'swr';
import { cn } from '@/lib/cn';
import { Button, Badge } from '@/components/ui';
import { COMMAND_TEMPLATES } from '@/lib/templates';
import type { Industry, Integration } from '@/types';

const INDUSTRY_OPTIONS: { value: Industry; label: string; emoji: string }[] = [
  { value: 'FINANCE', label: 'Finance', emoji: '💰' },
  { value: 'HEALTHCARE', label: 'Healthcare', emoji: '🏥' },
  { value: 'LEGAL', label: 'Legal', emoji: '⚖️' },
  { value: 'RETAIL', label: 'Retail', emoji: '🛒' },
  { value: 'LOGISTICS', label: 'Logistics', emoji: '🚚' },
  { value: 'MANUFACTURING', label: 'Manufacturing', emoji: '🏭' },
  { value: 'TECHNOLOGY', label: 'Technology', emoji: '💻' },
  { value: 'REAL_ESTATE', label: 'Real Estate', emoji: '🏠' },
  { value: 'EDUCATION', label: 'Education', emoji: '🎓' },
  { value: 'HOSPITALITY', label: 'Hospitality', emoji: '🏨' },
];

const EXAMPLE_COMMANDS: Record<Industry, string[]> = {
  FINANCE: [
    'Analyze Q3 portfolio performance and generate a risk summary report',
    'Research AAPL earnings and compare to analyst consensus',
    'Draft a client investment memo for emerging market opportunities',
    'Reconcile monthly P&L statement from the uploaded spreadsheet',
    'Monitor news for ESG-related events affecting our holdings',
  ],
  HEALTHCARE: [
    'Summarize the latest clinical trial results for drug XYZ',
    'Draft a patient discharge summary from the attached notes',
    'Research FDA approval pathway for our new device',
    'Analyze claims data for billing anomalies',
    'Compile differential diagnosis from patient symptoms',
  ],
  LEGAL: [
    'Review this contract and flag any unusual clauses',
    'Research case law on software patent infringement',
    'Draft a cease-and-desist letter for trademark violation',
    'Summarize deposition transcript from attached document',
    'Create a compliance checklist for GDPR requirements',
  ],
  RETAIL: [
    'Analyze sales trends and identify top SKUs for Q4',
    'Draft email campaign for Black Friday promotions',
    'Research competitor pricing for our product category',
    'Generate inventory reorder recommendations',
    'Analyze customer reviews and summarize sentiment themes',
  ],
  LOGISTICS: [
    'Optimize delivery routes for tomorrow\'s 50 shipments',
    'Analyze carrier performance data and identify delays',
    'Draft RFQ for new freight forwarding contracts',
    'Research port congestion issues affecting our routes',
    'Generate weekly fleet maintenance schedule',
  ],
  MANUFACTURING: [
    'Analyze production line efficiency from sensor data',
    'Identify root cause of quality defect in batch #4521',
    'Draft supplier quality audit report',
    'Optimize raw material procurement schedule',
    'Create predictive maintenance schedule for Line 3',
  ],
  TECHNOLOGY: [
    'Review the attached codebase for security vulnerabilities',
    'Generate API documentation from the OpenAPI spec',
    'Analyze user behavior data from our analytics platform',
    'Draft technical architecture decision record',
    'Research competitor feature releases this quarter',
  ],
  REAL_ESTATE: [
    'Analyze comparable sales data for 123 Main Street',
    'Draft lease agreement for commercial tenant',
    'Research zoning regulations for development project',
    'Generate property valuation report',
    'Compile due diligence checklist for acquisition',
  ],
  EDUCATION: [
    'Create a lesson plan for teaching calculus to high schoolers',
    'Analyze student performance data and identify at-risk students',
    'Draft grant application for STEM program funding',
    'Research accreditation requirements for new program',
    'Generate curriculum alignment report',
  ],
  HOSPITALITY: [
    'Analyze guest feedback from last month and identify improvement areas',
    'Optimize room pricing strategy for upcoming holiday season',
    'Draft response templates for negative online reviews',
    'Research competitor amenity offerings',
    'Create staff scheduling for peak season',
  ],
};

interface CommandInputProps {
  onSubmit: (command: string, industry: Industry) => Promise<void>;
  defaultIndustry?: Industry;
  isLoading?: boolean;
  onVoiceMode?: () => void;
  className?: string;
}

export function CommandInput({
  onSubmit,
  defaultIndustry = 'TECHNOLOGY',
  isLoading = false,
  onVoiceMode,
  className,
}: CommandInputProps) {
  const [text, setText] = useState('');
  const [industry, setIndustry] = useState<Industry>(defaultIndustry);
  const [showExamples, setShowExamples] = useState(false);
  const [showIndustryPicker, setShowIndustryPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Read ?template= URL param and pre-fill command input
  const searchParams = useSearchParams();
  const templateKey = searchParams?.get('template');

  useEffect(() => {
    if (templateKey && COMMAND_TEMPLATES[templateKey] && !text) {
      setText(COMMAND_TEMPLATES[templateKey]);
      // Focus textarea so user can review and submit
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [templateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch connected integrations for context chips
  const { data: integrationsData } = useSWR<Integration[]>('workspace-integrations',
    () => fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/integrations`, {
      headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('jak_token') ?? '' : ''}` },
    }).then(r => r.ok ? r.json().then((d: { data?: Integration[] }) => d.data ?? []) : []).catch(() => []),
    { refreshInterval: 60000 },
  );
  const connectedIntegrations = integrationsData ?? [];

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    await onSubmit(trimmed, industry);
    setText('');
  }, [text, industry, isLoading, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleExampleSelect = (example: string) => {
    setText(example);
    setShowExamples(false);
    textareaRef.current?.focus();
  };

  const selectedIndustryOption = INDUSTRY_OPTIONS.find(o => o.value === industry);

  return (
    <div className={cn('space-y-2', className)}>
      {/* Textarea */}
      <div className={cn(
        'relative rounded-xl border bg-background transition-shadow',
        isLoading ? 'opacity-80' : 'focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring',
      )}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Give your swarm a command… (Enter to send, Shift+Enter for new line)"
          disabled={isLoading}
          rows={3}
          className="w-full resize-none rounded-xl bg-transparent px-4 pt-4 pb-12 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />

        {/* Bottom toolbar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between rounded-b-xl border-t bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            {/* Industry selector */}
            <div className="relative">
              <button
                onClick={() => setShowIndustryPicker(!showIndustryPicker)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-accent transition-colors"
              >
                <span>{selectedIndustryOption?.emoji}</span>
                <span>{selectedIndustryOption?.label}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>

              {showIndustryPicker && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowIndustryPicker(false)} />
                  <div className="absolute bottom-full left-0 z-20 mb-1 w-48 rounded-lg border bg-card shadow-lg">
                    <div className="p-1">
                      {INDUSTRY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setIndustry(opt.value);
                            setShowIndustryPicker(false);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors',
                            industry === opt.value
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-accent',
                          )}
                        >
                          <span>{opt.emoji}</span>
                          <span>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Examples */}
            <div className="relative">
              <button
                onClick={() => setShowExamples(!showExamples)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Sparkles className="h-3 w-3" />
                Examples
              </button>

              {showExamples && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowExamples(false)} />
                  <div className="absolute bottom-full left-0 z-20 mb-1 w-80 rounded-lg border bg-card shadow-lg">
                    <div className="border-b px-3 py-2">
                      <p className="text-xs font-medium">Example commands — {selectedIndustryOption?.label}</p>
                    </div>
                    <div className="p-1">
                      {(EXAMPLE_COMMANDS[industry] ?? []).map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => handleExampleSelect(ex)}
                          className="flex w-full items-start gap-2 rounded px-3 py-2 text-left text-xs hover:bg-accent transition-colors"
                        >
                          <span className="mt-0.5 text-muted-foreground">{i + 1}.</span>
                          <span>{ex}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Voice mode */}
            {onVoiceMode && (
              <button
                onClick={onVoiceMode}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Mic className="h-3 w-3" />
                Voice
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Word/char count */}
            {text && (
              <span className="text-xs text-muted-foreground">
                {wordCount}w · {charCount}c
              </span>
            )}

            {/* Submit button */}
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!text.trim() || isLoading}
              className="h-7 gap-1.5"
            >
              {isLoading ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  Running…
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Send
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Integration context chips + hint */}
      <div className="flex items-center gap-2 flex-wrap">
        {connectedIntegrations.length === 0 ? (
          <a href="/integrations" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
            <Plug className="h-3 w-3" />
            No integrations connected — <span className="underline">connect your tools</span>
          </a>
        ) : (
          connectedIntegrations.map((i: Integration) => {
            const icons: Record<string, string> = { GMAIL: '📧', GCAL: '📅', SLACK: '💬', GITHUB: '🐙', NOTION: '📝', HUBSPOT: '🔶', DRIVE: '📁' };
            const labels: Record<string, string> = { GMAIL: 'Gmail', GCAL: 'Calendar', SLACK: 'Slack', GITHUB: 'GitHub', NOTION: 'Notion', HUBSPOT: 'HubSpot', DRIVE: 'Drive' };
            return (
              <span key={i.id} className="text-xs bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
                {icons[i.provider] ?? '🔌'} {labels[i.provider] ?? i.provider}
              </span>
            );
          })
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          <kbd className="rounded border px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send
        </span>
      </div>

      {/* Template indicator */}
      {templateKey && COMMAND_TEMPLATES[templateKey] && (
        <div className="flex items-center gap-2 text-xs text-primary bg-primary/5 rounded-lg px-3 py-1.5">
          <Sparkles className="h-3 w-3" />
          <span>Template loaded: <strong>{templateKey.replace(/-/g, ' ')}</strong></span>
          <button
            onClick={() => setText('')}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
