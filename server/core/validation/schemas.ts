import { z } from 'zod';

/**
 * Shared validation, used by both the public API and the dashboard forms so a
 * rule cannot be enforced in one place and forgotten in the other.
 */

/** A registrable domain name. Deliberately rejects a bare TLD and any scheme. */
export const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    'Must be a valid domain name, e.g. example.com',
  );

/**
 * RFC 5321 caps a local part at 64 octets. `*` is excluded on purpose: a
 * catch-all is domain configuration, not an address row (roadmap §1.2).
 */
export const localPartSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/,
    'Must be a valid email local part',
  );

export const createDomainSchema = z.object({
  name: domainNameSchema,
  /**
   * Opt-in catch-all. Off by default: it makes us receive mail for every local
   * part on the domain, including ones that do not exist.
   */
  createCatchAll: z.boolean().default(false),
});

export const createAddressSchema = z.object({
  domainId: z.string().min(1),
  localPart: localPartSchema,
  /**
   * Sending requires a concrete provider alias — Forward Email will not
   * authorise a `From:` that exists only behind a catch-all (roadmap §5.6).
   */
  canSend: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

export const updateAddressSchema = z
  .object({
    enabled: z.boolean().optional(),
    canSend: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: z.iso.datetime().nullable().default(null),
});

export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
