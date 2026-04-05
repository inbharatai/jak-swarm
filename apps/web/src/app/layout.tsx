import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
