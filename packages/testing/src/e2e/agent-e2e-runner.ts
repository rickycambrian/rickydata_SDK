/**
 * Agent E2E Runner — production test runner for agent chat with image support.
 * Uses raw fetch against the production agent gateway.
 *
 * SSE format from agent gateway:
 *   data: {"type":"thinking","data":"..."}
 *   data: {"type":"text","data":"..."}
 *   data: {"type":"tool_call","data":{...}}
 *   data: {"type":"tool_result","data":{...}}
 *   data: {"type":"screenshare_issue","data":{...}}
 *   data: {"type":"done","data":{...}}
 */

export interface AgentE2EConfig {
  baseUrl: string;  // https://agents.rickydata.org
  authToken: string;  // mcpwt_ or JWT
}

export interface ChatWithImageResult {
  text: string;
  toolCalls: Array<{ name: string; args: unknown }>;
  toolResults: Array<{ name: string; result?: string; isError: boolean }>;
  events: Array<{ type: string; data: unknown }>;
  screenshareIssueDetected: boolean;
  sessionId: string;
  model?: string;
  freeTier?: boolean;
  doneData?: Record<string, unknown>;
}

export class AgentE2ERunner {
  constructor(private config: AgentE2EConfig) {}

  /** Create a new chat session for an agent */
  async createSession(agentId: string, model?: string): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/agents/${agentId}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001' }),
    });
    if (!res.ok) throw new Error(`Session creation failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { id?: string; sessionId?: string };
    return data.id || data.sessionId || '';
  }

  /** Send a chat message with optional images, parse SSE response */
  async chatWithImage(
    agentId: string,
    sessionId: string,
    message: string,
    images?: Array<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }>,
    model?: string,
  ): Promise<ChatWithImageResult> {
    const body: Record<string, unknown> = { message };
    if (images) body.images = images;
    if (model) body.model = model;

    const res = await fetch(
      `${this.config.baseUrl}/agents/${agentId}/sessions/${sessionId}/chat`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.authToken}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`Chat failed: ${res.status} ${await res.text()}`);

    return this.parseSSEResponse(res, sessionId);
  }

  /** Request a voice token for an agent */
  async requestVoiceToken(agentId: string, model?: string): Promise<{ token: string; roomName: string; sessionId: string }> {
    const res = await fetch(`${this.config.baseUrl}/agents/${agentId}/voice/livekit-token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001' }),
    });
    if (!res.ok) throw new Error(`Voice token failed: ${res.status} ${await res.text()}`);
    return await res.json() as { token: string; roomName: string; sessionId: string };
  }

  /**
   * Parse SSE response from agent gateway.
   * Format: `data: {"type":"text","data":"Hello"}` — type is INSIDE the JSON, not as SSE event: prefix.
   */
  private async parseSSEResponse(res: Response, sessionId: string): Promise<ChatWithImageResult> {
    const result: ChatWithImageResult = {
      text: '', toolCalls: [], toolResults: [], events: [],
      screenshareIssueDetected: false, sessionId,
    };

    const body = await res.text();
    const lines = body.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      try {
        const parsed = JSON.parse(jsonStr) as { type: string; data: unknown };
        const eventType = parsed.type;
        const eventData = parsed.data;

        result.events.push({ type: eventType, data: eventData });

        switch (eventType) {
          case 'text':
            if (typeof eventData === 'string') {
              result.text += eventData;
            }
            break;
          case 'tool_call':
            if (typeof eventData === 'object' && eventData !== null) {
              const tc = eventData as Record<string, unknown>;
              result.toolCalls.push({
                name: (tc.name || tc.toolName || '') as string,
                args: tc.arguments || tc.input,
              });
            }
            break;
          case 'tool_result':
            if (typeof eventData === 'object' && eventData !== null) {
              const tr = eventData as Record<string, unknown>;
              result.toolResults.push({
                name: (tr.name || tr.toolName || '') as string,
                result: tr.result as string | undefined,
                isError: !!tr.isError,
              });
            }
            break;
          case 'screenshare_issue':
            result.screenshareIssueDetected = true;
            break;
          case 'done':
            if (typeof eventData === 'object' && eventData !== null) {
              const done = eventData as Record<string, unknown>;
              result.model = done.model as string | undefined;
              result.freeTier = !!done.freeTier;
              result.doneData = done;
            }
            break;
        }
      } catch {
        // Non-JSON data line — skip
      }
    }

    return result;
  }
}
