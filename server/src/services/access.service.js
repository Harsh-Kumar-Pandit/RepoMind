import { getPrismaClient } from '../config/database.js';
import { AppError } from '../utils/errors.js';

/**
 * Fetch a user's membership and role in a repository.
 * Returns { isMember: boolean, role: 'OWNER' | 'MEMBER' | null, isUnowned: boolean, repositoryExists: boolean }
 */
export async function getRepositoryMembership(repositoryId, userId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: {
      id: true,
      members: {
        select: {
          id: true,
          userId: true,
          role: true,
        },
      },
    },
  });

  if (!repository) {
    return {
      repositoryExists: false,
      isMember: false,
      role: null,
      isUnowned: false,
      memberCount: 0,
    };
  }

  const memberCount = repository.members.length;
  const isUnowned = memberCount === 0;
  const member = repository.members.find((m) => m.userId === userId);

  return {
    repositoryExists: true,
    isMember: Boolean(member),
    role: member ? member.role : null,
    isUnowned,
    memberCount,
  };
}

/**
 * Assert that the given user has access to the repository with one of the allowed roles.
 * Throws 404 if repository does not exist, 403 if unauthorized or unowned.
 */
export async function requireRepositoryAccess(
  repositoryId,
  userId,
  allowedRoles = ['OWNER', 'MEMBER'],
  options = {}
) {
  if (!repositoryId || typeof repositoryId !== 'string') {
    throw new AppError('repositoryId is required.', 400, 'INVALID_INPUT');
  }
  if (!userId || typeof userId !== 'string') {
    throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
  }

  const membership = await getRepositoryMembership(repositoryId, userId, options);

  if (!membership.repositoryExists) {
    throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
  }

  if (membership.isUnowned) {
    throw new AppError(
      'Repository is unowned. Access denied until an explicit claim is established.',
      403,
      'REPOSITORY_UNOWNED'
    );
  }

  if (!membership.isMember || !allowedRoles.includes(membership.role)) {
    throw new AppError(
      'Access denied. You do not have permission to access this repository.',
      403,
      'FORBIDDEN'
    );
  }

  return membership;
}

/**
 * Atomically create or find a repository upon analysis.
 * If creating a brand-new repository, records the authenticated user as OWNER in the same transaction.
 * If the repository already exists:
 * - Does NOT assign ownership to the analyzing user.
 * - Leaves ownership unchanged.
 */
export async function findOrCreateRepositoryWithInitialOwner(
  { url, owner, name, defaultBranch },
  userId,
  options = {}
) {
  const prisma = options.prisma || getPrismaClient();

  // Fast-path: Check outside transaction to avoid opening unnecessary transactions
  const existing = await prisma.repository.findUnique({
    where: { url },
    include: {
      members: {
        select: { id: true, userId: true, role: true },
      },
    },
  });

  if (existing) {
    // Repository already exists. Do not alter or grant ownership.
    const userMember = existing.members.find((m) => m.userId === userId);
    return {
      repository: existing,
      created: false,
      isOwner: userMember?.role === 'OWNER',
      isMember: Boolean(userMember),
      isUnowned: existing.members.length === 0,
    };
  }

  // Short, bounded transaction with explicit timeout safeguards
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Double-check inside transaction in case another request created it concurrently
        const raceExisting = await tx.repository.findUnique({
          where: { url },
          include: {
            members: {
              select: { id: true, userId: true, role: true },
            },
          },
        });

        if (raceExisting) {
          const userMember = raceExisting.members.find((m) => m.userId === userId);
          return {
            repository: raceExisting,
            created: false,
            isOwner: userMember?.role === 'OWNER',
            isMember: Boolean(userMember),
            isUnowned: raceExisting.members.length === 0,
          };
        }

        // Create new repository and assign the authenticated user as initial OWNER
        const created = await tx.repository.create({
          data: {
            url,
            owner,
            name,
            defaultBranch: defaultBranch || 'main',
            members: {
              create: {
                userId,
                role: 'OWNER',
              },
            },
          },
          include: {
            members: {
              select: { id: true, userId: true, role: true },
            },
          },
        });

        return {
          repository: created,
          created: true,
          isOwner: true,
          isMember: true,
          isUnowned: false,
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );
  } catch (err) {
    // If a concurrent request created the repository simultaneously, handle unique constraint
    if (err.code === 'P2002') {
      const raceExisting = await prisma.repository.findUnique({
        where: { url },
        include: {
          members: {
            select: { id: true, userId: true, role: true },
          },
        },
      });
      if (raceExisting) {
        const userMember = raceExisting.members.find((m) => m.userId === userId);
        return {
          repository: raceExisting,
          created: false,
          isOwner: userMember?.role === 'OWNER',
          isMember: Boolean(userMember),
          isUnowned: raceExisting.members.length === 0,
        };
      }
    }
    throw err;
  }
}

/**
 * Atomically claim a legacy unowned repository.
 * Rejects if the repository already has any members (already owned or claimed).
 */
export async function claimLegacyRepository(repositoryId, userId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  return await prisma.$transaction(async (tx) => {
    const repository = await tx.repository.findUnique({
      where: { id: repositoryId },
      include: {
        members: true,
      },
    });

    if (!repository) {
      throw new AppError('Repository not found.', 404, 'REPOSITORY_NOT_FOUND');
    }

    if (repository.members.length > 0) {
      throw new AppError(
        'Repository already has an established owner or members. Cannot claim.',
        409,
        'REPOSITORY_ALREADY_CLAIMED'
      );
    }

    // Atomically insert the claimant as OWNER
    const member = await tx.repositoryMember.create({
      data: {
        repositoryId,
        userId,
        role: 'OWNER',
      },
    });

    return {
      repositoryId,
      userId,
      role: member.role,
      claimedAt: member.createdAt,
    };
  }, {
    maxWait: 10000,
    timeout: 20000,
  });
}

/**
 * Add a collaborator to a repository as MEMBER.
 * Only an existing OWNER may perform this operation.
 * Self-promotion or assigning OWNER role is rejected.
 */
export async function addRepositoryMember(
  repositoryId,
  actorUserId,
  { targetUserId, role = 'MEMBER' },
  options = {}
) {
  const prisma = options.prisma || getPrismaClient();

  if (!targetUserId || typeof targetUserId !== 'string') {
    throw new AppError('targetUserId is required.', 400, 'INVALID_INPUT');
  }

  if (role !== 'MEMBER') {
    throw new AppError('Collaborators may only be added with MEMBER role.', 400, 'INVALID_ROLE');
  }

  return await prisma.$transaction(async (tx) => {
    // Verify actor is an OWNER
    const actorMembership = await tx.repositoryMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: actorUserId,
        },
      },
    });

    if (!actorMembership || actorMembership.role !== 'OWNER') {
      throw new AppError(
        'Only repository owners can add collaborators.',
        403,
        'FORBIDDEN'
      );
    }

    // Verify target user exists
    const targetUser = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, login: true, name: true, avatarUrl: true },
    });

    if (!targetUser) {
      throw new AppError('Target user not found.', 404, 'USER_NOT_FOUND');
    }

    // Check if target user is already a member
    const existingMember = await tx.repositoryMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
    });

    if (existingMember) {
      throw new AppError('User is already a member of this repository.', 409, 'ALREADY_MEMBER');
    }

    const created = await tx.repositoryMember.create({
      data: {
        repositoryId,
        userId: targetUserId,
        role: 'MEMBER',
      },
      include: {
        user: {
          select: { id: true, login: true, name: true, avatarUrl: true },
        },
      },
    });

    return {
      id: created.id,
      repositoryId: created.repositoryId,
      user: created.user,
      role: created.role,
      createdAt: created.createdAt,
    };
  }, {
    maxWait: 10000,
    timeout: 20000,
  });
}

/**
 * List members of a repository.
 * Requires OWNER or MEMBER role.
 */
export async function listRepositoryMembers(repositoryId, actorUserId, options = {}) {
  const prisma = options.prisma || getPrismaClient();

  // Validate actor membership
  await requireRepositoryAccess(repositoryId, actorUserId, ['OWNER', 'MEMBER'], { prisma });

  const members = await prisma.repositoryMember.findMany({
    where: { repositoryId },
    include: {
      user: {
        select: { id: true, login: true, name: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    user: m.user,
    role: m.role,
    createdAt: m.createdAt,
  }));
}

/**
 * Remove a member from a repository.
 * Only an OWNER may remove members.
 * An OWNER cannot remove themselves (ownership transfer is not supported in this phase).
 */
export async function removeRepositoryMember(
  repositoryId,
  actorUserId,
  targetUserId,
  options = {}
) {
  const prisma = options.prisma || getPrismaClient();

  return await prisma.$transaction(async (tx) => {
    const actorMembership = await tx.repositoryMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: actorUserId,
        },
      },
    });

    if (!actorMembership || actorMembership.role !== 'OWNER') {
      throw new AppError('Only repository owners can remove members.', 403, 'FORBIDDEN');
    }

    if (actorUserId === targetUserId) {
      throw new AppError('Repository owners cannot remove themselves.', 400, 'CANNOT_REMOVE_SELF');
    }

    const targetMembership = await tx.repositoryMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMembership) {
      throw new AppError('Member not found in this repository.', 404, 'MEMBER_NOT_FOUND');
    }

    await tx.repositoryMember.delete({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
    });

    return { success: true, removedUserId: targetUserId };
  }, {
    maxWait: 10000,
    timeout: 20000,
  });
}

/**
 * Validate that a snapshot belongs to the specified repository.
 * Prevents cross-repository IDOR by snapshot ID substitution.
 */
export async function validateSnapshotRepositoryBinding(snapshotId, repositoryId, options = {}) {
  if (!snapshotId) return true; // Optional snapshotId
  const prisma = options.prisma || getPrismaClient();

  const snapshot = await prisma.repoSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, repositoryId: true },
  });

  if (!snapshot) {
    throw new AppError('Snapshot not found.', 404, 'SNAPSHOT_NOT_FOUND');
  }

  if (snapshot.repositoryId !== repositoryId) {
    throw new AppError(
      'Snapshot does not belong to the requested repository.',
      403,
      'SNAPSHOT_MISMATCH'
    );
  }

  return true;
}
