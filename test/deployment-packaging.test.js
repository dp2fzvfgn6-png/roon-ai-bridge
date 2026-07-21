const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("container packaging exposes published stable and beta channels", () => {
  const compose = read("docker-compose.yml");
  const dockerfile = read("Dockerfile");
  const workflow = read(".github/workflows/publish-image.yml");

  assert.match(compose, /ghcr\.io\/dp2fzvfgn6-png\/roon-ai-bridge:\$\{ROONIA_IMAGE_TAG:-stable\}/);
  assert.match(compose, /stop_grace_period:\s*15s/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS build/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS runtime/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /STOPSIGNAL SIGTERM/);
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /type=raw,value=beta/);
  assert.match(workflow, /type=raw,value=stable/);
  assert.match(workflow, /provenance: mode=max/);
  assert.match(workflow, /sbom: true/);
});

test("Proxmox installer pulls a published image without compiling source", () => {
  const installer = read("scripts/proxmox-create-lxc.sh");

  assert.match(installer, /git sparse-checkout/);
  assert.match(installer, /GIT_REF='\$\{GIT_REF\}' bash scripts\/lxc-update-app\.sh/);
  assert.doesNotMatch(installer, /docker compose up -d --build/);
});
