export interface VoyageSummary {
  id: string;
  voyageNo: string;
  vessel: string;
  status: 'OPEN' | 'DEPARTED';
  createdAt: string;
  lists: { version: number }[];
  confirmations: { confirmedBy: string; createdAt: string }[];
}

export interface Member {
  id: string;
  name: string;
  docNo: string;
  docTail: string;
  photoUrl: string | null;
  status: 'NORMAL' | 'SUSPENDED';
  statusNote: string | null;
  state: 'ON_BOARD' | 'ASHORE';
  lastDirection: 'ASHORE' | 'RETURN' | null;
  lastEventAt: string | null;
}

export interface StatusBoard {
  voyage: { id: string; voyageNo: string; vessel: string; status: string; createdAt: string };
  activeList: {
    id: string;
    version: number;
    submittedBy: string;
    note: string | null;
    createdAt: string;
  } | null;
  members: Member[];
  notReturned: Member[];
  removedAshore: { docNo: string; docTail: string; name: string | null; lastEventAt: string }[];
}

export interface ListVersion {
  id: string;
  version: number;
  status: 'ACTIVE' | 'SUPERSEDED';
  submittedBy: string;
  note: string | null;
  createdAt: string;
  _count: { members: number };
}

export interface ListMember {
  id: string;
  name: string;
  docNo: string;
  docTail: string;
  photoUrl: string | null;
  status: string;
  statusNote: string | null;
}

export interface ListDetail {
  id: string;
  version: number;
  status: string;
  submittedBy: string;
  note: string | null;
  createdAt: string;
  members: ListMember[];
}

export interface ScanResult {
  eventNo: string;
  result: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE' | 'INVALID';
  originalResult?: string | null;
  reason: string | null;
}

export interface PassEventRow {
  id: string;
  eventNo: string;
  direction: 'ASHORE' | 'RETURN';
  source: string;
  result: string;
  reason: string | null;
  occurredAt: string;
  receivedAt: string;
  docNo: string;
  docTail: string;
  memberName: string | null;
}

export interface Confirmation {
  id: string;
  confirmedBy: string;
  listVersion: number;
  createdAt: string;
  snapshot: { memberId: string; name: string; docTail: string; state: string }[];
}

export interface ScanEventInput {
  eventNo: string;
  voyageId: string;
  docNo: string;
  direction: 'ASHORE' | 'RETURN';
  occurredAt: string;
  source?: string;
}
