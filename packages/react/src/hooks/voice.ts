/**
 * LiveKit voice chat hook for the @rickydata/react SDK.
 *
 * Bridges audio to the agent gateway via LiveKit rooms.
 * Voice relay worker on the server handles: Deepgram STT -> chat endpoint -> Cartesia TTS.
 *
 * Extracted from rickydata_agentbook/src/hooks/useAgentVoiceChat.ts,
 * replacing direct fetch calls with AgentClient methods.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  DisconnectReason,
  DataPacket_Kind,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type TranscriptionSegment,
  type Participant,
} from 'livekit-client';
import { useRickyData } from '../providers/RickyDataProvider.js';
import type { VoiceConnectionState, VoiceTranscript, VoiceToolCallInfo, VoicePhase } from '../types.js';

/** Voice fee: $0.02/min platform fee + $0.0005 per MCP tool call. */
const VOICE_FEE_PER_MIN = 0.02;
const TOOL_CALL_FEE = 0.0005;

const CONNECTION_TIMEOUT_MS = 15_000;
const TOOL_CALL_TIMEOUT_MS = 30_000;

/** Narration speech synthesis settings — lower volume than agent audio. */
export const NARRATION_VOICE_RATE = 0.95;
export const NARRATION_VOICE_VOLUME = 0.7;

/** Speak narration text using browser SpeechSynthesis. No-op if unavailable or muted. */
export function speakNarration(text: string, muted: boolean = false): void {
  if (muted) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = NARRATION_VOICE_RATE;
  utterance.pitch = 1.0;
  utterance.volume = NARRATION_VOICE_VOLUME;
  window.speechSynthesis.speak(utterance);
}

/** Split on __, take last segment, replace _ with spaces */
export function humanizeToolName(name: string): string {
  const segments = name.split('__');
  return segments[segments.length - 1].replace(/_/g, ' ');
}

/**
 * Narration event types that map to specific plain-text messages.
 * All narration is hardcoded strings — never LLM-generated.
 */
export type NarrationEvent = 'tool_start' | 'tool_success' | 'tool_error' | 'tool_timeout' | 'tool_cancel';

/** Build the narration transcript object for a given event. */
export function createNarration(
  event: NarrationEvent,
  callId: string,
  toolName?: string,
): { id: string; role: 'agent'; text: string; isFinal: true; isNarration: true } {
  const humanized = toolName ? humanizeToolName(toolName) : '';
  const textMap: Record<NarrationEvent, string> = {
    tool_start: `Let me ${humanized}...`,
    tool_success: 'Got the results.',
    tool_error: "That didn't work as expected.",
    tool_timeout: `${humanized} is taking too long. You can cancel it.`,
    tool_cancel: 'Cancelled.',
  };
  const idPrefix: Record<NarrationEvent, string> = {
    tool_start: 'narration-start',
    tool_success: 'narration-done',
    tool_error: 'narration-done',
    tool_timeout: 'narration-timeout',
    tool_cancel: 'narration-cancel',
  };
  return {
    id: `${idPrefix[event]}-${callId}`,
    role: 'agent',
    text: textMap[event],
    isFinal: true,
    isNarration: true,
  };
}

/** Compute voice phase from state */
export function computeVoicePhase(
  connectionState: VoiceConnectionState,
  isUserSpeaking: boolean,
  isAgentSpeaking: boolean,
  hasActiveToolCalls: boolean,
): VoicePhase {
  if (connectionState === 'connecting') return 'connecting';
  if (connectionState !== 'connected') return 'idle';
  if (hasActiveToolCalls) return 'using_tools';
  if (isAgentSpeaking) return 'speaking';
  if (isUserSpeaking) return 'listening';
  return 'thinking';
}

export interface UseAgentVoiceChatOptions {
  agentId: string;
  model?: string;
  voice?: string;
  /** Override gateway URL (e.g., proxy through your own API to avoid CORS). Defaults to client's configured URL. */
  gatewayUrl?: string;
  onError?: (error: string) => void;
}

export interface UseAgentVoiceChatResult {
  connectionState: VoiceConnectionState;
  transcripts: VoiceTranscript[];
  toolCalls: VoiceToolCallInfo[];
  isUserSpeaking: boolean;
  isAgentSpeaking: boolean;
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  estimatedCost: number;
  sessionDuration: number;
  needsDeposit: boolean;
  sessionId: string | null;
  voicePhase: VoicePhase;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMicMute: () => void;
  toggleSpeakerMute: () => void;
  sendTextMessage: (text: string) => void;
  cancelToolCall: (callId: string) => void;
}

export function useAgentVoiceChat({
  agentId,
  model = 'claude-sonnet-4-20250514',
  voice = '5ee9feff-1265-424a-9d7f-8e4d431a12c7',
  gatewayUrl,
  onError,
}: UseAgentVoiceChatOptions): UseAgentVoiceChatResult {
  const client = useRickyData();

  const [connectionState, setConnectionState] = useState<VoiceConnectionState>('idle');
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([]);
  const [toolCalls, setToolCalls] = useState<VoiceToolCallInfo[]>([]);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [needsDeposit, setNeedsDeposit] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Refs for LiveKit session
  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedToolCallCountRef = useRef(0);
  const connectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolCallTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const connect = useCallback(async () => {
    setConnectionState('connecting');
    setTranscripts([]);
    setToolCalls([]);
    setEstimatedCost(0);
    setSessionDuration(0);
    setNeedsDeposit(false);
    setSessionId(null);
    completedToolCallCountRef.current = 0;

    try {
      // 1. Request microphone FIRST — fail fast
      try {
        const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        testStream.getTracks().forEach(t => t.stop());
      } catch (micErr) {
        const name = micErr instanceof DOMException ? micErr.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error('Microphone access denied. Please allow microphone access and try again.');
        } else if (name === 'NotFoundError') {
          throw new Error('No microphone found. Please connect a microphone and try again.');
        }
        throw new Error('Could not access microphone.');
      }

      // 2. Get LiveKit token from agent gateway via AgentClient
      let livekitData: { token: string; url: string; roomName: string; sessionId: string };
      try {
        livekitData = await client.getVoiceLivekitToken(agentId, { voice });
      } catch (tokenErr) {
        const status = (tokenErr as Error & { status?: number }).status;
        if (status === 402) setNeedsDeposit(true);
        throw tokenErr;
      }
      sessionIdRef.current = livekitData.sessionId;
      setSessionId(livekitData.sessionId);

      // 3. Start billing session
      try {
        const sessionData = await client.startVoiceSession(agentId, { model });
        sessionIdRef.current = sessionData.sessionId;
        setSessionId(sessionData.sessionId);
      } catch {
        // Non-fatal — billing session start failure shouldn't block voice
      }

      // 4. Create and configure LiveKit room
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      // Agent audio
      room.on(RoomEvent.TrackSubscribed, (
        track: RemoteTrackPublication['track'],
        _publication: RemoteTrackPublication,
        _participant: RemoteParticipant,
      ) => {
        if (track && track.kind === Track.Kind.Audio) {
          const audioEl = track.attach();
          audioEl.autoplay = true;
          audioElRef.current = audioEl;
          if (isSpeakerMuted) audioEl.muted = true;
        }
      });

      // Transcripts
      room.on(RoomEvent.TranscriptionReceived, (
        segments: TranscriptionSegment[],
        participant?: Participant,
      ) => {
        for (const segment of segments) {
          const role = participant?.identity === room.localParticipant.identity
            ? 'user' as const : 'agent' as const;
          const id = segment.id || `${role}-${Date.now()}`;
          setTranscripts(prev => {
            const existing = prev.find(t => t.id === id);
            if (existing) {
              return prev.map(t => t.id === id ? { ...t, text: segment.text, isFinal: segment.final } : t);
            }
            return [...prev, { id, role, text: segment.text, timestamp: new Date().toISOString(), isFinal: segment.final }];
          });
        }
      });

      // Tool calls and costs via data messages from voice relay worker
      room.on(RoomEvent.DataReceived, (
        payload: Uint8Array,
        _participant?: RemoteParticipant,
        _kind?: DataPacket_Kind,
      ) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>; } catch { return; }

        const type = msg.type as string;
        if (type === 'tool_call_started') {
          setToolCalls(prev => [...prev, {
            callId: msg.callId as string,
            name: msg.name as string,
            arguments: (msg.arguments as Record<string, unknown>) ?? {},
            status: 'executing',
            timestamp: Date.now(),
          }]);

          // Inject narration
          const startNarration = createNarration('tool_start', msg.callId as string, msg.name as string);
          speakNarration(startNarration.text, isSpeakerMuted);
          setTranscripts(prev => [...prev, {
            ...startNarration,
            timestamp: new Date().toISOString(),
          }]);

          // Start timeout timer
          const callId = msg.callId as string;
          const timer = setTimeout(() => {
            setToolCalls(prev => prev.map(tc =>
              tc.callId === callId ? { ...tc, status: 'timed_out' as const } : tc
            ));
            const timeoutNarration = createNarration('tool_timeout', callId, msg.name as string);
            speakNarration(timeoutNarration.text, isSpeakerMuted);
            setTranscripts(prev => [...prev, {
              ...timeoutNarration,
              timestamp: new Date().toISOString(),
            }]);
            toolCallTimersRef.current.delete(callId);
          }, TOOL_CALL_TIMEOUT_MS);
          toolCallTimersRef.current.set(callId, timer);
        } else if (type === 'tool_call_completed') {
          const completedCallId = msg.callId as string;
          const success = msg.success as boolean;
          setToolCalls(prev => prev.map(tc =>
            tc.callId === completedCallId ? { ...tc, status: success ? 'completed' : 'error', result: String(msg.result ?? '') } : tc
          ));

          // Clear timeout timer
          const existingTimer = toolCallTimersRef.current.get(completedCallId);
          if (existingTimer) {
            clearTimeout(existingTimer);
            toolCallTimersRef.current.delete(completedCallId);
          }
          // Inject completion narration
          const doneNarration = createNarration(success ? 'tool_success' : 'tool_error', completedCallId);
          speakNarration(doneNarration.text, isSpeakerMuted);
          setTranscripts(prev => [...prev, {
            ...doneNarration,
            timestamp: new Date().toISOString(),
          }]);

          completedToolCallCountRef.current += 1;
          if (startTimeRef.current) {
            const durationMin = (Date.now() - startTimeRef.current) / 60000;
            setEstimatedCost(durationMin * VOICE_FEE_PER_MIN + completedToolCallCountRef.current * TOOL_CALL_FEE);
          }
        } else if (type === 'session_cost') {
          const costStr = (msg.cost as string) ?? '$0.00';
          setEstimatedCost(parseFloat(costStr.replace('$', '')) || 0);
        } else if (type === 'agent_text') {
          const text = msg.text as string;
          const id = `agent-rich-${Date.now()}`;
          setTranscripts(prev => {
            const lastAgent = [...prev].reverse().find(t => t.role === 'agent' && !t.isFinal);
            if (lastAgent) {
              return prev.map(t => t.id === lastAgent.id ? { ...t, text, isFinal: true } : t);
            }
            return [...prev, { id, role: 'agent', text, timestamp: new Date().toISOString(), isFinal: true }];
          });
        }
      });

      // Speaking detection
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        let userSpeaking = false;
        let agentSpeaking = false;
        for (const speaker of speakers) {
          if (speaker.identity === room.localParticipant.identity) userSpeaking = true;
          else agentSpeaking = true;
        }
        setIsUserSpeaking(userSpeaking);
        setIsAgentSpeaking(agentSpeaking);
      });

      // Disconnected
      room.on(RoomEvent.Disconnected, (_reason?: DisconnectReason) => {
        setConnectionState('disconnected');
        setIsUserSpeaking(false);
        setIsAgentSpeaking(false);
      });

      // 5. Connect to LiveKit room (with timeout)
      const connectTimeout = new Promise<never>((_, reject) => {
        connectionTimerRef.current = setTimeout(
          () => reject(new Error('Connection timed out. Tap retry to try again.')),
          CONNECTION_TIMEOUT_MS,
        );
      });
      await Promise.race([room.connect(livekitData.url, livekitData.token, { autoSubscribe: true }), connectTimeout]);
      clearTimeout(connectionTimerRef.current!);
      connectionTimerRef.current = null;
      await room.localParticipant.setMicrophoneEnabled(true);

      // 6. Start duration timer
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setSessionDuration(elapsed);
          const durationMin = elapsed / 60;
          setEstimatedCost(durationMin * VOICE_FEE_PER_MIN + completedToolCallCountRef.current * TOOL_CALL_FEE);
        }
      }, 1000);

      setConnectionState('connected');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Connection failed';
      if (/insufficient.*balance|402/i.test(errMsg)) setNeedsDeposit(true);
      onError?.(errMsg);
      setConnectionState('error');
      if (roomRef.current) { roomRef.current.disconnect(); roomRef.current = null; }
    }
  }, [client, agentId, model, voice, gatewayUrl, onError, isSpeakerMuted]);

  const disconnect = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // Clear connection timer if pending
    if (connectionTimerRef.current) { clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; }

    // Clear all pending tool call timers
    for (const timer of toolCallTimersRef.current.values()) {
      clearTimeout(timer);
    }
    toolCallTimersRef.current.clear();

    const currentSessionId = sessionIdRef.current;
    if (currentSessionId && startTimeRef.current) {
      const durationMs = Date.now() - startTimeRef.current;
      client.endVoiceSession(agentId, { sessionId: currentSessionId, durationMs }).catch(() => {});
    }

    // Cancel any pending narration speech
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (roomRef.current) { roomRef.current.disconnect(); roomRef.current = null; }
    if (audioElRef.current) { audioElRef.current.srcObject = null; audioElRef.current = null; }

    sessionIdRef.current = null;
    startTimeRef.current = null;
    completedToolCallCountRef.current = 0;

    // Note: do NOT clear sessionId state here — the disconnected screen
    // needs it for the "Continue in Chat" button.

    setConnectionState('disconnected');
    setIsUserSpeaking(false);
    setIsAgentSpeaking(false);
  }, [client, agentId]);

  const toggleMicMute = useCallback(() => {
    setIsMicMuted(prev => {
      const next = !prev;
      roomRef.current?.localParticipant.setMicrophoneEnabled(!next);
      return next;
    });
  }, []);

  const toggleSpeakerMute = useCallback(() => {
    setIsSpeakerMuted(prev => {
      const next = !prev;
      if (audioElRef.current) audioElRef.current.muted = next;
      return next;
    });
  }, []);

  const voicePhase = useMemo(() => {
    const hasActiveToolCalls = toolCalls.some(tc => tc.status === 'executing');
    return computeVoicePhase(connectionState, isUserSpeaking, isAgentSpeaking, hasActiveToolCalls);
  }, [connectionState, isUserSpeaking, isAgentSpeaking, toolCalls]);

  const cancelToolCall = useCallback((callId: string) => {
    const timer = toolCallTimersRef.current.get(callId);
    if (timer) {
      clearTimeout(timer);
      toolCallTimersRef.current.delete(callId);
    }
    setToolCalls(prev => prev.map(tc =>
      tc.callId === callId ? { ...tc, status: 'timed_out' } : tc
    ));
    const cancelNarration = createNarration('tool_cancel', callId);
    speakNarration(cancelNarration.text, isSpeakerMuted);
    setTranscripts(prev => [...prev, {
      ...cancelNarration,
      timestamp: new Date().toISOString(),
    }]);
  }, [isSpeakerMuted]);

  const sendTextMessage = useCallback((text: string) => {
    if (!roomRef.current) return;
    setTranscripts(prev => [...prev, {
      id: `user-text-${Date.now()}`, role: 'user', text,
      timestamp: new Date().toISOString(), isFinal: true,
    }]);
    const payload = JSON.stringify({ type: 'user_text', text });
    roomRef.current.localParticipant.publishData(
      new TextEncoder().encode(payload),
      { reliable: true },
    );
  }, []);

  return {
    connectionState, transcripts, toolCalls,
    isUserSpeaking, isAgentSpeaking,
    isMicMuted, isSpeakerMuted,
    estimatedCost, sessionDuration,
    needsDeposit,
    sessionId,
    voicePhase,
    connect, disconnect,
    toggleMicMute, toggleSpeakerMute,
    sendTextMessage,
    cancelToolCall,
  };
}
