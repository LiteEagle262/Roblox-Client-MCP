import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ConsoleEntry } from "@/lib/api";
import { cn, timeOfDay } from "@/lib/utils";
import { ArrowDownToLine, Pause, Play, Trash2 } from "lucide-react";
import * as React from "react";

const LEVEL_STYLES: Record<ConsoleEntry["level"], { label: string; className: string }> = {
  print: { label: "PRINT", className: "text-foreground" },
  info: { label: "INFO", className: "text-sky-400" },
  game: { label: "GAME", className: "text-muted-foreground" },
  warn: { label: "WARN", className: "text-amber-400" },
  error: { label: "ERROR", className: "text-destructive" },
};

const LEVELS = ["print", "info", "game", "warn", "error"] as const;

export function ConsolePanel({
  entries,
  onClear,
}: {
  entries: ConsoleEntry[];
  onClear: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [levels, setLevels] = React.useState<Set<string>>(() => new Set(LEVELS));
  const [follow, setFollow] = React.useState(true);
  const [paused, setPaused] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!levels.has(entry.level)) return false;
      if (needle.length > 0 && !entry.message.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, levels, query]);

  React.useEffect(() => {
    if (!follow || paused) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible, follow, paused]);

  const toggleLevel = (level: string) => {
    setLevels((previous) => {
      const next = new Set(previous);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Console
            <span className="text-muted-foreground ml-2 font-mono text-xs font-normal">
              {visible.length}/{entries.length}
            </span>
            {paused && (
              <Badge variant="secondary" className="ml-2">
                paused
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? "Resume" : "Pause"}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setFollow(true);
                const node = scrollRef.current;
                if (node) node.scrollTop = node.scrollHeight;
              }}
              aria-label="Jump to the newest line"
            >
              <ArrowDownToLine />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear the console">
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filter output…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 max-w-56 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-1">
            {LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={levels.has(level) ? "secondary" : "ghost"}
                onClick={() => toggleLevel(level)}
                className={cn("h-7 font-mono text-[11px]", !levels.has(level) && "opacity-50")}
              >
                {level}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant={follow ? "secondary" : "ghost"}
            onClick={() => setFollow((value) => !value)}
            className="h-7"
          >
            auto-scroll
          </Button>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="scrollbar-thin bg-muted/40 h-[26rem] overflow-y-auto rounded-lg border p-3 font-mono text-xs"
        >
          {visible.length === 0 ? (
            <p className="text-muted-foreground">
              {entries.length === 0
                ? "Nothing yet. Prints, warnings and errors from the client show up here."
                : "No lines match the current filter."}
            </p>
          ) : (
            visible.map((entry) => {
              const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.game;
              return (
                <div key={entry.seq} className="flex gap-3 py-px">
                  <span className="text-muted-foreground/60 shrink-0 tabular-nums">
                    {timeOfDay(entry.at)}
                  </span>
                  <span className={cn("w-12 shrink-0 text-[10px] leading-5", style.className)}>
                    {style.label}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{entry.message}</span>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
