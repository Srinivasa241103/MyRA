export function createSseWriter(res, { heartbeatMs = 15000 } = {}) {
  let closed = false;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const canWrite = () => !closed && !res.destroyed && !res.writableEnded;

  const write = (value) => {
    if (!canWrite()) return false;
    res.write(value);
    res.flush?.();
    return true;
  };

  const heartbeat = setInterval(() => {
    write(": myra-keep-alive\n\n");
  }, heartbeatMs);
  heartbeat.unref?.();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
  };

  res.once("close", cleanup);
  res.once("finish", cleanup);

  return {
    get closed() {
      return closed;
    },
    send(type, { queryId, conversationId, data = null } = {}) {
      return write(`data: ${JSON.stringify({
        type,
        ...(queryId ? { queryId } : {}),
        ...(conversationId ? { conversationId } : {}),
        data,
      })}\n\n`);
    },
    end() {
      if (!canWrite()) {
        cleanup();
        return;
      }
      clearInterval(heartbeat);
      res.end();
      cleanup();
    },
  };
}
