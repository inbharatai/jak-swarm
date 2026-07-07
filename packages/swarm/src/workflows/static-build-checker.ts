// `typescript` is a *devDependency* of this package. A top-level runtime
// import would force the TS compiler into every production install that
// loads the @jak-swarm/swarm barrel (apps/api dynamically imports the
// barrel for runVibeCoderWorkflow). To keep the barrel safe to load in
// prod where devDeps may be absent, we import the types only at the top
// level (erased at compile time) and lazy-load the runtime module inside
// `check()` — which is only called when an operator opts into the real
// compiler check. The default vibe-coder path uses heuristicBuildChecker.
import type ts from 'typescript';
import type { GeneratedFile } from '@jak-swarm/agents';
import type { BuildChecker, BuildResult } from './vibe-coder-workflow.js';

/** Runtime shape of the `typescript` module (loaded lazily in `check`). */
type TS = typeof import('typescript');

/**
 * Static build checker backed by the TypeScript compiler API.
 *
 * Runs in-memory (no disk, no Docker) in sub-second time. Compiles the
 * generated files as a virtual Program and returns all real type + syntax
 * errors. Intentionally ignores module-not-found diagnostics — we don't
 * resolve npm deps in-process, so `import React from 'react'` would
 * otherwise fail every check. The actual npm resolution is Vercel's job
 * at deploy time.
 *
 * What this catches:
 *   - Truncated files (unbalanced braces, half-written statements)
 *   - Syntax errors (invalid JSX, missing commas, etc.)
 *   - Local type errors (variables used before defined, wrong argument
 *     arity to user-defined functions)
 *   - Missing exports referenced within the same file
 *   - Duplicate declarations
 *
 * What this does NOT catch (Vercel/Next.js will):
 *   - Missing npm dependency
 *   - React/Next-specific API misuse that needs type definitions
 *   - Runtime errors (hydration mismatch, CSR/SSR boundary bugs)
 *
 * This is the fastest accurate in-loop verification that exists — faster
 * than Emergent's per-iteration container spin-up (60-120s) because no
 * install / network / disk. Typical time: 200-800ms for a ~20-file app.
 */

/** Diagnostic codes to ignore — module resolution + node_modules issues. */
const IGNORED_DIAGNOSTIC_CODES = new Set<number>([
  2307, // Cannot find module 'x' or its corresponding type declarations
  2305, // Module has no exported member 'x' (usually npm package)
  2306, // File 'x' is not a module
  7016, // Could not find a declaration file for module 'x'
  2691, // Import path cannot end with .ts extension
  7006, // Parameter implicitly has an 'any' type (too noisy for agent output)
]);

/**
 * Only run the TypeScript program on files that the compiler can process.
 * Other files (JSON, CSS, markdown) pass through without inspection.
 */
function isCompilable(path: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(path);
}

function isJavaScript(path: string): boolean {
  return /\.(js|jsx|mjs|cjs)$/.test(path);
}

function formatDiagnostic(d: ts.Diagnostic, files: readonly GeneratedFile[], tsModule: TS): string {
  const messageText = tsModule.flattenDiagnosticMessageText(d.messageText, '\n');
  if (!d.file) return `TS${d.code}: ${messageText}`;
  const fileName = d.file.fileName;
  if (typeof d.start === 'number') {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    // Show a tiny snippet around the error for the debugger's context.
    const source = files.find((f) => f.path === fileName)?.content ?? '';
    const lines = source.split('\n');
    const snippet = lines[line]?.trim() ?? '';
    return `${fileName}:${line + 1}:${character + 1} — TS${d.code}: ${messageText}${snippet ? ` | "${snippet.slice(0, 120)}"` : ''}`;
  }
  return `${fileName} — TS${d.code}: ${messageText}`;
}

/**
 * Create an in-memory CompilerHost that serves the generated files and
 * refuses to touch disk. `getSourceFile` returns a parsed SourceFile for
 * each generated file; any other file returns undefined (which the
 * compiler treats as "not found", matching our intent).
 */
function scriptKindFor(fileName: string, tsModule: TS): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return tsModule.ScriptKind.TSX;
  if (fileName.endsWith('.ts')) return tsModule.ScriptKind.TS;
  if (fileName.endsWith('.jsx')) return tsModule.ScriptKind.JSX;
  if (fileName.endsWith('.js')) return tsModule.ScriptKind.JS;
  if (fileName.endsWith('.json')) return tsModule.ScriptKind.JSON;
  return tsModule.ScriptKind.Unknown;
}

/**
 * Minimal ambient declarations for types that AppGenerator output commonly
 * references but that would otherwise require `@types/react` / `@types/node`
 * to resolve. Keeping these deliberately permissive — the goal is to let the
 * checker focus on syntax + logic errors, not type library completeness.
 */
const AMBIENT_DTS = `
declare namespace JSX {
  interface Element {}
  interface ElementClass {}
  interface ElementAttributesProperty {}
  interface IntrinsicAttributes {}
  interface IntrinsicElements { [elemName: string]: any; }
}
declare const process: { env: Record<string, string | undefined> };
declare const console: { log(...a: any[]): void; error(...a: any[]): void; warn(...a: any[]): void; info(...a: any[]): void; debug(...a: any[]): void; };
declare const require: (mod: string) => any;
declare const __dirname: string;
declare const __filename: string;
`;

function createVirtualHost(files: readonly GeneratedFile[], tsModule: TS): ts.CompilerHost {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));
  // Inject the ambient declarations at a virtual path the program always includes.
  const AMBIENT_PATH = '__jak_ambient__.d.ts';
  fileMap.set(AMBIENT_PATH, AMBIENT_DTS);

  return {
    getSourceFile(fileName, languageVersion) {
      const content = fileMap.get(fileName);
      if (content === undefined) return undefined;
      return tsModule.createSourceFile(
        fileName,
        content,
        languageVersion,
        /* setParentNodes */ true,
        scriptKindFor(fileName, tsModule),
      );
    },
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {
      /* noEmit */
    },
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: (fileName) => fileMap.has(fileName),
    readFile: (fileName) => fileMap.get(fileName),
    getCanonicalFileName: (fn) => fn,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    getEnvironmentVariable: () => '',
    realpath: (fn) => fn,
    // Silence "lib.d.ts not found" noise since we don't resolve node types.
    getDefaultLibLocation: () => '/',
  };
}

export const staticBuildChecker: BuildChecker = {
  async check(files: GeneratedFile[]): Promise<BuildResult> {
    if (files.length === 0) {
      return { ok: false, errorLog: 'Generator returned zero files', affectedFiles: [] };
    }

    const compilable = files.filter((f) => isCompilable(f.path) || isJavaScript(f.path));
    if (compilable.length === 0) {
      // Nothing TypeScript-y to check; pass (the heuristic checker in the
      // workflow can still catch truncation / empty files if you chain them).
      return { ok: true };
    }

    // Lazy-load the TypeScript compiler. `typescript` is a devDependency;
    // importing it here (not at module top level) keeps the swarm barrel
    // safe to load in production where devDeps may be absent. If an
    // operator wires this checker in without typescript installed, this
    // throws a clear error rather than crashing the whole barrel on import.
    const tsModule: TS = (await import('typescript')).default;

    const compilerOptions: ts.CompilerOptions = {
      target: tsModule.ScriptTarget.ES2020,
      module: tsModule.ModuleKind.ESNext,
      moduleResolution: tsModule.ModuleResolutionKind.Bundler,
      jsx: tsModule.JsxEmit.Preserve,
      strict: false, // Full strict is too noisy without declaration files.
      noImplicitAny: false,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowJs: true,
      forceConsistentCasingInFileNames: true,
      // Critically: don't try to resolve npm modules from disk.
      typeRoots: [],
      types: [],
      noResolve: true,
    };

    const host = createVirtualHost(compilable, tsModule);
    const program = tsModule.createProgram({
      rootNames: [...compilable.map((f) => f.path), '__jak_ambient__.d.ts'],
      options: compilerOptions,
      host,
    });

    // Parse-level diagnostics (syntax errors) + semantic-level diagnostics
    // (type errors). Emit diagnostics skipped (noEmit is true).
    const allDiags = [
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ].filter((d) => !IGNORED_DIAGNOSTIC_CODES.has(d.code));

    if (allDiags.length === 0) {
      return { ok: true };
    }

    // Cap the error log so we don't overwhelm the debugger's token budget
    // when the generator has a systemic issue. Prefer the first 30 diagnostics.
    const capped = allDiags.slice(0, 30);
    const errorLog = capped.map((d) => formatDiagnostic(d, compilable, tsModule)).join('\n');
    const affected = [
      ...new Set(
        capped
          .map((d) => d.file?.fileName)
          .filter((f): f is string => typeof f === 'string'),
      ),
    ];

    return {
      ok: false,
      errorLog:
        errorLog +
        (allDiags.length > capped.length
          ? `\n... ${allDiags.length - capped.length} more diagnostics truncated`
          : ''),
      affectedFiles: affected,
    };
  },
};
