/**
 * Forward SIGINT and SIGTERM to a child, then exit with the conventional code.
 * Re-raising the same signal here would re-enter the handler and leave the
 * parent process alive after the child has already died.
 */
export function bindChildSignals(child) {
  child.on('error', () => {
    process.exit(1);
  });

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      child.kill(signal);
    });
  }

  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT') process.exit(130);
    if (signal === 'SIGTERM') process.exit(143);
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}
