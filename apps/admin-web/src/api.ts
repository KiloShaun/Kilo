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
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  schoolId?: string;
  licenseNumber?: string;
  inviteToken: string;
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
};
