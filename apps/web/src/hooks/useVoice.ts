'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { TranscriptSegment, VoiceMode, VoiceProvider } from '@/types';
import { voiceApi } from '@/lib/api-client';

interface UseVoiceOptions {
  mode?: VoiceMode;
  language?: string;
  onFinalTranscript?: (text: string) => void;
}

interface UseVoiceReturn {
  startListening: () => Promise<void>;
  stopListening: () => void;
  transcript: TranscriptSegment[];
  partialTranscript: string;
  finalTranscript: string;
  isListening: boolean;
  isSupported: boolean;
  isPermissionGranted: boolean | null;
  error: string | null;
  mode: VoiceMode;
  setMode: (mode: VoiceMode) => void;
  provider: VoiceProvider;
  language: string;
  setLanguage: (lang: string) => void;
  clearTranscript: () => void;
  audioLevel: number;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const {
    mode: initialMode = 'push-to-talk',
    language: initialLanguage = 'en-US',
    onFinalTranscript,
  } = options;

  const [mode, setMode] = useState<VoiceMode>(initialMode);
  const [language, setLanguage] = useState(initialLanguage);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isPermissionGranted, setIsPermissionGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [provider, setProvider] = useState<VoiceProvider>('text');
  const [audioLevel, setAudioLevel] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Check browser support
  useEffect(() => {
    const hasSpeechRecognition =
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
    setIsSupported(hasSpeechRecognition);

    if (hasSpeechRecognition) {
      setProvider('browser-stt');
    }

    // Check existing mic permission
    if (typeof navigator !== 'undefined' && navigator.permissions) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then(result => {
          setIsPermissionGranted(result.state === 'granted');
          result.onchange = () => {
            setIsPermissionGranted(result.state === 'granted');
          };
        })
        .catch(() => {
          setIsPermissionGranted(null);
        });
    }
  }, []);

  // Setup audio level monitoring
  const startAudioLevelMonitoring = useCallback((stream: MediaStream) => {
    try {
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function tick() {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(avg / 128); // 0–1
        animFrameRef.current = requestAnimationFrame(tick);
      }

      tick();
    } catch {
      // Audio monitoring not critical
    }
  }, []);

  const stopAudioLevelMonitoring = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // Setup speech recognition using Web Speech API
  const setupSpeechRecognition = useCallback(() => {
    const SpeechRecognitionConstructor =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognitionConstructor) return null;

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = mode === 'hands-free';
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          const segment: TranscriptSegment = {
            id: generateId(),
            text,
            isFinal: true,
            timestamp: new Date().toISOString(),
          };
          setTranscript(prev => [...prev, segment]);
          setPartialTranscript('');
          onFinalTranscript?.(text);
        } else {
          partial += result[0].transcript;
        }
      }
      if (partial) setPartialTranscript(partial);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        setIsPermissionGranted(false);
        setError('Microphone access denied. Please enable microphone permissions.');
      } else if (event.error === 'no-speech') {
        // Ignore
      } else {
        setError(`Voice recognition error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      if (mode === 'hands-free' && isListening) {
        // Auto-restart for hands-free mode
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };

    return recognition;
  }, [mode, language, isListening, onFinalTranscript]);

  const startListening = useCallback(async () => {
    if (!isSupported) {
      setError('Voice input is not supported in this browser.');
      return;
    }

    setError(null);

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setIsPermissionGranted(true);

      startAudioLevelMonitoring(stream);

      const recognition = setupSpeechRecognition();
      if (!recognition) {
        setError('Could not initialize speech recognition.');
        return;
      }

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      setProvider('browser-stt');
    } catch (err: unknown) {
      const message = (err as Error)?.message ?? 'Failed to access microphone';
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setIsPermissionGranted(false);
        setError('Microphone access denied. Please enable in browser settings.');
      } else {
        setError(message);
      }
      setIsListening(false);
    }
  }, [isSupported, setupSpeechRecognition, startAudioLevelMonitoring]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore
      }
      mediaRecorderRef.current = null;
    }

    stopAudioLevelMonitoring();
    setIsListening(false);
    setPartialTranscript('');
  }, [stopAudioLevelMonitoring]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  // Fetch realtime API config if available
  useEffect(() => {
    voiceApi
      .getSessionConfig()
      .then((config: unknown) => {
        if (config) {
          setProvider('realtime-api');
        }
      })
      .catch(() => {
        // Fall back to browser STT or text
      });
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    setPartialTranscript('');
  }, []);

  const finalTranscript = transcript
    .filter(s => s.isFinal)
    .map(s => s.text)
    .join(' ');

  return {
    startListening,
    stopListening,
    transcript,
    partialTranscript,
    finalTranscript,
    isListening,
    isSupported,
    isPermissionGranted,
    error,
    mode,
    setMode,
    provider,
    language,
    setLanguage,
    clearTranscript,
    audioLevel,
  };
}
