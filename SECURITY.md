# Security

## Reporting

Open a [private security advisory](https://github.com/LiteEagle262/Roblox-Client-MCP/security/advisories/new)
or a normal issue if the problem is not sensitive. There is no bounty.

Include what you did, what you expected, and what happened. A reproduction against a local
instance is ideal.

## Threat model

This relay sits between an AI and a machine running a Roblox executor. Being honest about what
it does and does not protect is more useful than a long list of hardening tips.

### What the secrets are

| Secret | Where it lives | What it grants |
| --- | --- | --- |
| Account number | The user's memory / notes | Full dashboard access: read and rotate both other secrets, delete the account |
| Connect key | The loadstring URL and the running agent | Ability to attach an executor session to the account |
| MCP token | The AI client config | Ability to call every tool, i.e. run arbitrary Luau in the attached client |

They are independent and independently rotatable, which is the main defence you have: a leaked
loadstring does not leak your AI config, and vice versa.

### What this design does not do

- **There is no per-tool permission layer.** Any valid MCP token can run arbitrary Luau. If you
  need finer control, run a private instance behind your own auth proxy.
- **The connect key is visible in a URL.** That is inherent to `loadstring(game:HttpGet(url))`.
  Use `Cache-Control: no-store` (already set) and rotate when it leaks.
- **Account numbers are not emails.** There is no recovery, by design. Losing it means losing
  the account.

### What is implemented

- Account numbers carry ~53 bits of entropy from `crypto.randomInt`, and login is rate limited
  per IP.
- The connect key is a UUID v4 from `crypto.randomUUID`.
- Sessions are stored as HMAC-SHA256 hashes, peppered with a secret generated beside the
  database on first boot. A database leak does not hand over live sessions.
- All state-changing endpoints require a session cookie **and** a same-origin `Origin` header.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` automatically when `PUBLIC_URL` is
  HTTPS.
- The agent has a hard 15-minute idle GC and drops pending commands on timeout, so a stuck
  executor cannot pin memory indefinitely.
- Console output and tool results are length-capped before storage and on the way out of MCP.
- Helmet sets a restrictive CSP. `script-src` has no `unsafe-inline`.
- MCP requests are authenticated with a bearer token, and the endpoint is stateless with no
  cross-account session sharing.

### Deploying it publicly

1. Terminate TLS. Never run this on plain HTTP for real users; the tokens travel in headers.
2. Set `TRUST_PROXY=true` behind a reverse proxy, or rate limits will see the proxy's IP and
   catch everyone in one bucket.
3. Mount `/data` on a persistent volume. Losing it loses every account.
4. Consider `ACCOUNT_CREATION_ENABLED=false` plus creating accounts you need, or
   `BOOTSTRAP_SECRET` to gate registration.
5. Back up the SQLite file. It is small and it is the whole database.

### Out of scope

- Executor-side risks. The Lua agent runs inside a third-party executor with its own trust
  story; this project cannot sandbox that.
- Roblox account bans from using executors. See the disclaimer in the README.
- Denial of service against an instance you have deliberately exposed.
