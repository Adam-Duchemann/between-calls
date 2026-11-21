-- CreateEnum
CREATE TYPE "public"."McpProposalStatus" AS ENUM ('PENDING', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'DECLINED');

-- CreateTable
CREATE TABLE "public"."McpClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."McpGrant" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[],
    "redirectUri" TEXT NOT NULL,
    "codeHash" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "accessTokenHash" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "refreshTokenHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."McpProposal" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "public"."McpProposalStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "McpProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_codeHash_key" ON "public"."McpGrant"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_accessTokenHash_key" ON "public"."McpGrant"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_refreshTokenHash_key" ON "public"."McpGrant"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "McpGrant_userId_createdAt_idx" ON "public"."McpGrant"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "McpGrant_clientId_idx" ON "public"."McpGrant"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_id_userId_key" ON "public"."McpGrant"("id", "userId");

-- CreateIndex
CREATE INDEX "McpProposal_userId_createdAt_idx" ON "public"."McpProposal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "McpProposal_grantId_userId_idx" ON "public"."McpProposal"("grantId", "userId");

-- AddForeignKey
ALTER TABLE "public"."McpGrant" ADD CONSTRAINT "McpGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."McpGrant" ADD CONSTRAINT "McpGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."McpClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."McpProposal" ADD CONSTRAINT "McpProposal_grantId_userId_fkey" FOREIGN KEY ("grantId", "userId") REFERENCES "public"."McpGrant"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

