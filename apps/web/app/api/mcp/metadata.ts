import { MCP_SCOPES } from "@calcom/features/mcp/oauthPolicy";
import { mcpConfig, mcpResponse } from "app/api/mcp/_shared";

export function protectedResourceMetadata() {
  const { resource, origin } = mcpConfig();
  return {
    resource,
    authorization_servers: [origin],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

export function authorizationMetadata() {
  const { origin } = mcpConfig();
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/auth/mcp/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    revocation_endpoint: `${origin}/api/mcp/oauth/revoke`,
    scopes_supported: MCP_SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  };
}

async function metadataResponse(value: () => object) {
  const response = await mcpResponse(async () => value());
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

export const resourceMetadataResponse = () => metadataResponse(protectedResourceMetadata);
export const authorizationMetadataResponse = () => metadataResponse(authorizationMetadata);
