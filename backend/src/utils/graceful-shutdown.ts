type ClosableServer = {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};

export async function gracefulShutdown(
  server: ClosableServer,
  disconnect: () => Promise<void>,
  timeoutMs = 15_000,
) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    server.close((error?: Error) => finish(error));
  });
  await disconnect();
}
