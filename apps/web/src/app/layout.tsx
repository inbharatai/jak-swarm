import type { Metadata } from 'next';
import { JetBrains_Mono, Syne } from 'next/font/google';
import { ThemeProvider } from '@/lib/theme';
import { AppShell } from '@/components/layout/AppShell';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const title = 'JAK Swarm — Company Brain + Hyperagent for Evidence-Grounded Execution';
const description = 'A multiplayer workspace where teams and AI agents share the same live workflow session. Watch, redirect, hand off, approve, and replay long-running work backed by 38 specialist agents and 122 classified tools.';

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    'multiplayer AI',
    'human agent collaboration',
    'AI agents',
    'shared agent workspace',
    'multi-agent workflows',
    'approval gates',
    'agent orchestration',
    'workflow replay',
    'open source AI',
  ],
  authors: [{ name: 'JAK Swarm' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'JAK Swarm',
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' }],
  },
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: 'JAK Swarm',
    images: [
      {
        url: '/og-image.svg',
        width: 1200,
        height: 630,
        alt: 'JAK Swarm — Company Brain + Hyperagent for Evidence-Grounded Execution',
        type: 'image/svg+xml',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og-image.svg'],
  },
  other: {
    'theme-color': '#09090b',
    'color-scheme': 'dark light',
    'mobile-web-app-capable': 'yes',
  },
  metadataBase: new URL('https://jakswarm.com'),
  alternates: { canonical: '/' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${syne.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta name="theme-color" content="#09090b" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
