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

export interface ChildJourney {
  id: string;
  childId: string;
  status: 'NOT_YET_BOARDED' | 'PICKED_UP' | 'ON_VEHICLE' | 'ARRIVED_AT_SCHOOL' | 'DROPPED_OFF' | 'MISSED_PICKUP';
  child: { id: string; firstName: string; lastName: string; idMethod: string };
}

export interface Journey {
  id: string;
  routeId: string;
  direction: 'TO_SCHOOL' | 'FROM_SCHOOL';
  status: 'SCHEDULED' | 'DRIVER_STARTED' | 'COMPLETED' | 'CANCELLED' | string;
  scheduledDate: string;
  route?: { name: string; school?: { name: string }; stops?: { id: string; name: string; sequence: number }[] };
  vehicle?: { registrationNumber: string };
  childJourneys?: ChildJourney[];
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
  login: (dto: { email: string; password: string }) =>
    request<AuthTokens>('/auth/login', { method: 'POST', body: JSON.stringify(dto) }),

  acceptInvite: (dto: { token: string; password: string }) =>
    request<AuthTokens>('/auth/accept-invite', { method: 'POST', body: JSON.stringify(dto) }),

  me: (token: string) => request<AuthenticatedUser>('/users/me', {}, token),

  listMyJourneys: (token: string) => request<Paginated<Journey>>('/journeys?pageSize=50', {}, token),

  getJourney: (token: string, id: string) => request<Journey>(`/journeys/${id}`, {}, token),

  startJourney: (token: string, id: string) => request<Journey>(`/journeys/${id}/start`, { method: 'POST' }, token),

  endJourney: (token: string, id: string) => request<Journey>(`/journeys/${id}/end`, { method: 'POST' }, token),

  reportDelay: (token: string, id: string, reason: string) =>
    request(`/journeys/${id}/delay`, { method: 'POST', body: JSON.stringify({ reason }) }, token),

  verifyChild: (
    token: string,
    journeyId: string,
    childId: string,
    action: 'pickup' | 'dropoff',
    verificationMethod: 'MANUAL' | 'QR' | 'NFC' | 'RFID' = 'MANUAL',
  ) =>
    request<ChildJourney>(
      `/journeys/${journeyId}/children/${childId}/${action}`,
      { method: 'POST', body: JSON.stringify({ verificationMethod }) },
      token,
    ),

  reportLocation: (
    token: string,
    dto: { journeyId: string; latitude: number; longitude: number; speedKph?: number; accuracyMeters?: number },
  ) => request('/tracking/locations', { method: 'POST', body: JSON.stringify(dto) }, token),

  triggerSos: (
    token: string,
    dto: { journeyId: string; latitude?: number; longitude?: number; note?: string },
  ) => request('/emergency/sos', { method: 'POST', body: JSON.stringify(dto) }, token),
};
