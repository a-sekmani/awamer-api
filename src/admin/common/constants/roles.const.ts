/**
 * Canonical re-export of the Prisma `Role` enum for use inside admin code.
 *
 * Why this exists:
 * - JWT payloads carry roles as the Prisma enum's TypeScript values (UPPERCASE,
 *   e.g. `'ADMIN'`, `'LEARNER'`). The DB stores lowercase via `@map`, but the
 *   in-memory representation is uppercase.
 * - All admin code MUST use this enum (or `Role` imported from `@prisma/client`
 *   directly) when comparing against `req.user.roles` so that string casing
 *   stays consistent with how the auth layer issues JWTs.
 *
 * Future admin sub-modules:
 *   import { Role } from 'src/admin/common/constants/roles.const';
 *   @Roles(Role.ADMIN)
 *   @Controller('admin/<entity>') ...
 */
export { Role } from '@prisma/client';
