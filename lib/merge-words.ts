// 单词级 last-write-wins 合并：纯函数（无浏览器依赖），供 service worker 与单元测试共用。

export interface MergeWordLike {
  word?: string;
  bookId?: string;
  timeUpdated?: number;
}

/**
 * 以服务端快照为底合并本地词条：本地独有保留；同 key 时取 timeUpdated 较新者；
 * pending 队列条目由调用方另行置顶覆盖（它们代表尚未上行的本地改动）。
 */
export function mergeWordsLastWriteWins<TServer extends MergeWordLike, TLocal extends MergeWordLike, TResult>(
  serverWords: readonly TServer[],
  localWords: readonly TLocal[],
  keyOf: (w: MergeWordLike) => string,
  adopt: (winner: TServer | TLocal) => TResult,
): TResult[] {
  const serverByKey = new Map<string, TServer>();
  for (const sw of serverWords) serverByKey.set(keyOf(sw), sw);
  const mergedByKey = new Map<string, TResult>();
  for (const sw of serverWords) mergedByKey.set(keyOf(sw), adopt(sw));
  for (const lw of localWords) {
    const key = keyOf(lw);
    const server = serverByKey.get(key);
    if (!server || (lw.timeUpdated || 0) > (server.timeUpdated || 0)) {
      mergedByKey.set(key, adopt(lw));
    }
  }
  return [...mergedByKey.values()];
}
