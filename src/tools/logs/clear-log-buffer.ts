import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { activeSessions } from './start-log-broadcast.js';

export const clearLogBufferSchema = z.object({
  sessionId: z.string().describe('The Appium session ID'),
});

export async function executeClearLogBuffer(args: {
  sessionId: string;
}): Promise<any> {
  const { sessionId } = args;

  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: `No active log session found for ${sessionId}`,
        },
      ],
    };
  }

  const clearedCount = session.logBuffer.length;
  session.logBuffer.length = 0;

  return {
    content: [
      {
        type: 'text',
        text: `Cleared ${clearedCount} log lines from buffer for session ${sessionId}. Log streaming continues.`,
      },
    ],
  };
}

export default function clearLogBuffer(server: FastMCP): void {
  server.addTool({
    name: 'clear_log_buffer',
    description:
      'Clear the log buffer for a session while keeping the broadcast active.',
    parameters: clearLogBufferSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
    },
    execute: async (args: any): Promise<any> => executeClearLogBuffer(args),
  });
}
