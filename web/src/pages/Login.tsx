import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api, ApiError, type MetaResponse } from "@/lib/api";
import type { Route } from "@/lib/router";
import { formatAccountNumberInput } from "@/lib/utils";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

export function Login({
  meta,
  navigate,
  onAuthenticated,
}: {
  meta: MetaResponse | null;
  navigate: (route: Route) => void;
  onAuthenticated: () => Promise<void>;
}) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const digits = value.replace(/\D+/g, "");
  const complete = digits.length === 16;

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(value);
      await onAuthenticated();
      toast.success("Signed in");
      navigate("/app");
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : "Something went wrong. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createAccount();
      await onAuthenticated();
      toast.success("Account created", {
        description: `Your number is ${created.account.accountNumber}. It is the only way back in.`,
        duration: 15_000,
      });
      navigate("/app");
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : "Could not create an account right now.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft />
            Back
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>
                Your account number is your login. There is no email and no password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={signIn} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="account-number">Account number</Label>
                  <Input
                    id="account-number"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0000 0000 0000 0000"
                    value={value}
                    onChange={(event) => {
                      setValue(formatAccountNumberInput(event.target.value));
                      setError(null);
                    }}
                    className="font-mono tracking-wider"
                    aria-invalid={error !== null}
                    autoFocus
                  />
                  {error && <p className="text-destructive text-xs">{error}</p>}
                </div>

                <Button type="submit" disabled={!complete || busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  Sign in
                </Button>
              </form>

              {meta?.accountCreationEnabled && (
                <>
                  <div className="my-5 flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-muted-foreground text-xs">or</span>
                    <Separator className="flex-1" />
                  </div>

                  <Button variant="outline" className="w-full" onClick={createAccount} disabled={busy}>
                    <ShieldCheck />
                    Create a new account
                  </Button>
                  <p className="text-muted-foreground mt-3 text-xs">
                    You will get a fresh 16-digit number. Copy it somewhere safe: it is the only
                    credential and it cannot be recovered.
                  </p>
                </>
              )}

              {meta && !meta.accountCreationEnabled && (
                <p className="text-muted-foreground mt-5 text-xs">
                  This instance is not accepting new accounts.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
