import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { SessionStatus } from "@/lib/api";
import { formatDuration, formatRelativeTime } from "@/lib/utils";
import { Activity, CircleDot, Clock, Gamepad2, User } from "lucide-react";
import * as React from "react";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="truncate font-mono text-sm">{value}</span>
    </div>
  );
}

export function StatusCard({ status }: { status: SessionStatus | null }) {
  const online = status?.online ?? false;
  const info = status?.info ?? null;

  // Uptime is relative to connection time, and ticks while the panel is open.
  const [, forceTick] = React.useState(0);
  React.useEffect(() => {
    if (!online) return undefined;
    const timer = window.setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => window.clearInterval(timer);
  }, [online]);

  const uptime =
    status?.connectedAt != null ? formatDuration((Date.now() - status.connectedAt) / 1000) : "—";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CircleDot className={online ? "text-[var(--success)]" : "text-muted-foreground"} />
            Executor
          </CardTitle>
          <Badge variant={online ? "success" : "secondary"}>{online ? "connected" : "offline"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {online && info ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <Gamepad2 className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <Stat label="Game" value={info.gameName || "unknown"} />
              </div>
              <div className="flex items-start gap-2">
                <User className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <Stat label="Player" value={info.playerName || "unknown"} />
              </div>
              <div className="flex items-start gap-2">
                <Activity className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <Stat label="Executor" value={info.executor || "unknown"} />
              </div>
              <div className="flex items-start gap-2">
                <Clock className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <Stat label="Uptime" value={uptime} />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Place id" value={info.placeId || "—"} />
              <Stat label="Queued" value={status?.queued ?? 0} />
              <Stat label="Runs" value={status?.executions ?? 0} />
              <Stat
                label="Failures"
                value={
                  (status?.errors ?? 0) > 0 ? (
                    <span className="text-destructive">{status?.errors}</span>
                  ) : (
                    0
                  )
                }
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm">No executor is attached.</p>
            <p className="text-muted-foreground text-xs">
              Run the loadstring from the Connect panel inside Arceus X. Last seen{" "}
              {formatRelativeTime(status?.lastSeenAt)}.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
