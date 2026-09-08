import { NextResponse } from 'next/server';

import { ValidationError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
import { MAIL_EVENT_TYPES, type MailEventType } from '@/server/core/types';
import { repositories } from '@/server/repositories';

/**
 * The unified event stream (roadmap Phase 9, plan §4.7).
 *
 * One endpoint over every event type, because the question an operator actually
 * has is "what happened to this message?" — and the answer spans capture,
 * forwarding, webhook delivery, and bounce handling. Splitting it per subsystem
 * would make the one useful view the one nobody can build.
 *
 * Filtering by address resolves the mailbox first, so address-less rejections
 * aimed at it are matched by recipient too. Mail that never became a message is
 * exactly what someone filtering by address is usually hunting for.
 */
export const GET = withApi(
  async ({ request }) => {
    const params = new URL(request.url).searchParams;

    const addressId = params.get('addressId');
    const recipient = addressId
      ? ((await repositories.addresses.findByIdWithDomain(addressId))?.email ??
        undefined)
      : undefined;

    const page = await repositories.events.list({
      emailId: params.get('emailId') ?? undefined,
      types: parseTypes(params.getAll('type')),
      addressId: addressId ?? undefined,
      recipient,
      endpointId: params.get('endpointId') ?? undefined,
      since: parseDate(params.get('since'), 'since'),
      until: parseDate(params.get('until'), 'until'),
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      cursor: params.get('cursor'),
    });

    return NextResponse.json({ data: page.items, nextCursor: page.nextCursor });
  },
  { endpoint: '/v1/events' },
);

/**
 * `?type=` may repeat. An unknown one is rejected rather than ignored: silently
 * dropping it would return the unfiltered stream, which reads as "there are no
 * events of that kind" — the opposite of the truth.
 */
function parseTypes(values: string[]): MailEventType[] | undefined {
  if (values.length === 0) return undefined;

  const unknown = values.filter(
    (value) => !MAIL_EVENT_TYPES.includes(value as MailEventType),
  );

  if (unknown.length > 0) {
    throw new ValidationError(`Unknown event type: ${unknown.join(', ')}`);
  }

  return values as MailEventType[];
}

function parseDate(value: string | null, field: string): Date | undefined {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`\`${field}\` is not a valid date`);
  }

  return date;
}
