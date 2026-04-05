import pino from 'pino';

export function createLogger(name: string, context?: Record<string, unknown>) {
  return pino({
    name,
    level: process.env['LOG_LEVEL'] ?? 'info',
    ...(process.env['NODE_ENV'] !== 'production' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  }).child(context ?? {});
}

export type Logger = ReturnType<typeof createLogger>;
