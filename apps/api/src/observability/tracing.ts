/**
 * OpenTelemetry tracing initialization.
 *
 * MUST be imported BEFORE any other module (first line of entry point).
 * Gracefully degrades to no-op if no collector is configured.
 *
 * Configuration:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — collector URL (e.g., http://localhost:4318)
 *   OTEL_SERVICE_NAME — service name (default: jak-swarm-api)
 *
 * If OTEL_EXPORTER_OTLP_ENDPOINT is not set, tracing is disabled (zero overhead).
 */

let initialized = false;

export async function initTracing(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint) {
    console.log('[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled (no overhead)');
    return;
  }

  try {
    const sdkNode = await import('@opentelemetry/sdk-node');
    const autoInst = await import('@opentelemetry/auto-instrumentations-node');
    const otlpExporter = await import('@opentelemetry/exporter-trace-otlp-http');
    const resourcesMod = await import('@opentelemetry/resources');

    const NodeSDK = sdkNode.NodeSDK ?? (sdkNode as Record<string, unknown>)['default'];
    const getNodeAutoInstrumentations = autoInst.getNodeAutoInstrumentations;
    const OTLPTraceExporter = otlpExporter.OTLPTraceExporter;
    const resourceFromAttributes = resourcesMod.resourceFromAttributes ?? (resourcesMod as Record<string, unknown>)['Resource'];

    const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'jak-swarm-api';

    const resource = typeof resourceFromAttributes === 'function'
      ? resourceFromAttributes({
          'service.name': serviceName,
          'service.version': '0.1.0',
          'service.instance.id': `${process.pid}-${Date.now().toString(36)}`,
        })
      : undefined;

    const sdk = new (NodeSDK as any)({
      resource,
      traceExporter: new (OTLPTraceExporter as any)({
        url: `${endpoint}/v1/traces`,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable noisy instrumentations
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
        }),
      ],
    });

    sdk.start();

    // Graceful shutdown
    const shutdown = async () => {
      try {
        await sdk.shutdown();
        console.log('[otel] SDK shut down successfully');
      } catch (err) {
        console.error('[otel] SDK shutdown error:', err);
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    console.log(`[otel] Tracing enabled → ${endpoint} (service: ${serviceName})`);
  } catch (err) {
    console.warn('[otel] Failed to initialize tracing (non-fatal):', err instanceof Error ? err.message : String(err));
  }
}
