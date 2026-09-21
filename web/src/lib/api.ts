export interface Account {
  accountNumber: string;
  label: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AgentInfo {
  executor: string;
  executorVersion: string;
  gameName: string;
  placeId: number;
  jobId: string;
  playerName: string;
  playerUserId: number;
  startedAt: number;
  platform?: string;
  uptimeSeconds?: number;
}

export interface SessionStatus {
  accountId: string;
  online: boolean;
  lastSeenAt: number | null;
  connectedAt: number | null;
  info: AgentInfo | null;
  queued: number;
  inflight: number;
  consoleSeq: number;
  executions: number;
  errors: number;
}

export interface ConsoleEntry {
  seq: number;
  at: number;
  level: "print" | "warn" | "error" | "info" | "game";
  message: string;
}

export interface Credentials {
  connectKey: string;
  mcpToken: string;
}

export interface LoaderInfo {
  url: string;
  loadstring: string;
}

export interface MeResponse {
  account: Account;
  credentials: Credentials;
  loader: LoaderInfo;
  mcp: { url: string; token: string };
  status: SessionStatus;
}

export interface MetaResponse {
  version: string;
  publicUrl: string;
  accountCreationEnabled: boolean;
  requiresBootstrap: boolean;
  maxAccounts: number;
  accountCount: number;
  onlineSessions: number;
  rateLimits: { accountPerHour: number; accountPerDay: number };
}

export interface ToolInfo {
  name: string;
  title: string;
  group: string;
  description: string;
}

export interface ActivityEvent {
  event: string;
  detail: string | null;
  ip: string | null;
  created_at: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; message?: string };
    throw new ApiError(
      response.status,
      body.error ?? "request_failed",
      body.message ?? `Request failed with status ${response.status}`,
    );
  }

  return payload as T;
}

export const api = {
  meta: () => request<MetaResponse>("/api/meta"),
  tools: () => request<{ tools: ToolInfo[] }>("/api/tools"),

  createAccount: (bootstrap?: string) => {
    const query = bootstrap ? `?bootstrap=${encodeURIComponent(bootstrap)}` : "";
    return request<{
      account: Account;
      credentials: Credentials;
      loader: LoaderInfo;
    }>(`/api/accounts${query}`, { method: "POST", body: JSON.stringify({}) });
  },

  login: (accountNumber: string) =>
    request<{ account: Account }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ accountNumber }),
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" }),

  session: () => request<{ authenticated: boolean; account?: Account }>("/api/auth/session"),

  me: () => request<MeResponse>("/api/me"),

  setLabel: (label: string | null) =>
    request<{ ok: true; label: string | null }>("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),

  rotateConnectKey: () =>
    request<{ connectKey: string; loader: LoaderInfo }>("/api/me/rotate/connect-key", {
      method: "POST",
      body: "{}",
    }),

  rotateMcpToken: () =>
    request<{ mcpToken: string; mcpUrl: string }>("/api/me/rotate/mcp-token", {
      method: "POST",
      body: "{}",
    }),

  deleteAccount: (confirm: string) =>
    request<{ ok: true }>("/api/me", { method: "DELETE", body: JSON.stringify({ confirm }) }),

  status: () => request<SessionStatus>("/api/me/status"),

  console: (since = 0, limit = 200) =>
    request<{ entries: ConsoleEntry[]; latestSeq: number }>(
      `/api/me/console?since=${since}&limit=${limit}`,
    ),

  clearConsole: () => request<{ ok: true }>("/api/me/console", { method: "DELETE" }),

  resetSession: () => request<{ ok: true }>("/api/me/reset", { method: "POST", body: "{}" }),

  activity: () => request<{ events: ActivityEvent[] }>("/api/me/activity"),
};
