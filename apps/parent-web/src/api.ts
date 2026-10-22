const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'TRANSPORT_OPERATOR' | 'SCHOOL_ADMIN' | 'DRIVER' | 'PARENT' | 'CHILD';
  firstName: string;
  lastName: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  schoolId: string;
}

export interface ChildJourney {
  id: string;
  childId: string;
  status: 'NOT_YET_BOARDED' | 'PICKED_UP' | 'ON_VEHICLE' | 'ARRIVED_AT_SCHOOL' | 'DROPPED_OFF' | 'MISSED_PICKUP';
  child: { id: string; firstName: string; lastName: string };
}

export interface Journey {
  id: string;
  direction: 'TO_SCHOOL' | 'FROM_SCHOOL';
  status: string;
  scheduledDate: string;
  route?: { name: string; school?: { name: string } };
  childJourneys?: ChildJourney[];
}

export interface LatestLocation {
  vehicleId: string;
  freshness: 'LIVE' | 'STALE' | 'OFFLINE';
  location: { latitude: number; longitude: number; recordedAt: string } | null;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/** Mirrors the backend's { error: { code, message, correlationId } } envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }

  return body as T;
}

export const api = {
  register: (dto: { email: string; password: string; firstName: string; lastName: string; phoneNumber?: string }) =>
    request<AuthTokens>('/auth/register', { method: 'POST', body: JSON.stringify(dto) }),

  login: (dto: { email: string; password: string }) =>
    request<AuthTokens>('/auth/login', { method: 'POST', body: JSON.stringify(dto) }),

  me: (token: string) => request<AuthenticatedUser>('/users/me', {}, token),

  myChildren: (token: string) => request<Child[]>('/parents/me/children', {}, token),

  listMyJourneys: (token: string) => request<Paginated<Journey>>('/journeys?pageSize=50', {}, token),

  getJourney: (token: string, id: string) => request<Journey>(`/journeys/${id}`, {}, token),

  getLatestLocation: (token: string, journeyId: string) =>
    request<LatestLocation>(`/tracking/journeys/${journeyId}/location`, {}, token),

  listNotifications: (token: string) =>
    request<Paginated<NotificationItem>>('/notifications?pageSize=50', {}, token),
};
