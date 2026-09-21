import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { log } from "../logger.js";

export type LogLevel = "print" | "warn" | "error" | "info" | "game";

export interface ConsoleEntry {
  seq: number;
  at: number;
  level: LogLevel;
  message: string;
}

export interface ResultPayload {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
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
}

interface QueuedCommand {
  id: string;
  method: string;
  params: unknown;
  createdAt: number;
}

interface PendingCommand extends QueuedCommand {
  resolve: (value: unknown) => void;
  reject: (err: RelayError) => void;
  timer: NodeJS.Timeout;
}

export class RelayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RelayError";
    this.code = code;
  }
}

export interface SessionSnapshot {
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

interface Session {
  accountId: string;
  connectKey: string;
  bootId: string | null;
  queue: QueuedCommand[];
  pending: Map<string, PendingCommand>;
  console: ConsoleEntry[];
  consoleSeq: number;
  info: AgentInfo | null;
  lastSeenAt: number | null;
  connectedAt: number | null;
  executions: number;
  errors: number;
  waiter: (() => void) | null;
}

export interface SyncPayload {
  bootId: string;
  info?: Partial<AgentInfo>;
  results?: ResultPayload[];
  console?: Array<{ level?: LogLevel; message: string }>;
}

export interface SyncResponse {
  ok: true;
  serverTime: number;
  commands: Array<{ id: string; method: string; params: unknown }>;
  pollTimeoutMs: number;
  commandTimeoutMs: number;
  consoleBufferSize: number;
}

type HubEvent =
  | { type: "session"; accountId: string; snapshot: SessionSnapshot }
  | { type: "console"; accountId: string; entries: ConsoleEntry[] }
  | { type: "command"; accountId: string; method: string; id: string };

class Hub {
  private readonly sessions = new Map<string, Session>();
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(0);
    setInterval(() => this.collectGarbage(), 30_000).unref();
  }

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.bus.on("event", listener);
    return () => this.bus.off("event", listener);
  }

  private emitEvent(event: HubEvent): void {
    this.bus.emit("event", event);
  }

  private ensure(accountId: string, connectKey: string): Session {
    let session = this.sessions.get(accountId);
    if (!session) {
      session = {
        accountId,
        connectKey,
        bootId: null,
        queue: [],
        pending: new Map(),
        console: [],
        consoleSeq: 0,
        info: null,
        lastSeenAt: null,
        connectedAt: null,
        executions: 0,
        errors: 0,
        waiter: null,
      };
      this.sessions.set(accountId, session);
    }
    return session;
  }

  snapshot(accountId: string): SessionSnapshot {
    const session = this.sessions.get(accountId);
    if (!session) {
      return {
        accountId,
        online: false,
        lastSeenAt: null,
        connectedAt: null,
        info: null,
        queued: 0,
        inflight: 0,
        consoleSeq: 0,
        executions: 0,
        errors: 0,
      };
    }
    return {
      accountId,
      online: this.isOnline(session),
      lastSeenAt: session.lastSeenAt,
      connectedAt: session.connectedAt,
      info: session.info,
      queued: session.queue.length,
      inflight: session.pending.size,
      consoleSeq: session.consoleSeq,
      executions: session.executions,
      errors: session.errors,
    };
  }

  isOnline(session: Session): boolean {
    if (!session.lastSeenAt) return false;
    return Date.now() - session.lastSeenAt < config.agentStaleSeconds * 1000;
  }

  isAccountOnline(accountId: string): boolean {
    const session = this.sessions.get(accountId);
    return session ? this.isOnline(session) : false;
  }

  /** Number of accounts with a live executor attached. */
  onlineCount(): number {
    let n = 0;
    for (const session of this.sessions.values()) if (this.isOnline(session)) n += 1;
    return n;
  }

  /**
   * The single endpoint a Lua agent talks to. Results and console lines are
   * ingested, then the request parks until a command is available (or the poll
   * window elapses) so idle agents do not hot-loop the server.
   */
  async sync(accountId: string, connectKey: string, payload: SyncPayload): Promise<SyncResponse> {
    const session = this.ensure(accountId, connectKey);
    session.connectKey = connectKey;

    const bootChanged = session.bootId !== null && session.bootId !== payload.bootId;
    if (session.bootId !== payload.bootId) {
      if (bootChanged) {
        this.appendConsole(session, "info", "executor session restarted");
        this.failAllPending(session, "executor restarted while command was in flight");
        session.queue.length = 0;
      }
      session.bootId = payload.bootId;
      session.connectedAt = Date.now();
    }

    session.lastSeenAt = Date.now();
    if (payload.info) {
      session.info = {
        executor: String(payload.info.executor ?? "unknown"),
        executorVersion: String(payload.info.executorVersion ?? ""),
        gameName: String(payload.info.gameName ?? ""),
        placeId: Number(payload.info.placeId ?? 0),
        jobId: String(payload.info.jobId ?? ""),
        playerName: String(payload.info.playerName ?? ""),
        playerUserId: Number(payload.info.playerUserId ?? 0),
        startedAt: Number(payload.info.startedAt ?? Date.now()),
        platform: payload.info.platform ? String(payload.info.platform) : undefined,
      };
    }

    this.ingestResults(session, payload.results ?? []);
    const appended = this.ingestConsole(session, payload.console ?? []);

    this.emitEvent({ type: "session", accountId, snapshot: this.snapshot(accountId) });
    if (appended.length > 0) {
      this.emitEvent({ type: "console", accountId, entries: appended });
    }

    this.expireStaleCommands(session);

    if (session.queue.length === 0) {
      await this.waitForWork(session, config.agentPollTimeoutMs);
    }

    this.expireStaleCommands(session);
    const commands = session.queue.splice(0, session.queue.length);
    if (commands.length > 0) {
      session.lastSeenAt = Date.now();
      this.emitEvent({ type: "session", accountId, snapshot: this.snapshot(accountId) });
    }

    return {
      ok: true,
      serverTime: Date.now(),
      commands: commands.map((c) => ({ id: c.id, method: c.method, params: c.params })),
      pollTimeoutMs: config.agentPollTimeoutMs,
      commandTimeoutMs: config.commandTimeoutMs,
      consoleBufferSize: config.consoleBufferSize,
    };
  }

  private waitForWork(session: Session, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (session.waiter === finish) session.waiter = null;
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref();
      session.waiter = finish;
    });
  }

  private wake(session: Session): void {
    const finish = session.waiter;
    if (finish) finish();
  }

  private ingestResults(session: Session, results: ResultPayload[]): void {
    for (const result of results) {
      const pending = session.pending.get(result.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      session.pending.delete(result.id);
      session.executions += 1;
      if (result.ok) {
        pending.resolve(result.result);
      } else {
        session.errors += 1;
        pending.reject(new RelayError("execution_failed", result.error || "executor reported an error"));
      }
    }
  }

  private ingestConsole(
    session: Session,
    lines: Array<{ level?: LogLevel; message: string }>,
  ): ConsoleEntry[] {
    const appended: ConsoleEntry[] = [];
    for (const line of lines) {
      if (typeof line?.message !== "string" || line.message.length === 0) continue;
      const entry = this.appendConsole(session, line.level ?? "print", line.message);
      appended.push(entry);
    }
    return appended;
  }

  private appendConsole(session: Session, level: LogLevel, message: string): ConsoleEntry {
    session.consoleSeq += 1;
    const entry: ConsoleEntry = {
      seq: session.consoleSeq,
      at: Date.now(),
      level,
      message: message.slice(0, 8000),
    };
    session.console.push(entry);
    if (session.console.length > config.consoleBufferSize) {
      session.console.splice(0, session.console.length - config.consoleBufferSize);
    }
    return entry;
  }

  private expireStaleCommands(session: Session): void {
    const cutoff = Date.now() - config.commandTimeoutMs;
    if (session.queue.length === 0) return;
    const kept: QueuedCommand[] = [];
    for (const command of session.queue) {
      if (command.createdAt < cutoff) {
        const pending = session.pending.get(command.id);
        if (pending) {
          clearTimeout(pending.timer);
          session.pending.delete(command.id);
          pending.reject(new RelayError("timeout", "executor did not pick up the command in time"));
        }
      } else {
        kept.push(command);
      }
    }
    session.queue = kept;
  }

  private failAllPending(session: Session, reason: string): void {
    for (const [, pending] of session.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RelayError("executor_restarted", reason));
    }
    session.pending.clear();
  }

  /** Queue a command for the executor and wait for its result. */
  async call(
    accountId: string,
    method: string,
    params: unknown,
    opts: { timeoutMs?: number; requireOnline?: boolean } = {},
  ): Promise<unknown> {
    const session = this.ensure(accountId, "");
    const requireOnline = opts.requireOnline ?? true;

    if (requireOnline && !this.isOnline(session)) {
      throw new RelayError(
        "no_executor",
        "No Roblox executor is connected for this account. Run the loadstring in Arceus X first.",
      );
    }

    const timeoutMs = opts.timeoutMs ?? config.commandTimeoutMs;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const command: QueuedCommand = { id, method, params, createdAt: Date.now() };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        const index = session.queue.findIndex((c) => c.id === id);
        if (index >= 0) session.queue.splice(index, 1);
        reject(new RelayError("timeout", `executor did not respond within ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
      session.pending.set(id, { ...command, resolve, reject, timer });
    });

    session.queue.push(command);
    this.wake(session);
    this.emitEvent({ type: "command", accountId, method, id });
    log.debug("queued relay command", { accountId, method, id });

    return promise;
  }

  consoleEntries(accountId: string, opts: { since?: number; limit?: number } = {}): ConsoleEntry[] {
    const session = this.sessions.get(accountId);
    if (!session) return [];
    const since = opts.since ?? 0;
    const limit = opts.limit ?? 200;
    const filtered = session.console.filter((entry) => entry.seq > since);
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  clearConsole(accountId: string): void {
    const session = this.sessions.get(accountId);
    if (!session) return;
    session.console = [];
    this.emitEvent({ type: "session", accountId, snapshot: this.snapshot(accountId) });
  }

  /** Detach the current executor session entirely (dashboard "kick"). */
  reset(accountId: string): void {
    const session = this.sessions.get(accountId);
    if (!session) return;
    this.failAllPending(session, "session was reset from the dashboard");
    session.queue.length = 0;
    session.console = [];
    session.consoleSeq = 0;
    session.bootId = null;
    session.info = null;
    session.lastSeenAt = null;
    session.connectedAt = null;
    this.emitEvent({ type: "session", accountId, snapshot: this.snapshot(accountId) });
  }

  private collectGarbage(): void {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [accountId, session] of this.sessions) {
      const idle = !session.lastSeenAt || session.lastSeenAt < cutoff;
      if (idle && session.pending.size === 0 && session.queue.length === 0) {
        this.sessions.delete(accountId);
        log.debug("dropped idle relay session", { accountId });
      }
    }
  }
}

export const hub = new Hub();
