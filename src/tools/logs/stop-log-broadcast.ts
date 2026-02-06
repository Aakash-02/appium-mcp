import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { activeSessions } from './start-log-broadcast.js';

export const stopLogBroadcastSchema = z.object({
  sessionId: z.string().describe('The Appium session ID'),
});

export async function executeStopLogBroadcast(args: {
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

  try {
    const logCount = session.logBuffer.length;

    // Kill log process
    if (session.logProcess) {
      session.logProcess.kill('SIGTERM');
      console.error(`Stopped ${session.platform} log process for ${sessionId}`);
    }

    activeSessions.delete(sessionId);

    return {
      content: [
        {
          type: 'text',
          text: `✅ Stopped log streaming for session ${sessionId}
Device: ${session.deviceId || 'default'}
Total logs captured: ${logCount} lines`,
        },
      ],
    };
  } catch (error: any) {
    // Still remove the session even if cleanup fails
    activeSessions.delete(sessionId);
    throw new Error(`Error stopping log streaming: ${error.message}`);
  }
}

export default function stopLogBroadcast(server: FastMCP): void {
  server.addTool({
    name: 'stop_log_broadcast',
    description: 'Stop streaming device logs for an active Appium session.',
    parameters: stopLogBroadcastSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
    },
    execute: async (args: any): Promise<any> => executeStopLogBroadcast(args),
  });
}
