import type {
  Confirmation,
  ListDetail,
  ListVersion,
  Member,
  PassEventRow,
  ScanEventInput,
  ScanResult,
  StatusBoard,
  VoyageSummary,
} from './types';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    const msg = body?.message;
    super(Array.isArray(msg) ? msg.join('；') : msg ?? `请求失败 (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const post = <T>(path: string, data: unknown) =>
  req<T>(path, { method: 'POST', body: JSON.stringify(data) });

export const api = {
  listVoyages: () => req<VoyageSummary[]>('/voyages'),
  createVoyage: (data: { voyageNo: string; vessel: string }) =>
    post<VoyageSummary>('/voyages', data),

  getStatus: (voyageId: string) => req<StatusBoard>(`/voyages/${voyageId}/status`),

  getLists: (voyageId: string) => req<ListVersion[]>(`/voyages/${voyageId}/lists`),
  getListMembers: (voyageId: string, version: number) =>
    req<ListDetail>(`/voyages/${voyageId}/lists/${version}`),
  submitList: (
    voyageId: string,
    data: { submittedBy: string; note?: string; members: { name: string; docNo: string; photoUrl?: string }[] },
  ) => post<ListDetail>(`/voyages/${voyageId}/lists`, data),

  scan: (event: ScanEventInput) => post<ScanResult>('/scan', event),
  scanBatch: (events: ScanEventInput[]) => post<{ results: ScanResult[] }>('/scan/batch', { events }),

  getEvents: (voyageId: string, filter: { direction?: string; result?: string; docNo?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.direction) params.set('direction', filter.direction);
    if (filter.result) params.set('result', filter.result);
    if (filter.docNo) params.set('docNo', filter.docNo);
    const qs = params.toString();
    return req<PassEventRow[]>(`/voyages/${voyageId}/events${qs ? `?${qs}` : ''}`);
  },

  suspendMember: (memberId: string, note?: string) =>
    post<Member>(`/members/${memberId}/suspend`, { note }),
  resolveMember: (memberId: string, note?: string) =>
    post<Member>(`/members/${memberId}/resolve`, { note }),

  confirmDeparture: (voyageId: string, confirmedBy: string) =>
    post<{ confirmation: Confirmation }>(`/voyages/${voyageId}/confirm-departure`, { confirmedBy }),
  getConfirmations: (voyageId: string) => req<Confirmation[]>(`/voyages/${voyageId}/confirmations`),
};

/** 本地生成 SVG 头像（无照片时兜底，离线可用） */
export function avatarFor(name: string): string {
  const colors = ['#4f6bed', '#0e7a5f', '#b04a6b', '#8a6d1d', '#5b4a9e'];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = colors[h % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${color}"/><text x="48" y="62" font-size="42" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${(name[0] ?? '?')}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false });
}
