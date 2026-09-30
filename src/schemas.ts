/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { CHANNELS_SCHEMA, MESSAGES_SCHEMA, REACTIONS_SCHEMA } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { docPagesSchema, sourcesSchema } from './schemas/sources-schema'
import { checksSchema, claimsSchema, reviewsSchema } from './schemas/checks-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  sourcesSchema,
  docPagesSchema,
  checksSchema,
  claimsSchema,
  reviewsSchema,
  // Bundled messaging: one discussion channel per check.
  CHANNELS_SCHEMA,
  MESSAGES_SCHEMA,
  REACTIONS_SCHEMA,
]
