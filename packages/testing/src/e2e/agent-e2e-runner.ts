/**
 * Agent E2E Runner — production test runner for agent chat with image support.
 * Uses raw fetch against the production agent gateway.
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
    const data = await res.json() as { sessionId: string };
    return data.sessionId;
  }

  /** Send a chat message with optional images, parse SSE response */
  async chatWithImage(
    agentId: string,
    sessionId: string,
    message: string,
    images?: Array<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }>,
    model?: string,
  ): Promise<ChatWithImageResult> {
    // Build body
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

  private async parseSSEResponse(res: Response, sessionId: string): Promise<ChatWithImageResult> {
    const result: ChatWithImageResult = {
      text: '', toolCalls: [], toolResults: [], events: [],
      screenshareIssueDetected: false, sessionId,
    };

    const text = await res.text();
    const lines = text.split('\n');
    let currentEvent = '';
    let currentData = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
        try {
          const parsed = JSON.parse(currentData);
          result.events.push({ type: currentEvent || 'message', data: parsed });

          if (currentEvent === 'text' && typeof parsed.text === 'string') {
            result.text += parsed.text;
          } else if (currentEvent === 'tool_call') {
            result.toolCalls.push({ name: parsed.name || parsed.toolName, args: parsed.arguments || parsed.input });
          } else if (currentEvent === 'tool_result') {
            result.toolResults.push({ name: parsed.name || parsed.toolName, result: parsed.result, isError: !!parsed.isError });
          } else if (currentEvent === 'screenshare_issue') {
            result.screenshareIssueDetected = true;
          }
        } catch {
          // Non-JSON data line, could be plain text
          if (currentEvent === 'text') result.text += currentData;
        }
        currentEvent = '';
        currentData = '';
      }
    }

    return result;
  }
}
