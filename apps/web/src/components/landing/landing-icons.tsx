/**
 * Landing-page icon set.
 *
 * Replaces the emoji (🏛️⚡🔧📸🚀🔖📧📄💳🎓🔗🛡️🧠🎯💬🎤📦🔄…) that used to live
 * inline in the landing page data arrays. Emoji render inconsistently
 * across platforms (Apple colored vs. Windows monochrome vs. Android
 * mismatched Noto), and they clash with the stroke-icon language used
 * everywhere else on the page (nav, workflow steps, orchestration engine).
 *
 * All icons are:
 *   - 24x24 viewBox, `currentColor` stroke/fill
 *   - Heroicons-style outline (1.5-2px stroke weight, rounded joins)
 *   - Single-path where possible (smaller bundle)
 *   - Accept `className` + `aria-hidden` so they inherit the card's color
 *
 * Usage:
 *   <LandingIcon name="architecture" className="h-7 w-7 text-emerald-400" />
 */

import type { SVGProps } from 'react';

export type LandingIconName =
  | 'architecture'       // App Architect / Architect step
  | 'bolt'               // Code Generator / Generate step
  | 'wrench'             // Auto-Debugger / Debug step
  | 'camera'             // Screenshot-to-Code
  | 'rocket'             // Deploy / Preview step
  | 'bookmark'           // Checkpoint-Revert
  | 'mail'               // Email / Email Threat
  | 'calendar'           // Calendar
  | 'globe'              // Browser
  | 'document'           // Document / Document Verification
  | 'chart'              // Spreadsheet
  | 'user'               // CRM
  | 'search'             // Research
  | 'brain'              // Knowledge / Memory System
  | 'bell'               // Webhooks
  | 'chat'               // Describe step / Slack Bridge
  | 'card'               // Transaction Risk
  | 'academic-cap'       // Identity Verification
  | 'link'               // Cross-Evidence Correlation
  | 'shield'             // 4-Layer Escalation / Verification
  | 'target'             // Context Engineering
  | 'microphone'         // Voice → Workflow
  | 'package'            // SDK
  | 'refresh';           // Error Recovery

interface LandingIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: LandingIconName;
}

const SVG_COMMON = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function LandingIcon({ name, className, ...rest }: LandingIconProps) {
  const props = { ...SVG_COMMON, className, 'aria-hidden': true, ...rest };
  switch (name) {
    case 'architecture':
      // Classical column / pediment
      return (
        <svg {...props}>
          <path d="M3 21h18" />
          <path d="M5 21V9l7-5 7 5v12" />
          <path d="M9 21v-7h6v7" />
          <path d="M5 9h14" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...props}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case 'wrench':
      return (
        <svg {...props}>
          <path d="M14.7 6.3a5 5 0 1 1-7.4 7.4L3 18l3 3 4.3-4.3a5 5 0 0 0 7.4-7.4l-2.5 2.5-2.5-2.5 2.5-2.5a5 5 0 0 0-.5-.5Z" />
        </svg>
      );
    case 'camera':
      return (
        <svg {...props}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.2l1.8-3h8l1.8 3H21a2 2 0 0 1 2 2Z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    case 'rocket':
      return (
        <svg {...props}>
          <path d="M4.5 16.5 3 21l4.5-1.5" />
          <path d="M14 6.5a4 4 0 0 0-4 4v3l3 3h3a4 4 0 0 0 4-4V9l-3-3H14Z" />
          <path d="m17 3 4 4-7 7-4-4Z" />
          <circle cx="15" cy="9" r="1" />
        </svg>
      );
    case 'bookmark':
      return (
        <svg {...props}>
          <path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...props}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m3 7 9 7 9-7" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case 'document':
      return (
        <svg {...props}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
          <path d="M14 3v6h6" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...props}>
          <path d="M3 3v18h18" />
          <path d="M7 14l3-3 3 3 4-5" />
        </svg>
      );
    case 'user':
      return (
        <svg {...props}>
          <path d="M20 21a8 8 0 1 0-16 0" />
          <circle cx="12" cy="8" r="5" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-5-5" />
        </svg>
      );
    case 'brain':
      return (
        <svg {...props}>
          <path d="M9.5 3a3.5 3.5 0 0 0-3.5 3.5V7a3 3 0 0 0-3 3v2a3 3 0 0 0 1 2.2V17a3.5 3.5 0 0 0 5.5 2.9v1.1a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1.1A3.5 3.5 0 0 0 19 17v-2.8A3 3 0 0 0 20 12v-2a3 3 0 0 0-3-3v-.5A3.5 3.5 0 0 0 13.5 3Z" />
          <path d="M12 8v12" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...props}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...props}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
        </svg>
      );
    case 'card':
      return (
        <svg {...props}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20M6 15h4" />
        </svg>
      );
    case 'academic-cap':
      return (
        <svg {...props}>
          <path d="m22 10-10-5-10 5 10 5 10-5Z" />
          <path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5" />
        </svg>
      );
    case 'link':
      return (
        <svg {...props}>
          <path d="M10 14a5 5 0 0 1 0-7l3-3a5 5 0 0 1 7 7l-1 1" />
          <path d="M14 10a5 5 0 0 1 0 7l-3 3a5 5 0 0 1-7-7l1-1" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'target':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'microphone':
      return (
        <svg {...props}>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
        </svg>
      );
    case 'package':
      return (
        <svg {...props}>
          <path d="M21 8 12 3 3 8l9 5 9-5Z" />
          <path d="M3 8v8l9 5 9-5V8" />
          <path d="M12 13v8" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...props}>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      );
    default:
      return null;
  }
}
