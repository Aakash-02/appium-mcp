import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { activeSessions } from './start-log-broadcast.js';

export const getLogsSchema = z.object({
  sessionId: z.string().describe('The Appium session ID'),
  maxLines: z
    .number()
    .optional()
    .describe('Maximum number of recent log lines to return (default: 100)'),
});

export async function executeGetLogs(args: {
  sessionId: string;
  maxLines?: number;
}): Promise<any> {
  const { sessionId } = args;
  const maxLines = args.maxLines || 100;

  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: `No active log session found for ${sessionId}. Use 'start_log_broadcast' first.`,
        },
      ],
    };
  }

  const logs = session.logBuffer.slice(-maxLines);
  const totalCount = session.logBuffer.length;

  return {
    content: [
      {
        type: 'text',
        text: `=== ${session.platform.toUpperCase()} Logs for Session ${sessionId} ===
Status: ${session.isStreaming ? 'Streaming' : 'Stopped'}
Device: ${session.deviceId || 'default'}
Total logs captured: ${totalCount}
Showing last ${logs.length} lines:

${logs.join('\n')}

${totalCount > maxLines ? `\n(Showing ${maxLines} of ${totalCount} total lines. Increase maxLines to see more.)` : ''}`,
      },
    ],
  };
}

export default function getLogs(server: FastMCP): void {
  server.addTool({
    name: 'get_logs',
    description:
      'Get captured logs from the buffer since log broadcasting started. Returns all logs collected so far.',
    parameters: getLogsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    execute: async (args: any): Promise<any> => executeGetLogs(args),
  });
}
