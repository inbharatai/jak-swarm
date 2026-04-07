/**
 * Template Registry for Vibe Coding
 *
 * Pre-built scaffolds that reduce LLM token usage by ~60%.
 * Instead of generating everything from scratch, agents customize these templates.
 */

import type { SandboxFileEntry } from './sandbox.interface.js';

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  framework: string;
  files: SandboxFileEntry[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

export const PROJECT_TEMPLATES: Record<string, ProjectTemplate> = {
  'nextjs-app': {
    id: 'nextjs-app',
    name: 'Next.js App',
    description: 'Next.js 14 App Router with Tailwind CSS and TypeScript',
    framework: 'nextjs',
    dependencies: {
      'next': '14.2.18',
      'react': '18.3.1',
      'react-dom': '18.3.1',
    },
    devDependencies: {
      'typescript': '5.6.3',
      '@types/react': '18.3.12',
      '@types/react-dom': '18.3.1',
      '@types/node': '22.10.1',
      'tailwindcss': '3.4.17',
      'postcss': '8.4.49',
      'autoprefixer': '10.4.20',
    },
    scripts: {
      'dev': 'next dev',
      'build': 'next build',
      'start': 'next start',
      'lint': 'next lint',
    },
    files: [
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "es2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
      },
      {
        path: 'next.config.mjs',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;`,
      },
      {
        path: 'tailwind.config.ts',
        content: `import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;`,
      },
      {
        path: 'postcss.config.mjs',
        content: `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
export default config;`,
      },
      {
        path: 'src/app/layout.tsx',
        content: `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'My App',
  description: 'Built with JAK Swarm',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}`,
      },
      {
        path: 'src/app/globals.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
      },
      {
        path: 'src/app/page.tsx',
        content: `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold">Welcome</h1>
      <p className="mt-4 text-lg text-gray-600">Your app is ready.</p>
    </main>
  );
}`,
      },
    ],
  },

  'nextjs-saas': {
    id: 'nextjs-saas',
    name: 'Next.js SaaS Starter',
    description: 'Next.js 14 with Auth, Prisma, Stripe, and Dashboard',
    framework: 'nextjs',
    dependencies: {
      'next': '14.2.18',
      'react': '18.3.1',
      'react-dom': '18.3.1',
      '@prisma/client': '5.22.0',
      'next-auth': '4.24.10',
      'stripe': '17.4.0',
      'zod': '3.24.1',
    },
    devDependencies: {
      'typescript': '5.6.3',
      '@types/react': '18.3.12',
      '@types/react-dom': '18.3.1',
      '@types/node': '22.10.1',
      'tailwindcss': '3.4.17',
      'postcss': '8.4.49',
      'autoprefixer': '10.4.20',
      'prisma': '5.22.0',
    },
    scripts: {
      'dev': 'next dev',
      'build': 'prisma generate && next build',
      'start': 'next start',
      'db:push': 'prisma db push',
      'db:studio': 'prisma studio',
    },
    files: [
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "es2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
      },
      {
        path: 'next.config.mjs',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;`,
      },
      {
        path: 'tailwind.config.ts',
        content: `import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;`,
      },
      {
        path: 'postcss.config.mjs',
        content: `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
export default config;`,
      },
      {
        path: 'prisma/schema.prisma',
        content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  image     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`,
      },
      {
        path: 'src/app/layout.tsx',
        content: `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SaaS App',
  description: 'Built with JAK Swarm',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}`,
      },
      {
        path: 'src/app/globals.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
      },
      {
        path: 'src/app/page.tsx',
        content: `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold">SaaS Starter</h1>
      <p className="mt-4 text-lg text-gray-600">Auth, Database, and Payments ready.</p>
    </main>
  );
}`,
      },
      {
        path: 'src/lib/db.ts',
        content: `import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;`,
      },
    ],
  },

  'react-spa': {
    id: 'react-spa',
    name: 'React SPA',
    description: 'React + Vite SPA with React Router and Tailwind',
    framework: 'react',
    dependencies: {
      'react': '18.3.1',
      'react-dom': '18.3.1',
      'react-router-dom': '7.0.2',
    },
    devDependencies: {
      'typescript': '5.6.3',
      '@types/react': '18.3.12',
      '@types/react-dom': '18.3.1',
      'vite': '6.0.3',
      '@vitejs/plugin-react': '4.3.4',
      'tailwindcss': '3.4.17',
      'postcss': '8.4.49',
      'autoprefixer': '10.4.20',
    },
    scripts: {
      'dev': 'vite',
      'build': 'tsc && vite build',
      'preview': 'vite preview',
    },
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>App</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>`,
      },
      {
        path: 'src/main.tsx',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);`,
      },
      {
        path: 'src/App.tsx',
        content: `export function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold">Hello World</h1>
    </div>
  );
}`,
      },
      {
        path: 'src/index.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "es2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}`,
      },
    ],
  },
};

/**
 * Get a template by ID. Returns null if not found.
 */
export function getTemplate(id: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES[id] ?? null;
}

/**
 * List all available templates.
 */
export function listTemplates(): Array<{ id: string; name: string; description: string; framework: string }> {
  return Object.values(PROJECT_TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    framework: t.framework,
  }));
}

/**
 * Generate a package.json from a template + custom overrides.
 */
export function generatePackageJson(
  template: ProjectTemplate,
  overrides?: {
    name?: string;
    description?: string;
    extraDeps?: Record<string, string>;
    extraDevDeps?: Record<string, string>;
  },
): string {
  const pkg = {
    name: overrides?.name ?? 'jak-generated-app',
    version: '0.1.0',
    private: true,
    description: overrides?.description ?? template.description,
    scripts: template.scripts,
    dependencies: {
      ...template.dependencies,
      ...overrides?.extraDeps,
    },
    devDependencies: {
      ...template.devDependencies,
      ...overrides?.extraDevDeps,
    },
  };
  return JSON.stringify(pkg, null, 2);
}
