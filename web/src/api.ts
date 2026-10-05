// 后端 API 封装 + 船梯口离线补传队列（localStorage 模拟设备本地缓存）

const BASE = '/api';

export interface QueuedEvent {
  eventId: string;
  certNo: string;
  direction: 'DISEMBARK' | 'EMBARK';
  scannedAt: string;
}

const QUEUE_KEY = 'gangway.offlineQueue';
const LAST_BATCH_KEY = 'gangway.lastBatch';

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg =
      data?.message && typeof data.message === 'object'
        ? data.message.message
        : data?.message;
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function newEventId(): string {
  // 模拟船梯口扫码设备生成的全局唯一事件号
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `EV-${Date.now().toString(36).toUpperCase()}-${rnd}`;
}

export function loadQueue(): QueuedEvent[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveQueue(q: QueuedEvent[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function loadLastBatch(): QueuedEvent[] | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_BATCH_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function saveLastBatch(b: QueuedEvent[]) {
  localStorage.setItem(LAST_BATCH_KEY, JSON.stringify(b));
}

export async function syncBatch(
  events: QueuedEvent[],
  voyageId?: number,
): Promise<{
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  accepted: any[];
  duplicate: string[];
  rejected: { eventId: string; reason: string; message: string }[];
  notReturned: any[];
}> {
  const batchId = `BATCH-${Date.now().toString(36).toUpperCase()}`;
  const result = await api('/sync', {
    method: 'POST',
    body: JSON.stringify({ voyageId, batchId, events }),
  });
  saveLastBatch(events);
  return result;
}
