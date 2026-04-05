// Provider interface
export type { IVoiceProvider, VoiceSessionConfig, RTCIceServer } from './providers/provider.interface.js';

// Providers
export { OpenAIRealtimeProvider } from './providers/openai-realtime.provider.js';
export { DeepgramProvider } from './providers/deepgram.provider.js';
export { ElevenLabsProvider } from './providers/elevenlabs.provider.js';
export { MockVoiceProvider } from './providers/mock.provider.js';

// Pipeline
export { VoicePipeline } from './pipeline/voice-pipeline.js';
export type {
  VoicePipelineConfig,
  ActiveSession,
} from './pipeline/voice-pipeline.js';
