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

const recipients = z.array(z.email()).min(1).max(50);

/** A body has to be *something*: an empty message is never intentional. */
const messageBody = {
  text: z.string().max(1_000_000).optional(),
  html: z.string().max(1_000_000).optional(),
};

const hasBody = (value: { text?: string; html?: string }) =>
  Boolean(value.text?.trim() || value.html?.trim());

export const sendEmailSchema = z
  .object({
    addressId: z.string().min(1),
    to: recipients,
    cc: z.array(z.email()).max(50).optional(),
    bcc: z.array(z.email()).max(50).optional(),
    subject: z.string().trim().min(1).max(998),
    ...messageBody,
  })
  .refine(hasBody, { message: 'A message needs a text or HTML body' });

export const replyEmailSchema = z
  .object({
    /** Defaults to the sender of the message being answered. */
    to: recipients.optional(),
    cc: z.array(z.email()).max(50).optional(),
    ...messageBody,
  })
  .refine(hasBody, { message: 'A reply needs a text or HTML body' });

/**
 * A webhook destination.
 *
 * The shape is all this can check. Whether the URL points somewhere it is
 * allowed to point — https, and not into our own network — is a question about
 * DNS, so it belongs in `webhooks/url-guard.ts` and is asked again immediately
 * before every delivery.
 */
export const webhookUrlSchema = z.url().max(2000);

export const createEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(['webhook', 'email', 'email_group']),
    enabled: z.boolean().default(true),
    /** Required for `webhook`, refused for the mailbox subtypes. */
    url: webhookUrlSchema.optional(),
  })
  .refine((value) => value.type !== 'webhook' || Boolean(value.url), {
    message: 'A webhook endpoint needs a URL',
    path: ['url'],
  });

export const updateEndpointSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    url: webhookUrlSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const addRecipientSchema = z.object({
  email: z.email(),
});

/**
 * One route, two steps: issue a challenge, then confirm it.
 *
 * They are the same resource transition and share the plan's single
 * `/verify` path; the discriminant says which half is being asked for.
 */
export const verifyRecipientSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send'),
    /** The managed address the challenge is sent from — and later forwards from. */
    fromAddressId: z.string().min(1),
  }),
  z.object({
    action: z.literal('confirm'),
    token: z.string().trim().min(1).max(200),
  }),
]);

export const bindEndpointSchema = z.object({
  endpointId: z.string().min(1),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: z.iso.datetime().nullable().default(null),
});

export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
export type UpdateEndpointInput = z.infer<typeof updateEndpointSchema>;
export type AddRecipientInput = z.infer<typeof addRecipientSchema>;
export type VerifyRecipientInput = z.infer<typeof verifyRecipientSchema>;
export type BindEndpointInput = z.infer<typeof bindEndpointSchema>;
export type SendEmailInput = z.infer<typeof sendEmailSchema>;
export type ReplyEmailInput = z.infer<typeof replyEmailSchema>;
