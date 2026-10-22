const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'TRANSPORT_OPERATOR' | 'SCHOOL_ADMIN' | 'DRIVER' | 'PARENT' | 'CHILD';
  firstName: string;
  lastName: string;
  phoneNumber?: string | null;
  createdAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export interface School {
  id: string;
  name: string;
  address: string;
  contactPhone?: string | null;
  createdAt: string;
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
  parentId: string;
  schoolId: string;
  dateOfBirth?: string | null;
  idMethod: string;
}

export interface InvitedAccountResult {
  id: string;
  driverId?: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  schoolId?: string;
  licenseNumber?: string;
  inviteToken: string;
}

export interface ParentRecord {
  id: string;
  user: { email: string; firstName: string; lastName: string };
}

export interface Vehicle {
  id: string;
  registrationNumber: string;
  make?: string | null;
  model?: string | null;
  capacity: number;
  vehicleType: string;
}

export interface Driver {
  id: string;
  licenseNumber: string;
  status: string;
  user: { firstName: string; lastName: string; email: string };
}

export interface RouteStop {
  id: string;
  sequence: number;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Route {
  id: string;
  name: string;
  schoolId: string;
  stops: RouteStop[];
  assignments?: { driver: Driver; vehicle: Vehicle }[];
  childAssignments?: { child: Child; pickupStop?: RouteStop | null }[];
}

export interface ChildJourney {
  id: string;
  childId: string;
  status: string;
  child: Child;
  actualPickupTime?: string | null;
  actualDropoffTime?: string | null;
}

export interface JourneyEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  childId?: string | null;
}

export interface Journey {
  id: string;
  routeId: string;
  vehicleId: string;
  driverId: string;
  direction: string;
  status: string;
  scheduledDate: string;
  startedAt?: string | null;
  completedAt?: string | null;
  route?: { name: string; school?: { name: string } };
  vehicle?: Vehicle;
  driver?: Driver;
  childJourneys?: ChildJourney[];
  events?: JourneyEvent[];
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  eventType: string;
  status: string;
  createdAt: string;
}

export interface LatestLocation {
  vehicleId: string;
  freshness: 'LIVE' | 'STALE' | 'OFFLINE';
  location: { latitude: number; longitude: number; recordedAt: string } | null;
}

export interface EmergencyIncident {
  id: string;
  status: 'TRIGGERED' | 'ACKNOWLEDGED' | 'RESOLVED';
  note?: string | null;
  triggeredAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  affectedChildIds: string[];
  journey?: { route?: { name: string }; vehicle?: Vehicle };
  timeline?: JourneyEvent[];
}

/** Mirrors the backend's { error: { code, message, correlationId } } envelope — see docs/api-spec.yaml. */
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

  bootstrap: (dto: { email: string; password: string; firstName: string; lastName: string; phoneNumber?: string }) =>
    request<AuthTokens>('/auth/bootstrap', { method: 'POST', body: JSON.stringify(dto) }),

  acceptInvite: (dto: { token: string; password: string }) =>
    request<AuthTokens>('/auth/accept-invite', { method: 'POST', body: JSON.stringify(dto) }),

  me: (token: string) => request<AuthenticatedUser>('/users/me', {}, token),

  myChildren: (token: string) => request<Child[]>('/parents/me/children', {}, token),

  listSchools: (token: string, page = 1, pageSize = 20) =>
    request<Paginated<School>>(`/schools?page=${page}&pageSize=${pageSize}`, {}, token),

  createSchool: (token: string, dto: { name: string; address: string; contactPhone?: string }) =>
    request<School>('/schools', { method: 'POST', body: JSON.stringify(dto) }, token),

  createChild: (
    token: string,
    dto: { firstName: string; lastName: string; parentId: string; schoolId: string; dateOfBirth?: string },
  ) => request<Child>('/children', { method: 'POST', body: JSON.stringify(dto) }, token),

  getChild: (token: string, id: string) => request<Child>(`/children/${id}`, {}, token),

  findParentByEmail: (token: string, email: string) =>
    request<Paginated<ParentRecord>>(`/parents?email=${encodeURIComponent(email)}`, {}, token),

  createDriver: (
    token: string,
    dto: { email: string; firstName: string; lastName: string; licenseNumber: string; phoneNumber?: string },
  ) => request<InvitedAccountResult>('/drivers', { method: 'POST', body: JSON.stringify(dto) }, token),

  createTransportOperator: (
    token: string,
    dto: { email: string; firstName: string; lastName: string; phoneNumber?: string },
  ) => request<InvitedAccountResult>('/transport-operators', { method: 'POST', body: JSON.stringify(dto) }, token),

  createSchoolAdmin: (
    token: string,
    dto: { email: string; firstName: string; lastName: string; schoolId: string; phoneNumber?: string },
  ) => request<InvitedAccountResult>('/school-admins', { method: 'POST', body: JSON.stringify(dto) }, token),

  listVehicles: (token: string) => request<Paginated<Vehicle>>('/vehicles?pageSize=100', {}, token),

  createVehicle: (
    token: string,
    dto: { registrationNumber: string; capacity: number; vehicleType: string; make?: string; model?: string },
  ) => request<Vehicle>('/vehicles', { method: 'POST', body: JSON.stringify(dto) }, token),

  listDrivers: (token: string) => request<Paginated<Driver>>('/drivers?pageSize=100', {}, token),

  listRoutes: (token: string) => request<Paginated<Route>>('/routes?pageSize=100', {}, token),

  createRoute: (
    token: string,
    dto: {
      name: string;
      schoolId: string;
      stops?: { sequence: number; name: string; latitude: number; longitude: number }[];
    },
  ) => request<Route>('/routes', { method: 'POST', body: JSON.stringify(dto) }, token),

  getRoute: (token: string, id: string) => request<Route>(`/routes/${id}`, {}, token),

  assignRoute: (token: string, routeId: string, dto: { driverId: string; vehicleId: string }) =>
    request(`/routes/${routeId}/assignments`, { method: 'POST', body: JSON.stringify(dto) }, token),

  assignChildToRoute: (token: string, routeId: string, dto: { childId: string; pickupStopId?: string }) =>
    request(`/routes/${routeId}/children`, { method: 'POST', body: JSON.stringify(dto) }, token),

  listJourneys: (token: string) => request<Paginated<Journey>>('/journeys?pageSize=100', {}, token),

  getJourney: (token: string, id: string) => request<Journey>(`/journeys/${id}`, {}, token),

  createJourney: (
    token: string,
    dto: { routeId: string; direction: 'TO_SCHOOL' | 'FROM_SCHOOL'; scheduledDate: string },
  ) => request<Journey>('/journeys', { method: 'POST', body: JSON.stringify(dto) }, token),

  startJourney: (token: string, id: string) => request<Journey>(`/journeys/${id}/start`, { method: 'POST' }, token),

  endJourney: (token: string, id: string) => request<Journey>(`/journeys/${id}/end`, { method: 'POST' }, token),

  reportDelay: (token: string, id: string, reason: string) =>
    request(`/journeys/${id}/delay`, { method: 'POST', body: JSON.stringify({ reason }) }, token),

  pickupChild: (token: string, journeyId: string, childId: string, verificationMethod = 'MANUAL') =>
    request(
      `/journeys/${journeyId}/children/${childId}/pickup`,
      { method: 'POST', body: JSON.stringify({ verificationMethod }) },
      token,
    ),

  dropoffChild: (token: string, journeyId: string, childId: string, verificationMethod = 'MANUAL') =>
    request(
      `/journeys/${journeyId}/children/${childId}/dropoff`,
      { method: 'POST', body: JSON.stringify({ verificationMethod }) },
      token,
    ),

  reportLocation: (
    token: string,
    dto: { journeyId: string; latitude: number; longitude: number; speedKph?: number },
  ) => request('/tracking/locations', { method: 'POST', body: JSON.stringify(dto) }, token),

  getLatestLocation: (token: string, journeyId: string) =>
    request<LatestLocation>(`/tracking/journeys/${journeyId}/location`, {}, token),

  listNotifications: (token: string) =>
    request<Paginated<NotificationItem>>('/notifications?pageSize=50', {}, token),

  listIncidents: (token: string) =>
    request<Paginated<EmergencyIncident>>('/emergency?pageSize=50', {}, token),

  getIncident: (token: string, id: string) => request<EmergencyIncident>(`/emergency/${id}`, {}, token),

  triggerSos: (
    token: string,
    dto: { journeyId: string; latitude?: number; longitude?: number; note?: string },
  ) => request<EmergencyIncident>('/emergency/sos', { method: 'POST', body: JSON.stringify(dto) }, token),

  acknowledgeIncident: (token: string, id: string) =>
    request<EmergencyIncident>(`/emergency/${id}/acknowledge`, { method: 'POST' }, token),

  resolveIncident: (token: string, id: string, note?: string) =>
    request<EmergencyIncident>(`/emergency/${id}/resolve`, { method: 'POST', body: JSON.stringify({ note }) }, token),
};
