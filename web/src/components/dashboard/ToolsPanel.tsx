import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ToolInfo } from "@/lib/api";
import * as React from "react";

export function ToolsPanel({ tools }: { tools: ToolInfo[] }) {
  const [query, setQuery] = React.useState("");

  const grouped = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = tools.filter(
      (tool) =>
        needle.length === 0 ||
        tool.name.toLowerCase().includes(needle) ||
        tool.title.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle),
    );
    const map = new Map<string, ToolInfo[]>();
    for (const tool of filtered) {
      const bucket = map.get(tool.group) ?? [];
      bucket.push(tool);
      map.set(tool.group, bucket);
    }
    return [...map.entries()];
  }, [tools, query]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tools exposed over MCP</CardTitle>
        <CardDescription>
          {tools.length} tools your AI can call. Reads are safe; anything that writes or fires is
          destructive and hits a real game.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Input
          placeholder="Filter tools…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 max-w-64 text-xs"
        />

        {grouped.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tools match that filter.</p>
        ) : (
          grouped.map(([group, items]) => (
            <div key={group} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-muted-foreground font-mono text-xs tracking-wide uppercase">
                  {group}
                </h3>
                <Badge variant="outline">{items.length}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {items.map((tool) => (
                  <div key={tool.name} className="rounded-lg border p-3">
                    <code className="font-mono text-xs font-medium">{tool.name}</code>
                    <p className="text-muted-foreground mt-1 text-xs">{tool.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
