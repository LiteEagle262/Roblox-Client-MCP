import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { api, type MeResponse, type MetaResponse } from "@/lib/api";
import { useRoute } from "@/lib/router";
import { Dashboard } from "@/pages/Dashboard";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { Loader2 } from "lucide-react";
import * as React from "react";

export function App() {
  const [route, navigate] = useRoute();
  const [booted, setBooted] = React.useState(false);
  const [authenticated, setAuthenticated] = React.useState(false);
  const [me, setMe] = React.useState<MeResponse | null>(null);
  const [meta, setMeta] = React.useState<MetaResponse | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const loadMe = React.useCallback(async (): Promise<void> => {
    const result = await api.me();
    setMe(result);
    setAuthenticated(true);
  }, []);

  // Boot: public config plus whether a session cookie is still live.
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const [metaResult, sessionResult] = await Promise.allSettled([api.meta(), api.session()]);
      if (cancelled) return;

      if (metaResult.status === "fulfilled") setMeta(metaResult.value);

      const isAuthed =
        sessionResult.status === "fulfilled" && sessionResult.value.authenticated === true;

      if (isAuthed) {
        try {
          await loadMe();
        } catch {
          setAuthenticated(false);
        }
      }
      if (!cancelled) setBooted(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  // Signed in but the profile has not landed yet (or was invalidated).
  React.useEffect(() => {
    if (!authenticated || me !== null) return;
    void loadMe().catch(() => {
      setAuthenticated(false);
      setMe(null);
    });
  }, [authenticated, me, loadMe]);

  // A signed-in user always belongs on the dashboard.
  React.useEffect(() => {
    if (authenticated && me !== null && route !== "/app") navigate("/app", true);
    if (!authenticated && route === "/app") navigate("/login", true);
  }, [authenticated, me, route, navigate]);

  // Re-sync when the tab regains focus.
  React.useEffect(() => {
    if (!authenticated) return undefined;
    const onFocus = () => {
      void loadMe().catch(() => setLoadError("Lost connection to the server."));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authenticated, loadMe]);

  const signOut = React.useCallback(() => {
    setAuthenticated(false);
    setMe(null);
    navigate("/");
  }, [navigate]);

  const body = (() => {
    if (!booted) {
      return (
        <div className="flex min-h-dvh items-center justify-center">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      );
    }

    if (!authenticated) {
      return route === "/login" ? (
        <Login
          meta={meta}
          navigate={navigate}
          onAuthenticated={loadMe}
        />
      ) : (
        <Landing meta={meta} navigate={navigate} />
      );
    }

    if (me === null) {
      return (
        <div className="flex min-h-dvh items-center justify-center">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      );
    }

    return <Dashboard me={me} meta={meta} onRefresh={loadMe} onSignedOut={signOut} />;
  })();

  return (
    <>
      {loadError && (
        <div className="bg-destructive text-destructive-foreground flex items-center justify-center gap-3 px-4 py-2 text-xs">
          <span>{loadError}</span>
          <Button
            size="sm"
            variant="secondary"
            className="h-6"
            onClick={() => {
              setLoadError(null);
              void loadMe().catch(() => setLoadError("Still offline."));
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {body}
      <Toaster />
    </>
  );
}
