import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { createMockClient, renderHookWithProvider } from './test-utils.js';
import { useAgentVoiceChat } from '../src/hooks/voice.js';

const livekitMocks = vi.hoisted(() => ({
  setMicrophoneEnabled: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  publishData: vi.fn(),
}));

vi.mock('livekit-client', () => {
  class Room {
    localParticipant = {
      identity: 'local-user',
      setMicrophoneEnabled: livekitMocks.setMicrophoneEnabled,
      publishData: livekitMocks.publishData,
    };

    on = livekitMocks.on.mockImplementation(() => this);
    connect = livekitMocks.connect;
    disconnect = livekitMocks.disconnect;
  }

  return {
    Room,
    RoomEvent: {
      TrackSubscribed: 'TrackSubscribed',
      TranscriptionReceived: 'TranscriptionReceived',
      DataReceived: 'DataReceived',
      ActiveSpeakersChanged: 'ActiveSpeakersChanged',
      Disconnected: 'Disconnected',
    },
    Track: { Kind: { Audio: 'audio' } },
    DataPacket_Kind: {},
  };
});

describe('useAgentVoiceChat', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let stopTrack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    stopTrack = vi.fn();
    livekitMocks.connect.mockResolvedValue(undefined);
    livekitMocks.setMicrophoneEnabled.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards voice token options and does not create a duplicate billing session', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentVoiceChat({
        agentId: 'agent-1',
        model: 'MiniMax-M2.7-highspeed',
        voice: 'cartesia-voice-id',
        resumeSessionId: 'existing-session',
        executionEngine: 'rickydata-code',
        ttsProvider: 'gemini-live',
        ttsModel: 'gemini-3.1-flash-live-preview',
        ttsVoice: 'Kore',
        narratorEnabled: false,
        parallelNarrator: false,
      }),
      mockClient,
    );

    await act(async () => {
      await result.current.connect();
    });

    expect(mockClient.getVoiceLivekitToken).toHaveBeenCalledWith('agent-1', {
      voice: 'cartesia-voice-id',
      model: 'MiniMax-M2.7-highspeed',
      resumeSessionId: 'existing-session',
      executionEngine: 'rickydata-code',
      ttsProvider: 'gemini-live',
      ttsModel: 'gemini-3.1-flash-live-preview',
      ttsVoice: 'Kore',
      narratorEnabled: false,
      parallelNarrator: false,
    });
    expect(mockClient.startVoiceSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBe('voice-session-1');
    expect(livekitMocks.connect).toHaveBeenCalledWith('wss://livekit.example.com', 'livekit-token', { autoSubscribe: true });
    expect(livekitMocks.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(stopTrack).toHaveBeenCalled();
  });

  it('can disable browser narration while still tracking tool data messages', async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel },
    });

    const { result } = renderHookWithProvider(
      () => useAgentVoiceChat({
        agentId: 'agent-1',
        browserNarration: false,
      }),
      mockClient,
    );

    await act(async () => {
      await result.current.connect();
    });

    const dataHandler = livekitMocks.on.mock.calls.find(
      ([event]) => event === 'DataReceived',
    )?.[1] as ((payload: Uint8Array) => void) | undefined;
    expect(dataHandler).toBeDefined();

    await act(async () => {
      dataHandler?.(new TextEncoder().encode(JSON.stringify({
        type: 'tool_call_started',
        callId: 'call-1',
        name: 'write_file',
        arguments: { path: 'voice.txt' },
      })));
      dataHandler?.(new TextEncoder().encode(JSON.stringify({
        type: 'tool_call_completed',
        callId: 'call-1',
        success: true,
        result: 'ok',
      })));
    });

    expect(result.current.toolCalls).toHaveLength(1);
    expect(result.current.toolCalls[0].status).toBe('completed');
    expect(result.current.transcripts.some((item) => item.isNarration)).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });

  it('emits UI callbacks for LiveKit relay data messages', async () => {
    const onNarratorText = vi.fn();
    const onAgentText = vi.fn();
    const onToolCallStarted = vi.fn();
    const onToolCallCompleted = vi.fn();
    const onTurnComplete = vi.fn();

    const { result } = renderHookWithProvider(
      () => useAgentVoiceChat({
        agentId: 'agent-1',
        browserNarration: false,
        onNarratorText,
        onAgentText,
        onToolCallStarted,
        onToolCallCompleted,
        onTurnComplete,
      }),
      mockClient,
    );

    await act(async () => {
      await result.current.connect();
    });

    const dataHandler = livekitMocks.on.mock.calls.find(
      ([event]) => event === 'DataReceived',
    )?.[1] as ((payload: Uint8Array) => void) | undefined;
    expect(dataHandler).toBeDefined();

    await act(async () => {
      dataHandler?.(new TextEncoder().encode(JSON.stringify({
        type: 'narrator_text',
        text: 'Checking the workspace.',
      })));
      dataHandler?.(new TextEncoder().encode(JSON.stringify({
        type: 'tool_call_started',
        callId: 'call-1',
        name: 'read_file',
        arguments: { path: 'README.md' },
      })));
      dataHandler?.(new TextEncoder().encode(JSON.stringify({
        type: 'tool_call_completed',
        callId: 'call-1',
        success: true,
        result: 'ok',
      })));
      dataHandler?.(new TextEncoder().encode(JSON.stringify({
        type: 'agent_text',
        text: 'Done.',
        isFinal: true,
      })));
      dataHandler?.(new TextEncoder().encode(JSON.stringify({
        type: 'session_cost',
        cost: '$0.00',
      })));
    });

    expect(onNarratorText).toHaveBeenCalledWith('Checking the workspace.');
    expect(onToolCallStarted).toHaveBeenCalledWith({
      callId: 'call-1',
      name: 'read_file',
      arguments: { path: 'README.md' },
    });
    expect(onToolCallCompleted).toHaveBeenCalledWith({
      callId: 'call-1',
      success: true,
      result: 'ok',
    });
    expect(onAgentText).toHaveBeenCalledWith('Done.', true);
    expect(onTurnComplete).toHaveBeenCalledWith('$0.00');
  });
});
