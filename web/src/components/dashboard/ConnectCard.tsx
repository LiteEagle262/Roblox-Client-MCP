import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock, SecretField } from "@/components/ui/copy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Credentials, LoaderInfo } from "@/lib/api";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import * as React from "react";

export function ConnectCard({
  loader,
  credentials,
  onRotate,
}: {
  loader: LoaderInfo;
  credentials: Credentials;
  onRotate: () => Promise<void>;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const rotate = async () => {
    setBusy(true);
    try {
      await onRotate();
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Connect an executor</CardTitle>
        <CardDescription>
          Paste this into Arceus X. The agent polls the relay and answers commands from your AI.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CodeBlock copyValue={loader.loadstring} wrap>
          {loader.loadstring}
        </CodeBlock>

        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">Connect key</span>
          <SecretField
            value={credentials.connectKey}
            revealed={revealed}
            onToggle={() => setRevealed((value) => !value)}
            label="connect key"
          />
          <p className="text-muted-foreground text-xs">
            Anyone with this key can attach a session to your account. Rotating it invalidates every
            loadstring you have already pasted.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <RefreshCw />
            Rotate connect key
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={loader.url} target="_blank" rel="noreferrer">
              <ExternalLink />
              View generated Lua
            </a>
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate the connect key?</DialogTitle>
            <DialogDescription>
              The current key stops working immediately. Any executor still running the old
              loadstring will disconnect and will not reconnect until you paste a fresh one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={rotate} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Rotate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
