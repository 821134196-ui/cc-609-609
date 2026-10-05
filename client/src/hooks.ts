import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { StatusBoard } from './types';

/** 获取航次值守状态板；pollMs > 0 时定时刷新 */
export function useStatus(voyageId: string, pollMs = 0) {
  const [data, setData] = useState<StatusBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api.getStatus(voyageId));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    }
  }, [voyageId]);
  useEffect(() => {
    load();
    if (pollMs > 0) {
      const t = setInterval(load, pollMs);
      return () => clearInterval(t);
    }
  }, [load, pollMs]);
  return { data, error, reload: load };
}
