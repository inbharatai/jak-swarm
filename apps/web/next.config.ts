import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';

// A.5 — performance hardening. Each flag is a small, independent win:
//   reactStrictMode       — surface effect double-fire bugs in dev.
//   optimizePackageImports — tree-shake barrel exports from heavy libs so
//                            only the icons/hooks actually used ship. (Still
//                            gated under `experimental` in Next 16's type.)
//   compiler.removeConsole — strip console.* in prod (keep error/warn so
//                            observability isn't silenced).
//   images.formats        — prefer AVIF/WebP for any <Image> usage.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000',
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      'framer-motion',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      'react-hook-form',
      'zustand',
    ],
  },
  compiler: {
    removeConsole:
      process.env['NODE_ENV'] === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
};

// A.5 — bundle analysis is opt-in via `ANALYZE=true pnpm --filter
// @jak-swarm/web analyze`. Disabled otherwise (the wrapper is a passthrough
// when `enabled: false`), so this import adds zero runtime cost in normal
// builds.
export default bundleAnalyzer({
  enabled: process.env['ANALYZE'] === 'true',
})(nextConfig);