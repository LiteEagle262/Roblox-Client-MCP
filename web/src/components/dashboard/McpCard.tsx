import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock, CopyButton, SecretField } from "@/components/ui/copy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";
import * as React from "react";

function clientConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        roblox: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function McpCard({
  mcpUrl,
  token,
  onRotate,
}: {
  mcpUrl: string;
  token: string;
  onRotate: () => Promise<void>;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const rotate = async () => {
    setBusy(true);
    try {
      await onRotate();
    } finally {
      setBusy(false);
    }
  };

  const config = clientConfig(mcpUrl, revealed ? token : "<your-mcp-token>");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Connect your AI</CardTitle>
        <CardDescription>
          A stateless Streamable HTTP MCP endpoint. Authenticate with your token as a bearer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">Endpoint</span>
          <div className="flex items-center gap-2">
            <div className="bg-muted/50 flex h-9 min-w-0 flex-1 items-center rounded-md border px-3">
              <code className="truncate font-mono text-xs">{mcpUrl}</code>
            </div>
            <CopyButton value={mcpUrl} size="sm" label="endpoint" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">Bearer token</span>
          <SecretField
            value={token}
            revealed={revealed}
            onToggle={() => setRevealed((value) => !value)}
            label="MCP token"
          />
        </div>

        <Tabs defaultValue="config">
          <TabsList>
            <TabsTrigger value="config">Client config</TabsTrigger>
            <TabsTrigger value="curl">Test it</TabsTrigger>
          </TabsList>
          <TabsContent value="config">
            <CodeBlock copyValue={clientConfig(mcpUrl, token)}>{config}</CodeBlock>
          </TabsContent>
          <TabsContent value="curl">
            <CodeBlock
              copyValue={`curl -s ${mcpUrl} -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
            >
              {`curl -s ${mcpUrl} \\
  -H "Authorization: Bearer ${revealed ? token : "<your-mcp-token>"}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
            </CodeBlock>
          </TabsContent>
        </Tabs>

        <div>
          <Button variant="outline" size="sm" onClick={rotate} disabled={busy}>
            <RefreshCw className={busy ? "animate-spin" : undefined} />
            Rotate MCP token
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
