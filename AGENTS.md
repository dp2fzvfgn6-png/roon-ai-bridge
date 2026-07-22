# Roon AI Bridge Agent Guide

This file defines the working agreement for automated coding threads in this
repository.

## Repository And Deployment

- GitHub: `LINEdev-ipc/roon-ai-bridge`
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

- Read `git status --short` before editing.
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

Stop after local implementation and validation unless the user explicitly
requests additional repository or deployment actions.

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

## Repository And Deployment Boundaries

- Do not stage, commit, push, create tags or open pull requests unless the user
  explicitly requests the specific action.
- An explicit request to promote `beta` to `main` counts as authorization to
  create the required release commit, update and push `main`, create and push
  the matching annotated version tag, and start and push the next beta version
  when the user requests one as part of the same promotion.
- Do not update, rebuild or restart the LXC unless the user explicitly requests
  an LXC deployment or update.
- A request to change code does not imply permission to commit, push or deploy.
- By default, leave the validated changes in the local working tree for the
  user to review and publish.
- If the user explicitly requests a commit, stage only explicit paths; never
  use `git add -A` or `git add .`.
- If the user explicitly requests deployment, follow the safe remote and live
  validation guidance below.

## Safe Remote API Tests After An Explicit Deployment Request

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

An explicit request to promote `beta` to `main` means the tested beta is
accepted as the release candidate. Run the complete automated test suite and
build on the final release contents, then create the annotated tag on the exact
commit pushed to `main`:

```powershell
git tag -a vX.Y.Z -m "Roon AI Bridge vX.Y.Z"
git push origin vX.Y.Z
```

The beta validation accumulated during development plus the final automated
suite and build are sufficient for tagging. Do not require an additional LXC
deployment or post-promotion live validation unless the user explicitly asks
for it. Promotion and tagging never imply permission to deploy, rebuild or
restart the LXC.
