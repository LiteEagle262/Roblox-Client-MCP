import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { MetaResponse } from "@/lib/api";
import type { Route } from "@/lib/router";
import {
  ArrowRight,
  Braces,
  Bug,
  Github,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";

const steps = [
  {
    title: "Create an account",
    body: "You get a 16-digit account number. It is your only login — no email, no password.",
    icon: ShieldCheck,
  },
  {
    title: "Run the loadstring",
    body: "Paste the generated loadstring into Arceus X. The agent connects back and starts relaying.",
    icon: Terminal,
  },
  {
    title: "Point your AI at it",
    body: "Add the MCP endpoint and token to Claude, Cursor, or anything that speaks MCP.",
    icon: Braces,
  },
];

const features = [
  {
    title: "19 MCP tools",
    body: "Run Luau, read the console, walk the instance tree, list and decompile scripts, inspect signals, spy on remotes.",
    icon: Wrench,
  },
  {
    title: "Console capture",
    body: "Every print, warning and error the client emits is buffered and readable, so your AI sees what actually happened.",
    icon: Terminal,
  },
  {
    title: "Reverse engineering",
    body: "Decompile client scripts by path and watch live remote traffic to see how a game is wired together.",
    icon: Bug,
  },
  {
    title: "Reverse-tunnel relay",
    body: "Executors have no WebSockets to the internet, so the agent long-polls. It works through NAT and mobile networks.",
    icon: Radio,
  },
  {
    title: "Rotatable secrets",
    body: "Connect key and MCP token are separate and rotatable. Burn a leaked loadstring without touching your AI config.",
    icon: ShieldCheck,
  },
  {
    title: "Yours to host",
    body: "One container, one SQLite file, no external services. Docker and Dokploy ready, MIT licensed.",
    icon: Server,
  },
];

export function Landing({
  meta,
  navigate,
}: {
  meta: MetaResponse | null;
  navigate: (route: Route) => void;
}) {
  const closed = meta !== null && !meta.accountCreationEnabled;

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Terminal className="size-4" />
            <span className="font-mono text-sm font-medium">roblox-client-mcp</span>
            {meta && <Badge variant="secondary">v{meta.version}</Badge>}
          </div>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a
                href="https://github.com/LiteEagle262/Roblox-Client-MCP"
                target="_blank"
                rel="noreferrer"
              >
                <Github />
                GitHub
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/login")}>
              Sign in
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4">
        <section className="flex flex-col items-start gap-6 py-16 sm:py-24">
          <Badge variant="outline" className="font-mono">
            MCP · Arceus X · SPDM
          </Badge>
          <h1 className="max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            Give your AI a window into a live Roblox client.
          </h1>
          <p className="text-muted-foreground max-w-2xl text-base text-pretty sm:text-lg">
            A hosted relay that sits between a Roblox executor and an MCP client. Your AI can read
            the console, walk the instance tree, decompile scripts, watch remote traffic, and run
            Luau — in the game that is actually open.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => navigate("/login")} disabled={closed}>
              {closed ? "Registration closed" : "Get an account number"}
              {!closed && <ArrowRight />}
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a
                href="https://github.com/LiteEagle262/Roblox-Client-MCP#readme"
                target="_blank"
                rel="noreferrer"
              >
                Read the docs
              </a>
            </Button>
          </div>
          {meta && (
            <p className="text-muted-foreground font-mono text-xs">
              {[
                `${meta.accountCount} accounts`,
                `${meta.onlineSessions} executors online`,
                meta.rateLimits.accountPerHour > 0
                  ? `${meta.rateLimits.accountPerHour}/hr per IP`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </section>

        <Separator />

        <section className="py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
            Three steps, no build tooling, nothing installed on your machine besides the executor you
            already use.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <Card key={step.title}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <step.icon className="text-muted-foreground size-4" />
                    <span className="text-muted-foreground font-mono text-xs">
                      Step {index + 1}
                    </span>
                  </div>
                  <CardTitle>{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{step.body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        <section className="py-16">
          <h2 className="text-2xl font-semibold tracking-tight">What the AI can reach</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-xl border p-5">
                <feature.icon className="text-muted-foreground size-4" />
                <h3 className="mt-3 font-medium">{feature.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <Separator />

        <section className="flex flex-col items-start gap-4 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">Run your own</h2>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Everything here is one Node container and one SQLite file. Clone it, point it at your
            domain, and deploy it on Dokploy, Coolify, Fly, or a VPS.
          </p>
          <div className="bg-muted/50 w-full max-w-2xl overflow-x-auto rounded-lg border p-4">
            <pre className="font-mono text-xs leading-relaxed">
              <code>{`git clone https://github.com/LiteEagle262/Roblox-Client-MCP
cd Roblox-Client-MCP
cp .env.example .env   # set PUBLIC_URL
docker compose up -d`}</code>
            </pre>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span>MIT licensed. Use it for whatever you want.</span>
          <span className="font-mono">
            Not affiliated with Roblox Corporation or SPDM Team.
          </span>
        </div>
      </footer>
    </div>
  );
}
