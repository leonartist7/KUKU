// A private media resource belongs to one account, screen and attachment lifetime.
// Late async completions dispose their resources instead of retaining private bytes.
export function createPrivateMemoLease(isCurrent: () => boolean) {
  let closed = false;
  const cleanups = new Set<() => void>();
  const controller = new AbortController();
  const current = () => !closed && isCurrent();
  const own = (cleanup: () => void) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true; cleanups.delete(release);
      try { cleanup(); } catch { /* One failed cleanup must not retain the rest. */ }
    };
    if (current()) cleanups.add(release); else release();
    return release;
  };
  return {
    current, own, signal: controller.signal,
    close() {
      if (closed) return;
      closed = true; controller.abort();
      for (const cleanup of [...cleanups].reverse()) cleanup();
    },
  };
}

export type PrivateMemoLease = ReturnType<typeof createPrivateMemoLease>;
