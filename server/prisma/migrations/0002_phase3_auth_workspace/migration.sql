-- Migration 0002_phase3_auth_workspace
-- Additive migration for User, Session, RepositoryMember, Workspace, WorkspaceFile, ChatThread, ChatMessage

-- CreateEnum RepositoryRole
DO $$ BEGIN
  CREATE TYPE "RepositoryRole" AS ENUM ('OWNER', 'MEMBER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable User
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable Session
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipHash" TEXT,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable RepositoryMember
CREATE TABLE IF NOT EXISTS "RepositoryMember" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RepositoryRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepositoryMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable Workspace
CREATE TABLE IF NOT EXISTS "Workspace" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCommitSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable WorkspaceFile
CREATE TABLE IF NOT EXISTS "WorkspaceFile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "language" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable ChatThread
CREATE TABLE IF NOT EXISTS "ChatThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable ChatMessage
CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- Unique constraints and indexes
CREATE UNIQUE INDEX IF NOT EXISTS "User_githubId_key" ON "User"("githubId");

CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "Session_tokenHash_revokedAt_expiresAt_idx" ON "Session"("tokenHash", "revokedAt", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "RepositoryMember_repositoryId_userId_key" ON "RepositoryMember"("repositoryId", "userId");
CREATE INDEX IF NOT EXISTS "RepositoryMember_userId_idx" ON "RepositoryMember"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_repositoryId_userId_name_key" ON "Workspace"("repositoryId", "userId", "name");
CREATE INDEX IF NOT EXISTS "Workspace_userId_idx" ON "Workspace"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceFile_workspaceId_path_key" ON "WorkspaceFile"("workspaceId", "path");
CREATE INDEX IF NOT EXISTS "WorkspaceFile_workspaceId_idx" ON "WorkspaceFile"("workspaceId");

CREATE INDEX IF NOT EXISTS "ChatThread_userId_repositoryId_idx" ON "ChatThread"("userId", "repositoryId");
CREATE INDEX IF NOT EXISTS "ChatThread_snapshotId_idx" ON "ChatThread"("snapshotId");

CREATE INDEX IF NOT EXISTS "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- Foreign key constraints with safe referential actions
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryMember" DROP CONSTRAINT IF EXISTS "RepositoryMember_repositoryId_fkey";
ALTER TABLE "RepositoryMember" ADD CONSTRAINT "RepositoryMember_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryMember" DROP CONSTRAINT IF EXISTS "RepositoryMember_userId_fkey";
ALTER TABLE "RepositoryMember" ADD CONSTRAINT "RepositoryMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Workspace" DROP CONSTRAINT IF EXISTS "Workspace_repositoryId_fkey";
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Workspace" DROP CONSTRAINT IF EXISTS "Workspace_userId_fkey";
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceFile" DROP CONSTRAINT IF EXISTS "WorkspaceFile_workspaceId_fkey";
ALTER TABLE "WorkspaceFile" ADD CONSTRAINT "WorkspaceFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_userId_fkey";
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_repositoryId_fkey";
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Snapshot reference uses SET NULL to preserve chat history if a specific snapshot is deleted/pruned
ALTER TABLE "ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_snapshotId_fkey";
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepoSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatMessage" DROP CONSTRAINT IF EXISTS "ChatMessage_threadId_fkey";
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
