import { sql } from "drizzle-orm"
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core"
import { session, user } from "./auth"

/**
 * Tables of better-auth's JWT and OAuth provider plugins (v1.7). Keep in sync with `auth.server.ts`
 * in apps/web; diff against `auth:generate` output after upgrading better-auth (see auth.ts).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true })

/** Signing keys for OAuth access and ID tokens. Private keys are encrypted with the auth secret. */
export const jwks = pgTable("jwks", {
	id: text("id").primaryKey(),
	publicKey: text("public_key").notNull(),
	privateKey: text("private_key").notNull(),
	createdAt: ts("created_at").notNull(),
	expiresAt: ts("expires_at"),
	alg: text("alg"),
	crv: text("crv"),
})

export const oauthClient = pgTable(
	"oauth_client",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id").notNull().unique(),
		clientSecret: text("client_secret"),
		clientDiscoveryId: text("client_discovery_id"),
		disabled: boolean("disabled").default(false),
		skipConsent: boolean("skip_consent"),
		enableEndSession: boolean("enable_end_session"),
		subjectType: text("subject_type"),
		scopes: text("scopes").array(),
		clientCredentialsScopes: text("client_credentials_scopes")
			.array()
			.default(sql`'{}'::text[]`),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		createdAt: ts("created_at"),
		updatedAt: ts("updated_at"),
		name: text("name"),
		uri: text("uri"),
		icon: text("icon"),
		contacts: text("contacts").array(),
		tos: text("tos"),
		policy: text("policy"),
		softwareId: text("software_id"),
		softwareVersion: text("software_version"),
		softwareStatement: text("software_statement"),
		redirectUris: text("redirect_uris").array().notNull(),
		postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
		backchannelLogoutUri: text("backchannel_logout_uri"),
		backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
		tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
		applicationType: text("application_type"),
		jwks: text("jwks"),
		jwksUri: text("jwks_uri"),
		grantTypes: text("grant_types").array(),
		responseTypes: text("response_types").array(),
		requirePKCE: boolean("require_pkce"),
		dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
		referenceId: text("reference_id"),
		metadata: jsonb("metadata"),
	},
	(t) => [index("oauth_client_user_id_idx").on(t.userId)],
)

export const oauthResource = pgTable("oauth_resource", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull().unique(),
	name: text("name").notNull(),
	accessTokenTtl: integer("access_token_ttl"),
	refreshTokenTtl: integer("refresh_token_ttl"),
	signingAlgorithm: text("signing_algorithm"),
	signingKeyId: text("signing_key_id"),
	allowedScopes: text("allowed_scopes").array(),
	customClaims: jsonb("custom_claims"),
	dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
	disabled: boolean("disabled").default(false),
	createdAt: ts("created_at"),
	updatedAt: ts("updated_at"),
	policyVersion: integer("policy_version").default(1),
	metadata: jsonb("metadata"),
})

export const oauthClientResource = pgTable(
	"oauth_client_resource",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		resourceId: text("resource_id")
			.notNull()
			.references(() => oauthResource.identifier, { onDelete: "cascade" }),
		metadata: jsonb("metadata"),
		createdAt: ts("created_at"),
	},
	(t) => [
		uniqueIndex("oauth_client_resource_pair_idx").on(t.clientId, t.resourceId),
		index("oauth_client_resource_resource_id_idx").on(t.resourceId),
	],
)

export const oauthRefreshToken = pgTable(
	"oauth_refresh_token",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: text("resources").array(),
		requestedUserInfoClaims: text("requested_user_info_claims").array(),
		expiresAt: ts("expires_at"),
		createdAt: ts("created_at"),
		revoked: ts("revoked"),
		rotatedAt: ts("rotated_at"),
		rotationReplayResponse: text("rotation_replay_response"),
		rotationReplayExpiresAt: ts("rotation_replay_expires_at"),
		authTime: ts("auth_time"),
		confirmation: jsonb("confirmation"),
		scopes: text("scopes").array().notNull(),
	},
	(t) => [
		index("oauth_refresh_token_client_id_idx").on(t.clientId),
		index("oauth_refresh_token_session_id_idx").on(t.sessionId),
		index("oauth_refresh_token_user_id_idx").on(t.userId),
		index("oauth_refresh_token_authorization_code_id_idx").on(t.authorizationCodeId),
	],
)

export const oauthAccessToken = pgTable(
	"oauth_access_token",
	{
		id: text("id").primaryKey(),
		token: text("token").unique(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: text("resources").array(),
		requestedUserInfoClaims: text("requested_user_info_claims").array(),
		refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
		expiresAt: ts("expires_at"),
		createdAt: ts("created_at"),
		revoked: ts("revoked"),
		confirmation: jsonb("confirmation"),
		scopes: text("scopes").array().notNull(),
	},
	(t) => [
		index("oauth_access_token_client_id_idx").on(t.clientId),
		index("oauth_access_token_session_id_idx").on(t.sessionId),
		index("oauth_access_token_user_id_idx").on(t.userId),
		index("oauth_access_token_authorization_code_id_idx").on(t.authorizationCodeId),
		index("oauth_access_token_refresh_id_idx").on(t.refreshId),
	],
)

export const oauthConsent = pgTable(
	"oauth_consent",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		resources: text("resources").array(),
		requestedUserInfoClaims: text("requested_user_info_claims").array(),
		scopes: text("scopes").array().notNull(),
		createdAt: ts("created_at"),
		updatedAt: ts("updated_at"),
	},
	(t) => [
		index("oauth_consent_client_id_idx").on(t.clientId),
		index("oauth_consent_user_id_idx").on(t.userId),
	],
)

export const oauthClientAssertion = pgTable("oauth_client_assertion", {
	id: text("id").primaryKey(),
	expiresAt: ts("expires_at").notNull(),
})
