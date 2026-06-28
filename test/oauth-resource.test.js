const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { OAuthService } = require("../dist/services/oauthService");

function testConfig(dataDir) {
  return {
    port: 3000,
    nodeEnv: "test",
    logLevel: "error",
    roonExtensionName: "Roon AI Bridge",
    roonExtensionId: "com.local.roon-ai-bridge",
    dataDir,
    enableBrowse: true,
    enableMcp: true,
    enableAuth: true,
    apiToken: "admin-token",
    publicBaseUrl: "https://roonia.example.test",
    oauthIssuer: "https://roonia.example.test",
    oauthApprovalPin: "123456"
  };
}

test("binds OAuth tokens to MCP resource and scope with PKCE S256", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-oauth-"));
  const service = new OAuthService(testConfig(dataDir));
  const client = service.registerClient({
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector/oauth/test"]
  });
  const verifier = "test-verifier-with-enough-entropy-1234567890";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const resource = service.getExpectedResource();
  const code = service.createAuthorizationCode({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope: "roon:control"
  });
  const token = service.exchangeCode({
    code,
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    code_verifier: verifier,
    resource
  });

  assert.equal(service.tokenIsValid(token.access_token, resource, "roon:control"), true);
  assert.equal(
    service.tokenIsValid(token.access_token, "https://other.example.test/mcp", "roon:control"),
    false
  );
});

test("rejects OAuth authorization without PKCE S256", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roonia-oauth-"));
  const service = new OAuthService(testConfig(dataDir));
  const client = service.registerClient({
    redirect_uris: ["https://chatgpt.com/connector/oauth/test"]
  });

  assert.throws(
    () =>
      service.createAuthorizationCode({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        code_challenge: "plain-challenge",
        code_challenge_method: "plain",
        resource: service.getExpectedResource(),
        scope: "roon:control"
      }),
    /PKCE with S256 is required/
  );
});
