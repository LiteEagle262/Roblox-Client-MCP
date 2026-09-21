import { ConnectCard } from "@/components/dashboard/ConnectCard";
import { ConsolePanel } from "@/components/dashboard/ConsolePanel";
import { McpCard } from "@/components/dashboard/McpCard";
import { SettingsPanel } from "@/components/dashboard/SettingsPanel";
import { StatusCard } from "@/components/dashboard/StatusCard";
import { ToolsPanel } from "@/components/dashboard/ToolsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError, type MeResponse, type MetaResponse, type ToolInfo } from "@/lib/api";
import { useDashboardSocket } from "@/lib/useSocket";
import { LogOut, Terminal } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

export function Dashboard({
  me,
  meta,
  onRefresh,
  onSignedOut,
}: {
  me: MeResponse;
  meta: MetaResponse | null;
  onRefresh: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const { connected, status, consoleEntries, activity, clearConsole } = useDashboardSocket(true);
  const [tools, setTools] = React.useState<ToolInfo[]>([]);

  React.useEffect(() => {
    api
      .tools()
      .then((result) => setTools(result.tools))
      .catch(() => setTools([]));
  }, []);

  const live = status ?? me.status;

  const rotateConnectKey = async () => {
    try {
      await api.rotateConnectKey();
      toast.success("Connect key rotated", {
        description: "Paste the new loadstring into your executor.",
      });
      await onRefresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Rotation failed");
      throw cause;
    }
  };

  const rotateMcpToken = async () => {
    try {
      await api.rotateMcpToken();
      toast.success("MCP token rotated", { description: "Update your AI client config." });
      await onRefresh();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Rotation failed");
      throw cause;
    }
  };

  const signOut = async () => {
    try {
      await api.logout();
    } catch {
      /* signing out locally is enough */
    }
    onSignedOut();
  };

  const clearSession = async () => {
    try {
      await api.clearConsole();
      clearConsole();
    } catch {
      /* the socket will resync */
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Terminal className="size-4 shrink-0" />
            <span className="hidden font-mono text-sm font-medium sm:inline">roblox-client-mcp</span>
            <Badge variant={live.online ? "success" : "secondary"} className="shrink-0">
              {live.online ? "executor online" : "offline"}
            </Badge>
            <Badge
              variant="outline"
              className="hidden shrink-0 font-mono text-[10px] sm:inline-flex"
              title={connected ? "Live feed connected" : "Live feed reconnecting"}
            >
              {connected ? "live" : "reconnecting"}
            </Badge>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <code className="text-muted-foreground hidden truncate font-mono text-xs md:inline">
              {me.account.accountNumber}
            </code>
            <CopyButton value={me.account.accountNumber} label="account number" />
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="console">
              Console
              {consoleEntries.length > 0 && (
                <span className="text-muted-foreground font-mono text-[10px]">
                  {consoleEntries.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <StatusCard status={live} />
                <ActivityCard activity={activity} />
              </div>
              <div className="flex flex-col gap-4">
                <ConnectCard
                  loader={me.loader}
                  credentials={me.credentials}
                  onRotate={rotateConnectKey}
                />
                <McpCard
                  mcpUrl={me.mcp.url}
                  token={me.credentials.mcpToken}
                  onRotate={rotateMcpToken}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="console">
            <ConsolePanel entries={consoleEntries} onClear={clearSession} />
          </TabsContent>

          <TabsContent value="tools">
            <ToolsPanel tools={tools} />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsPanel
              accountNumber={me.account.accountNumber}
              label={me.account.label}
              meta={meta}
              onChanged={onRefresh}
              onReset={onRefresh}
              onDeleted={onSignedOut}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ActivityCard({
  activity,
}: {
  activity: Array<{ id: string; method: string; at: number }>;
}) {
  return (
    <div className="rounded-xl border p-5">
      <h3 className="text-sm font-medium">Command feed</h3>
      {activity.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Nothing yet. Tool calls made by your AI appear here as they are relayed.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {activity.slice(0, 12).map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 font-mono text-xs">
              <span className="truncate">{item.method}</span>
              <span className="text-muted-foreground shrink-0">
                {new Date(item.at).toLocaleTimeString(undefined, { hour12: false })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
