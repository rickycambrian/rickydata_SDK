import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { TraceRecorder } from '../recorder.js';
import type { TraceEvent, TraceSession, TraceRecorderConfig } from '../types.js';

export interface UseTraceRecorderReturn {
  recorder: TraceRecorder;
  events: TraceEvent[];
  activeSession: TraceSession | null;
  isRecording: boolean;
}

/**
 * React hook that creates a TraceRecorder and provides a live-updating
 * events array for rendering in TraceViewer/TraceTimeline.
 */
export function useTraceRecorder(config?: TraceRecorderConfig): UseTraceRecorderReturn {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [activeSession, setActiveSession] = useState<TraceSession | null>(null);

  // Stable ref to avoid re-creating recorder when config changes
  const configRef = useRef(config);
  configRef.current = config;

  const onEvent = useCallback((event: TraceEvent) => {
    setEvents((prev) => [...prev, event]);

    // Also call the user's onEvent if provided
    configRef.current?.onEvent?.(event);
  }, []);

  const recorder = useMemo(() => {
    return new TraceRecorder({
      ...configRef.current,
      onEvent,
    });
  }, [onEvent]);

  // Poll active session state (lightweight — just reads a Map entry)
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSession(recorder.getActiveSession());
    }, 500);
    return () => clearInterval(interval);
  }, [recorder]);

  const isRecording = activeSession !== null && activeSession.endedAt === undefined;

  return { recorder, events, activeSession, isRecording };
}
