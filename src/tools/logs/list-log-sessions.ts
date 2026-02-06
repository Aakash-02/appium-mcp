import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { activeSessions } from './start-log-broadcast.js';

export const listLogSessionsSchema = z.object({});

export async function executeListLogSessions(): Promise<any> {
  if (activeSessions.size === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No active log streaming sessions.',
        },
      ],
    };
  }

  const sessionList = Array.from(activeSessions.values())
    .map(
      (session) =>
        `- Session: ${session.sessionId}
  Platform: ${session.platform}
  Device: ${session.deviceId || 'default'}
  Server: ${session.serverUrl}
  Status: ${session.isStreaming ? 'Streaming' : 'Stopped'}
  Logs buffered: ${session.logBuffer.length}`
    )
    .join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text: `Active Log Sessions (${activeSessions.size}):\n\n${sessionList}`,
      },
    ],
  };
}

export default function listLogSessions(server: FastMCP): void {
  server.addTool({
    name: 'list_log_sessions',
    description:
      'List all active log streaming sessions with their status.',
    parameters: listLogSessionsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    execute: async (): Promise<any> => executeListLogSessions(),
  });
}
