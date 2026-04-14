import type { Metadata } from 'next';
import { Syne, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { AppShell } from '@/components/layout/AppShell';
import { ToastProvider } from '@/components/ui/toast';
import { CommandPalette } from '@/components/CommandPalette';
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

export const metadata: Metadata = {
  title: 'JAK Swarm — Autonomous Multi-Agent AI Platform',
  description:
    'Autonomous multi-agent AI platform — 39 agents, 119 production tools, 6 managed AI providers. Real-time DAG execution, MCP gateway, workflow scheduling, multi-modal vision and vibe coding. No API keys needed.',
  keywords: ['AI agents', 'multi-agent platform', 'automation', 'workflow', 'enterprise AI', 'vibe coding', 'managed AI'],
  authors: [{ name: 'JAK Swarm' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'JAK Swarm',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
    ],
  },
  openGraph: {
    title: 'JAK Swarm — Autonomous Agent Platform',
    description: 'Deploy intelligent multi-agent workflows across any industry.',
    type: 'website',
  },
  other: {
    'theme-color': '#09090b',
    'color-scheme': 'dark light',
    'mobile-web-app-capable': 'yes',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${syne.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta name="theme-color" content="#09090b" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js')})}`,
          }}
        />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ToastProvider>
            <AppShell>{children}</AppShell>
            <CommandPalette />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
