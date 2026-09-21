import * as React from "react";
import type { ConsoleEntry, SessionStatus } from "./api";

export type DashboardEvent =
  | { type: "hello"; status: SessionStatus; console: ConsoleEntry[] }
  | { type: "session"; accountId: string; snapshot: SessionStatus }
  | { type: "console"; accountId: string; entries: ConsoleEntry[] }
  | { type: "command"; accountId: string; method: string; id: string };

export interface UseDashboardSocketResult {
  connected: boolean;
  status: SessionStatus | null;
  consoleEntries: ConsoleEntry[];
  activity: Array<{ id: string; method: string; at: number }>;
  clearConsole: () => void;
}

/**
 * Live feed from the relay. Reconnects with backoff and resyncs console state
 * on every reconnect so the view never silently drifts.
 */
export function useDashboardSocket(enabled: boolean): UseDashboardSocketResult {
  const [connected, setConnected] = React.useState(false);
  const [status, setStatus] = React.useState<SessionStatus | null>(null);
  const [consoleEntries, setConsoleEntries] = React.useState<ConsoleEntry[]>([]);
  const [activity, setActivity] = React.useState<Array<{ id: string; method: string; at: number }>>([]);

  const socketRef = React.useRef<WebSocket | null>(null);
  const attemptRef = React.useRef(0);
  const closedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) return undefined;
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;

      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${window.location.host}/ws/dashboard`);
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
      };

      socket.onmessage = (event) => {
        if (event.data === "pong") return;
        let parsed: DashboardEvent;
        try {
          parsed = JSON.parse(String(event.data)) as DashboardEvent;
        } catch {
          return;
        }

        if (parsed.type === "hello") {
          setStatus(parsed.status);
          setConsoleEntries(parsed.console ?? []);
        } else if (parsed.type === "session") {
          setStatus(parsed.snapshot);
        } else if (parsed.type === "console") {
          setConsoleEntries((previous) => {
            const seen = new Set(previous.map((entry) => entry.seq));
            const incoming = parsed.entries.filter((entry) => !seen.has(entry.seq));
            if (incoming.length === 0) return previous;
            const merged = [...previous, ...incoming];
            merged.sort((a, b) => a.seq - b.seq);
            return merged.slice(-1500);
          });
        } else if (parsed.type === "command") {
          setActivity((previous) =>
            [{ id: parsed.id, method: parsed.method, at: Date.now() }, ...previous].slice(0, 50),
          );
        }
      };

      const scheduleReconnect = () => {
        setConnected(false);
        socketRef.current = null;
        if (closedRef.current) return;
        attemptRef.current += 1;
        const delay = Math.min(1000 * 2 ** attemptRef.current, 15_000);
        window.setTimeout(connect, delay);
      };

      socket.onclose = scheduleReconnect;
      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      closedRef.current = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);

  // Heartbeat so proxies do not idle the socket out.
  React.useEffect(() => {
    if (!connected) return undefined;
    const timer = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send("ping");
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [connected]);

  const clearConsole = React.useCallback(() => setConsoleEntries([]), []);

  return { connected, status, consoleEntries, activity, clearConsole };
}
