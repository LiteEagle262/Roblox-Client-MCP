import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "bg-card border-border text-card-foreground",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
