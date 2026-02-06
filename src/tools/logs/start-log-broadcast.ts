import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { getDriver } from '../../session-store.js';
import type { NullableDriverInstance } from '../../session-store.js';
import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';

// Types
interface LogSession {
  sessionId: string;
  serverUrl: string;
  platform: 'android' | 'ios';
  deviceId?: string;
  logProcess?: ChildProcess;
  logBuffer: string[];
  isStreaming: boolean;
}

// Global state
const activeSessions = new Map<string, LogSession>();

export interface StartLogBroadcastDeps {
  getDriver: () => NullableDriverInstance;
  spawn: typeof spawn;
  axios: typeof axios;
}

const defaultDeps: StartLogBroadcastDeps = {
  getDriver,
  spawn,
  axios,
};

export async function executeStartLogBroadcast(
  args: {
    sessionId: string;
    platform: 'android' | 'ios';
    serverUrl?: string;
    deviceId?: string;
  },
  deps: StartLogBroadcastDeps = defaultDeps
): Promise<any> {
  const { sessionId, platform, deviceId: providedDeviceId } = args;
  const serverUrl = args.serverUrl || 'http://localhost:4723';
  let deviceId = providedDeviceId;

  // Check if already streaming
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId)!;
    if (session.isStreaming) {
      return {
        content: [
          {
            type: 'text',
            text: `Log streaming is already active for session ${sessionId}\nDevice: ${session.deviceId || 'default'}`,
          },
        ],
      };
    }
  }

  // If no deviceId provided, try to get it from Appium session
  if (!deviceId) {
    try {
      const sessionResponse = await deps.axios.get(
        `${serverUrl}/session/${sessionId}`
      );
      deviceId =
        sessionResponse.data?.value?.capabilities?.['appium:udid'];
      if (deviceId) {
        console.error(`Auto-detected device ID: ${deviceId}`);
      }
    } catch (error) {
      console.error('Could not auto-detect device ID from session');
    }
  }

  const logBuffer: string[] = [];

  // Start log capture based on platform
  if (platform === 'android') {
    return await startAndroidLogs(
      sessionId,
      serverUrl,
      deviceId,
      logBuffer,
      deps
    );
  } else {
    return await startIosLogs(sessionId, serverUrl, deviceId, logBuffer, deps);
  }
}

async function startAndroidLogs(
  sessionId: string,
  serverUrl: string,
  deviceId: string | undefined,
  logBuffer: string[],
  deps: StartLogBroadcastDeps
): Promise<any> {
  // Build command
  const adbCmd = deviceId
    ? `adb -s ${deviceId} logcat -v time`
    : `adb logcat -v time`;

  console.error(`Starting Android logs: ${adbCmd}`);

  // Spawn with shell to ensure PATH is available
  const logProcess = deps.spawn(adbCmd, [], { shell: true });

  let hasData = false;

  logProcess.stdout?.on('data', (data) => {
    hasData = true;
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        logBuffer.push(line);
        // Keep buffer size manageable (last 10000 lines)
        if (logBuffer.length > 10000) {
          logBuffer.shift();
        }
      }
    }
  });

  logProcess.stderr?.on('data', (data) => {
    console.error(`ADB stderr: ${data}`);
  });

  logProcess.on('error', (error) => {
    console.error(`ADB process error: ${error.message}`);
    const session = activeSessions.get(sessionId);
    if (session) {
      session.isStreaming = false;
    }
  });

  logProcess.on('close', (code) => {
    console.error(`ADB process closed with code ${code}`);
    const session = activeSessions.get(sessionId);
    if (session) {
      session.isStreaming = false;
    }
  });

  // Wait a moment to see if the process starts successfully
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (logProcess.exitCode !== null) {
    throw new Error(
      `Failed to start adb logcat (exit code: ${logProcess.exitCode}). Make sure adb is installed and device is connected. Try running 'adb devices' to verify.`
    );
  }

  if (!hasData) {
    console.error('Warning: No log data received yet, but process is running');
  }

  // Store session
  activeSessions.set(sessionId, {
    sessionId,
    serverUrl,
    platform: 'android',
    deviceId,
    logProcess,
    logBuffer,
    isStreaming: true,
  });

  return {
    content: [
      {
        type: 'text',
        text: `✅ Started Android log streaming for session ${sessionId}
Device: ${deviceId || 'default device'}
Command: ${adbCmd}

Logs are being captured in real-time. Use 'get_logs' to retrieve them.

💡 Tip: Wait a few seconds for logs to buffer, then call get_logs to see them.`,
      },
    ],
  };
}

async function startIosLogs(
  sessionId: string,
  serverUrl: string,
  deviceId: string | undefined,
  logBuffer: string[],
  deps: StartLogBroadcastDeps
): Promise<any> {
  let logProcess: ChildProcess;
  let command: string;
  let toolName: string;

  // Determine if it's a simulator or real device
  const isSimulator =
    deviceId && (deviceId.includes('-') || deviceId.length > 25);

  if (isSimulator) {
    // iOS Simulator - use simctl
    command = deviceId
      ? `xcrun simctl spawn ${deviceId} log stream --level debug`
      : `xcrun simctl spawn booted log stream --level debug`;

    const args = deviceId
      ? ['simctl', 'spawn', deviceId, 'log', 'stream', '--level', 'debug']
      : ['simctl', 'spawn', 'booted', 'log', 'stream', '--level', 'debug'];

    logProcess = deps.spawn('xcrun', args);
    toolName = 'iOS Simulator (simctl)';
  } else {
    // Real iOS device - use idevicesyslog
    const args = deviceId ? ['-u', deviceId] : [];
    command = deviceId ? `idevicesyslog -u ${deviceId}` : `idevicesyslog`;
    logProcess = deps.spawn('idevicesyslog', args);
    toolName = 'iOS Device (idevicesyslog)';
  }

  console.error(`Starting iOS logs: ${command}`);

  logProcess.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        logBuffer.push(line);
        // Keep buffer size manageable (last 10000 lines)
        if (logBuffer.length > 10000) {
          logBuffer.shift();
        }
      }
    }
  });

  logProcess.stderr?.on('data', (data) => {
    const stderrText = data.toString();
    // Only log if it's an actual error (not just informational messages)
    if (stderrText.toLowerCase().includes('error')) {
      console.error(`iOS log stderr: ${stderrText}`);
    }
  });

  logProcess.on('error', (error) => {
    console.error(`iOS log process error: ${error.message}`);
    const session = activeSessions.get(sessionId);
    if (session) {
      session.isStreaming = false;
    }
  });

  logProcess.on('close', (code) => {
    console.error(`iOS log process closed with code ${code}`);
    const session = activeSessions.get(sessionId);
    if (session) {
      session.isStreaming = false;
    }
  });

  // Wait a moment to see if the process starts successfully
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (logProcess.exitCode !== null) {
    const errorMsg = isSimulator
      ? 'Failed to start iOS simulator logs. Make sure Xcode is installed and simulator is running.'
      : "Failed to start iOS device logs. Make sure 'idevicesyslog' is installed (brew install libimobiledevice) and device is connected.";
    throw new Error(errorMsg);
  }

  // Store session
  activeSessions.set(sessionId, {
    sessionId,
    serverUrl,
    platform: 'ios',
    deviceId,
    logProcess,
    logBuffer,
    isStreaming: true,
  });

  return {
    content: [
      {
        type: 'text',
        text: `✅ Started iOS log streaming for session ${sessionId}
Device: ${deviceId || 'default device'}
Type: ${toolName}
Command: ${command}

Logs are being captured in real-time. Use 'get_logs' to retrieve them.

💡 Tip: Wait a few seconds for logs to buffer, then call get_logs to see them.`,
      },
    ],
  };
}

export const startLogBroadcastSchema = z.object({
  sessionId: z.string().describe('The Appium session ID'),
  platform: z.enum(['android', 'ios']).describe('Mobile platform'),
  serverUrl: z.string().optional().describe('Appium server URL'),
  deviceId: z
    .string()
    .optional()
    .describe('Device UDID (auto-detected if not provided)'),
});

export default function startLogBroadcast(server: FastMCP): void {
  server.addTool({
    name: 'start_log_broadcast',
    description:
      'Start capturing device logs directly from the device. Uses adb logcat for Android and idevicesyslog/simctl for iOS. Works with any Appium version.',
    parameters: startLogBroadcastSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
    },
    execute: async (args: any): Promise<any> => executeStartLogBroadcast(args),
  });
}

export { activeSessions };
