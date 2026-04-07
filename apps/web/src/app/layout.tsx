import type { Metadata } from 'next';
import { Space_Grotesk, Syne, JetBrains_Mono } from 'next/font/google';
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

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'JAK Swarm — Autonomous Agent Platform',
  description:
    'Production-grade autonomous swarm agent platform. Deploy intelligent multi-agent workflows across any industry.',
  keywords: ['AI agents', 'swarm intelligence', 'automation', 'workflow', 'enterprise AI'],
  authors: [{ name: 'JAK Swarm' }],
  openGraph: {
    title: 'JAK Swarm — Autonomous Agent Platform',
    description: 'Deploy intelligent multi-agent workflows across any industry.',
    type: 'website',
  },
  other: {
    'theme-color': '#09090b',
    'color-scheme': 'dark',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${syne.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`} style={{ colorScheme: 'dark' }}>
      <head>
        <meta name="theme-color" content="#09090b" />
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
