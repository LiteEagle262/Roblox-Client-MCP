import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import * as React from "react";
import { Button } from "./button";

export function CopyButton({
  value,
  className,
  label = "Copy",
  size = "icon-sm",
}: {
  value: string;
  className?: string;
  label?: string;
  size?: "icon-sm" | "sm" | "default";
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={size === "icon-sm" ? "icon-sm" : size}
      onClick={copy}
      className={cn("shrink-0", className)}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <Check className="text-[var(--success)]" /> : <Copy />}
      {size !== "icon-sm" && <span>{copied ? "Copied" : label}</span>}
    </Button>
  );
}

export function CodeBlock({
  children,
  className,
  copyValue,
  wrap = false,
}: {
  children: React.ReactNode;
  className?: string;
  copyValue?: string;
  wrap?: boolean;
}) {
  return (
    <div className={cn("bg-muted/50 relative rounded-lg border", className)}>
      <pre
        className={cn(
          "scrollbar-thin p-3 font-mono text-xs leading-relaxed",
          wrap ? "overflow-x-hidden pr-11 whitespace-pre-wrap break-all" : "overflow-x-auto pr-12",
        )}
      >
        <code>{children}</code>
      </pre>
      {copyValue && <CopyButton value={copyValue} className="absolute top-1.5 right-1.5" />}
    </div>
  );
}

export function SecretField({
  value,
  revealed,
  onToggle,
  label,
}: {
  value: string;
  revealed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted/50 flex h-9 min-w-0 flex-1 items-center rounded-md border px-3">
        <code className="truncate font-mono text-xs">
          {revealed ? value : "•".repeat(Math.min(value.length, 40))}
        </code>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onToggle}>
        {revealed ? "Hide" : "Reveal"}
      </Button>
      <CopyButton value={value} size="sm" label={`Copy ${label}`} />
    </div>
  );
}
