import { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import type { AuthenticatedUser } from "@/server/core/auth";
import { HttpError } from "@/server/core/errors";
import {
  buildXeroAuthorizationUrl,
  exchangeCodeForTokens,
  listXeroTenants,
  refreshAccessToken,
} from "@/server/xero/client";

interface XeroConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  tokenKey: string;
}

function requireXeroConfig(): XeroConfig {
  if (
    !env.XERO_CLIENT_ID ||
    !env.XERO_CLIENT_SECRET ||
    !env.XERO_REDIRECT_URI ||
    !env.XERO_TOKEN_ENCRYPTION_KEY
  ) {
    throw new HttpError(
      "xero_not_configured",
      500,
      "Xero integration is not configured",
    );
  }
  return {
    clientId: env.XERO_CLIENT_ID,
    clientSecret: env.XERO_CLIENT_SECRET,
    redirectUri: env.XERO_REDIRECT_URI,
    scopes: env.XERO_OAUTH_SCOPES,
    tokenKey: env.XERO_TOKEN_ENCRYPTION_KEY,
  };
}

export function startXeroConnection(state: string): URL {
  const config = requireXeroConfig();
  return buildXeroAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    state,
  });
}

export async function completeXeroConnection(input: {
  code: string;
  entityCode: "UAE";
  currentUser: AuthenticatedUser;
}) {
  const config = requireXeroConfig();
  const prisma = getPrisma();
  const entity = await prisma.entities.findUnique({
    where: { code: input.entityCode },
    select: { id: true, code: true },
  });
  if (!entity) {
    throw new HttpError("not_found", 404, "Entity not found");
  }

  const tokens = await exchangeCodeForTokens({
    code: input.code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
  const tenants = await listXeroTenants(tokens.access_token);
  const tenant = tenants.find((item) => item.tenantType === "ORGANISATION");
  if (!tenant) {
    throw new HttpError(
      "xero_tenant_missing",
      422,
      "No Xero organisation tenant was returned",
    );
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const encryptedRefresh = encryptSecret(tokens.refresh_token, config.tokenKey);
  const scopes = (tokens.scope ?? config.scopes).split(/\s+/).filter(Boolean);

  return prisma.$transaction(async (tx) => {
    const connection = await tx.xero_connections.upsert({
      where: {
        entity_id_tenant_id: {
          entity_id: entity.id,
          tenant_id: tenant.tenantId,
        },
      },
      update: {
        tenant_name: tenant.tenantName,
        scopes,
        encrypted_refresh_token: encryptedRefresh,
        access_token_expires_at: expiresAt,
        status: "ACTIVE",
        disconnected_at: null,
        updated_at: new Date(),
      },
      create: {
        id: createId(),
        entity_id: entity.id,
        tenant_id: tenant.tenantId,
        tenant_name: tenant.tenantName,
        scopes,
        encrypted_refresh_token: encryptedRefresh,
        access_token_expires_at: expiresAt,
        status: "ACTIVE",
        connected_by: input.currentUser.id,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: input.currentUser.id,
        action: "xero.connection.upsert",
        entity_type: "xero_connections",
        entity_id: connection.id,
        before: Prisma.JsonNull,
        after: {
          entity_code: entity.code,
          tenant_id: tenant.tenantId,
          tenant_name: tenant.tenantName,
          scopes: connection.scopes,
          status: connection.status,
        },
      },
    });

    return connection;
  });
}

export async function disconnectXeroConnection(input: {
  connectionId: string;
  currentUser: AuthenticatedUser;
}) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.xero_connections.findUnique({
      where: { id: input.connectionId },
    });
    if (!existing) {
      throw new HttpError("not_found", 404, "Xero connection not found");
    }
    const updated = await tx.xero_connections.update({
      where: { id: input.connectionId },
      data: {
        status: "DISCONNECTED",
        disconnected_at: new Date(),
        updated_at: new Date(),
      },
    });
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: input.currentUser.id,
        action: "xero.connection.disconnect",
        entity_type: "xero_connections",
        entity_id: input.connectionId,
        before: {
          status: existing.status,
          disconnected_at: existing.disconnected_at?.toISOString() ?? null,
        },
        after: {
          status: updated.status,
          disconnected_at: updated.disconnected_at?.toISOString() ?? null,
        },
      },
    });
    return updated;
  });
}

/**
 * Refresh the connection's access token and rotate the stored refresh
 * token. Each Xero refresh issues a fresh refresh_token; persisting the
 * new one keeps the connection ACTIVE for the next 60-day window.
 */
export async function refreshConnectionAccess(input: {
  connectionId: string;
}): Promise<{
  connection: {
    id: string;
    tenant_id: string;
    entity_id: string;
    status: string;
  };
  accessToken: string;
}> {
  const config = requireXeroConfig();
  const prisma = getPrisma();
  const connection = await prisma.xero_connections.findUnique({
    where: { id: input.connectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    throw new HttpError(
      "xero_connection_inactive",
      422,
      "Xero connection is inactive",
    );
  }

  const refreshToken = decryptSecret(
    connection.encrypted_refresh_token,
    config.tokenKey,
  );
  const tokens = await refreshAccessToken({
    refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const updated = await prisma.xero_connections.update({
    where: { id: connection.id },
    data: {
      encrypted_refresh_token: encryptSecret(
        tokens.refresh_token,
        config.tokenKey,
      ),
      access_token_expires_at: expiresAt,
      updated_at: new Date(),
    },
  });

  return {
    connection: {
      id: updated.id,
      tenant_id: updated.tenant_id,
      entity_id: updated.entity_id,
      status: updated.status,
    },
    accessToken: tokens.access_token,
  };
}
