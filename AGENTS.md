# Roon AI Bridge Agent Guide

This file defines the working agreement for automated coding threads in this
repository.

## Repository And Deployment

- GitHub: `dp2fzvfgn6-png/roon-ai-bridge`
- Default branch: `main`
- LXC address: `10.0.60.38`
- SSH user: `codex`
- SSH key on the Windows workstation:
  `C:\Users\IagoPC\.ssh\codex_roonia`
- Application path in the LXC: `/opt/roon-ai-bridge`
- HTTP port: `3000`
- Public MCP endpoint: `https://roonia.ipchome.com/mcp`
- Test zone Despacho:
  `16017884276cc06e0e4c92d966765d65ec86`
- Zone Cocina:
  `1601f17521ff85962b1f008000a96f1c3455`
- Zone Salon:
  `1601c8f5f6190632da46994676b083ca1710`

## Worktree Safety

- Read `git status --short` before editing and before committing.
- Do not revert or include unrelated user changes.
- The untracked `logos/` directory is user work. Do not edit, delete, stage or
  commit it unless the user explicitly requests that.
- Stage explicit paths. Do not use `git add -A` or `git add .`.
- Never print `.env`, `API_TOKEN`, OAuth tokens or private key contents.

## Implementation Workflow

1. Inspect the existing architecture and follow its service, route, MCP and
   error patterns.
2. Implement the smallest complete behavior, including homogeneous errors and
   operational logs.
3. Add focused automated tests for new logic.
4. Update current documentation and add a version validation document when a
   release behavior changes.
5. Run the complete test suite and TypeScript build.
6. Review `git diff --check`, `git diff --stat` and `git status --short`.
7. Commit only the intended files and push `main`.
8. Update the LXC from GitHub.
9. Validate the deployed HTTP/MCP behavior against the real Roon Core.
10. Record live results in documentation, commit and push them.
11. Create and push an annotated version tag only after live validation.

## Local Tests

Normal environment:

```powershell
pnpm run test
pnpm run build
```

If Node is not in `PATH` in Codex Desktop:

```powershell
$runtime = 'C:\Users\IagoPC\.cache\codex-runtimes\codex-primary-runtime\dependencies'
$env:PATH="$runtime\node\bin;$runtime\bin;$env:PATH"
& "$runtime\bin\pnpm.cmd" run test
& "$runtime\bin\pnpm.cmd" run build
```

Do not publish when tests or the build fail.

## Commit And Push

Use explicit paths:

```powershell
git add -- <INTENDED_PATHS>
git commit -m "<concise behavior-oriented message>"
git push origin main
```

Keep implementation and final live-validation documentation in separate
commits when deployment is required between them.

## Update The LXC

Run from the workstation:

```powershell
ssh -i 'C:\Users\IagoPC\.ssh\codex_roonia' `
  -o BatchMode=yes `
  codex@10.0.60.38 `
  "bash -lc 'curl -fsSL https://raw.githubusercontent.com/dp2fzvfgn6-png/roon-ai-bridge/main/scripts/lxc-update-app.sh -o /tmp/lxc-update-app.sh && sudo bash /tmp/lxc-update-app.sh'"
```

The updater pulls `main`, rebuilds Docker Compose and restarts the service.
Always wait for Roon discovery to reconnect after the container restarts.

## Safe Remote API Tests

Read the API token inside the LXC without returning it to the workstation:

```bash
TOKEN=$(sudo sed -n 's/^API_TOKEN=//p' /opt/roon-ai-bridge/.env | head -n1)
curl -fsS \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/roon/status
```

For multiline remote scripts from PowerShell, Base64-encode the script locally
and execute `echo <BASE64> | base64 -d | bash` over SSH. This avoids quoting
errors and accidental secret interpolation.

Minimum post-deployment checks:

- Deployed Git commit matches `origin/main`.
- `package.json` and MCP initialization report the intended version.
- `/roon/status` reports core, transport and browse ready.
- `tools/list` exposes the expected tool names, schemas, annotations and widget
  URI.
- Changed behavior is exercised through the same MCP tool ChatGPT will call,
  not only through a lower-level HTTP route.

## Live Roon Test Safety

- Tell the user what they should hear before an audible test.
- Prefer Despacho for playback tests.
- Inspect current zone state and volume before starting playback.
- Avoid increasing volume automatically.
- Pause first when grouping zones could activate a loud output.
- Verify final state and queue after commands. A successful Roon callback alone
  is not sufficient evidence.
- Preserve or clearly report the final playback and grouping state.

## MCP And Widget Changes

- Follow one user intent per model-visible tool.
- Descriptions should start with "Use this when..." and explain disallowed
  alternatives when ambiguity is likely.
- Put cross-tool sequencing rules in MCP server instructions; keep the first
  512 characters self-contained.
- Return concise `structuredContent` with reusable identifiers and verified
  state.
- When widget HTML or behavior changes, increment the `ui://` resource URI to
  invalidate ChatGPT cache.
- Support the MCP Apps `ui/notifications/*` bridge and ChatGPT
  `window.openai.toolInput` / `window.openai.toolOutput` compatibility globals.
- After deployment, the user must refresh the ChatGPT app and start a new
  conversation to load changed tool metadata or widget resources.

## Version And Tagging

Update both:

- `package.json`
- `src/config/version.ts`

After automated and live validation:

```powershell
git tag -a vX.Y.Z -m "Roon AI Bridge vX.Y.Z"
git push origin vX.Y.Z
```

Do not tag a version while its required live validation is still pending.
