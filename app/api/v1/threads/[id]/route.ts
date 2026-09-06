import { NextResponse } from 'next/server';

import { NotFoundError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
import { repositories } from '@/server/repositories';

/** A thread with its messages, oldest first — the conversation as read. */
export const GET = withApi(
  async ({ params }) => {
    const thread = await repositories.threads.findById(params.id);
    if (!thread) throw new NotFoundError(`Thread ${params.id} not found`);

    const { items } = await repositories.emails.list({
      threadId: thread.id,
      limit: 200,
    });

    return NextResponse.json({
      data: {
        ...thread,
        messages: [...items].reverse(),
      },
    });
  },
  { endpoint: '/v1/threads' },
);
