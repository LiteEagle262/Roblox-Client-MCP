import * as React from "react";

export type Route = "/" | "/login" | "/app";

function currentRoute(): Route {
  const path = window.location.pathname;
  if (path.startsWith("/app")) return "/app";
  if (path.startsWith("/login")) return "/login";
  return "/";
}

/** Minimal history-API router. The API server serves index.html for any path. */
export function useRoute(): [Route, (route: Route, replace?: boolean) => void] {
  const [route, setRoute] = React.useState<Route>(currentRoute);

  React.useEffect(() => {
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = React.useCallback((next: Route, replace = false) => {
    if (replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
    setRoute(next);
    window.scrollTo({ top: 0 });
  }, []);

  return [route, navigate];
}
