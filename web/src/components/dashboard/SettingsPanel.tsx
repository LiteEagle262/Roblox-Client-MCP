import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api, ApiError, type ActivityEvent, type MetaResponse } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

export function SettingsPanel({
  accountNumber,
  label,
  meta,
  onChanged,
  onDeleted,
  onReset,
}: {
  accountNumber: string;
  label: string | null;
  meta: MetaResponse | null;
  onChanged: () => void;
  onDeleted: () => void;
  onReset: () => void;
}) {
  const [draftLabel, setDraftLabel] = React.useState(label ?? "");
  const [savingLabel, setSavingLabel] = React.useState(false);
  const [activity, setActivity] = React.useState<ActivityEvent[]>([]);
  const [confirm, setConfirm] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const loadActivity = React.useCallback(async () => {
    try {
      const result = await api.activity();
      setActivity(result.events);
    } catch {
      /* non-critical */
    }
  }, []);

  React.useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const saveLabel = async () => {
    setSavingLabel(true);
    try {
      await api.setLabel(draftLabel.trim().length > 0 ? draftLabel.trim() : null);
      toast.success("Label saved");
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Could not save the label");
    } finally {
      setSavingLabel(false);
    }
  };

  const resetSession = async () => {
    try {
      await api.resetSession();
      toast.success("Session cleared");
      onReset();
      void loadActivity();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Could not clear the session");
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.deleteAccount(confirm);
      toast.success("Account deleted");
      onDeleted();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Could not delete the account");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account</CardTitle>
          <CardDescription>
            Your account number is the only credential. There is no recovery if you lose it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Account number</Label>
            <code className="bg-muted/50 rounded-md border px-3 py-2 font-mono text-sm">
              {accountNumber}
            </code>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="label">Label</Label>
            <div className="flex items-center gap-2">
              <Input
                id="label"
                value={draftLabel}
                maxLength={60}
                placeholder="e.g. main PC, testing box"
                onChange={(event) => setDraftLabel(event.target.value)}
                className="max-w-72"
              />
              <Button size="sm" variant="outline" onClick={saveLabel} disabled={savingLabel}>
                {savingLabel && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Purely cosmetic. Useful when you have more than one account.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Recent activity</CardTitle>
              <CardDescription>The last 50 events for this account.</CardDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => void loadActivity()} aria-label="Refresh">
              <RefreshCw />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity recorded yet.</p>
          ) : (
            <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <tbody>
                  {activity.map((event, index) => (
                    <tr key={index} className="border-b last:border-0">
                      <td className="w-28 px-3 py-2 align-top">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {event.event}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground px-3 py-2 align-top">
                        {event.detail ?? "—"}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-right align-top whitespace-nowrap">
                        {formatRelativeTime(event.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldAlert className="text-destructive size-4" />
            Session control
          </CardTitle>
          <CardDescription>
            Clearing the session drops the queued commands, the console buffer and the attached
            executor. The executor will reconnect on its next poll.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={resetSession}>
            Clear session
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive text-sm">Danger zone</CardTitle>
          <CardDescription>
            Deleting the account removes its credentials, sessions and activity log immediately.
            This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button variant="destructive" size="sm" onClick={() => setDialogOpen(true)}>
            Delete this account
          </Button>
          {meta && (
            <p className="text-muted-foreground font-mono text-xs">
              server v{meta.version} · {meta.accountCount} accounts
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this account?</DialogTitle>
            <DialogDescription>
              Type your full account number below to confirm. There is no undo and no recovery.
            </DialogDescription>
          </DialogHeader>
          <Separator />
          <Input
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={accountNumber}
            className="font-mono"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteAccount}
              disabled={deleting || confirm.replace(/\D+/g, "").length !== 16}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
