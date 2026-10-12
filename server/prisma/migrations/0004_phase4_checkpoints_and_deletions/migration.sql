-- Migration 0004_phase4_checkpoints_and_deletions
-- Additive migration for isDeleted column and WorkspaceCheckpoint / WorkspaceCheckpointFile tables

-- 1. AlterTable WorkspaceFile add isDeleted
ALTER TABLE "WorkspaceFile" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- 2. CreateTable WorkspaceCheckpoint
CREATE TABLE IF NOT EXISTS "WorkspaceCheckpoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceCheckpoint_pkey" PRIMARY KEY ("id")
);

-- 3. CreateTable WorkspaceCheckpointFile
CREATE TABLE IF NOT EXISTS "WorkspaceCheckpointFile" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "language" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER NOT NULL,
    CONSTRAINT "WorkspaceCheckpointFile_pkey" PRIMARY KEY ("id")
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS "WorkspaceCheckpoint_workspaceId_createdAt_idx" ON "WorkspaceCheckpoint"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkspaceCheckpoint_userId_idx" ON "WorkspaceCheckpoint"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceCheckpointFile_checkpointId_path_key" ON "WorkspaceCheckpointFile"("checkpointId", "path");
CREATE INDEX IF NOT EXISTS "WorkspaceCheckpointFile_checkpointId_idx" ON "WorkspaceCheckpointFile"("checkpointId");

-- 5. Foreign Key Constraints
ALTER TABLE "WorkspaceCheckpoint" DROP CONSTRAINT IF EXISTS "WorkspaceCheckpoint_workspaceId_fkey";
ALTER TABLE "WorkspaceCheckpoint" ADD CONSTRAINT "WorkspaceCheckpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCheckpoint" DROP CONSTRAINT IF EXISTS "WorkspaceCheckpoint_userId_fkey";
ALTER TABLE "WorkspaceCheckpoint" ADD CONSTRAINT "WorkspaceCheckpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceCheckpointFile" DROP CONSTRAINT IF EXISTS "WorkspaceCheckpointFile_checkpointId_fkey";
ALTER TABLE "WorkspaceCheckpointFile" ADD CONSTRAINT "WorkspaceCheckpointFile_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "WorkspaceCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
