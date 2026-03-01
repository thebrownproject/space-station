import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';

export interface EmbeddedNats {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Start an embedded NATS server as a child process.
 *
 * Requires `nats-server` to be installed and available in PATH.
 * The server is started on the given port (default 4222) and the
 * function waits for it to accept TCP connections before returning.
 *
 * Call `stop()` on the returned object to kill the server process.
 */
export async function startEmbeddedNats(port = 4222): Promise<EmbeddedNats> {
  // Check if nats-server is available
  const child = await spawnNatsServer(port);
  const url = `nats://127.0.0.1:${port}`;

  // Wait for the server to be ready
  await waitForPort(port, 5000);

  return {
    url,
    port,
    stop: () => stopNatsServer(child),
  };
}

function spawnNatsServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('nats-server', ['-p', String(port)], {
      stdio: 'pipe',
      detached: false,
    });

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            'nats-server not found in PATH. Install it:\n' +
            '  macOS:  brew install nats-server\n' +
            '  Linux:  curl -sf https://binaries.nats.dev/nats-io/nats-server/v2@latest | sh\n' +
            '  Docker: docker run -p 4222:4222 nats:latest\n' +
            'Or set natsUrl in config to connect to an external NATS server.',
          ),
        );
      } else {
        reject(err);
      }
    });

    // Give the process a moment to fail or start
    const startTimer = setTimeout(() => {
      resolve(child);
    }, 200);

    child.on('exit', (code) => {
      clearTimeout(startTimer);
      if (code !== null && code !== 0) {
        reject(new Error(`nats-server exited with code ${code}`));
      }
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function tryConnect() {
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for nats-server on port ${port}`));
        return;
      }

      const socket = createConnection({ port, host: '127.0.0.1' });
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(tryConnect, 100);
      });
    }

    tryConnect();
  });
}

function stopNatsServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    child.on('exit', () => resolve());
    child.kill('SIGTERM');

    // Force kill after 3 seconds
    setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 3000);
  });
}
