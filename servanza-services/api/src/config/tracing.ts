import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Set up diagnostic logging in development
if (process.env.NODE_ENV === 'development') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

const serviceName = process.env.OTEL_SERVICE_NAME || 'servanza-api';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry tracing
 * Call this at the very start of your application (before importing other modules)
 */
export function initTracing(): void {
    if (!otlpEndpoint) {
        console.log('[Tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled');
        return;
    }

    try {
        // OTLP exporter for sending traces
        const traceExporter = new OTLPTraceExporter({
            url: `${otlpEndpoint}/v1/traces`,
        });

        // Create SDK with auto-instrumentation
        sdk = new NodeSDK({
            serviceName,
            traceExporter,
            instrumentations: [
                getNodeAutoInstrumentations({
                    // Disable verbose instrumentations
                    '@opentelemetry/instrumentation-fs': { enabled: false },
                    '@opentelemetry/instrumentation-http': {
                        ignoreIncomingRequestHook: (req) => {
                            // Ignore health checks and metrics endpoints
                            return req.url?.includes('/health') || req.url?.includes('/metrics') || false;
                        },
                    },
                }),
            ],
        });

        sdk.start();
        console.log(`[Tracing] OpenTelemetry initialized for ${serviceName}`);
        console.log(`[Tracing] Exporting to ${otlpEndpoint}`);

        // Graceful shutdown
        process.on('SIGTERM', () => {
            sdk?.shutdown()
                .then(() => console.log('[Tracing] Tracing terminated'))
                .catch((error) => console.log('[Tracing] Error shutting down tracing:', error))
                .finally(() => process.exit(0));
        });
    } catch (error) {
        console.error('[Tracing] Failed to initialize OpenTelemetry:', error);
    }
}

/**
 * Shutdown tracing gracefully
 */
export async function shutdownTracing(): Promise<void> {
    if (sdk) {
        await sdk.shutdown();
        console.log('[Tracing] OpenTelemetry shutdown complete');
    }
}
