/** fire-and-forget Promise — 미처리 rejection(네트워크 일시 실패 등) 방지 */
export function voidSafe(task: Promise<unknown> | (() => Promise<unknown> | void)): void {
  try {
    const p = typeof task === 'function' ? Promise.resolve(task()) : task;
    if (p != null && typeof (p as Promise<unknown>).catch === 'function') {
      void (p as Promise<unknown>).catch(() => {});
    }
  } catch {
    /* noop */
  }
}
