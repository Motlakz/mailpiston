import { describe, expect, it } from 'vitest';

import {
  classify,
  looksLikeAWord,
  type ClassificationInput,
} from './classifier';

/**
 * A plainly legitimate support message, used as the baseline every case below
 * varies from. If this ever classifies as anything but `clean`, a rule has
 * become too eager and the test that matters is this one.
 */
function message(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    from: 'Dana Okonkwo <dana@acme-industries.com>',
    envelopeSender: 'dana@acme-industries.com',
    subject: 'Cannot export my weekly report',
    text:
      'Hi there, since yesterday the export button on the reports page does ' +
      'nothing when I click it. I have tried Chrome and Firefox on two ' +
      'different machines. Could you take a look when you get a chance? ' +
      'My account email is dana@acme-industries.com. Thanks very much.',
    html: null,
    headers: {
      'Authentication-Results': 'mx.receiving-host.test; spf=pass; dkim=pass; dmarc=pass',
    },
    attachments: [],
    inReplyTo: null,
    ...overrides,
  };
}

describe('the baseline', () => {
  it('leaves an ordinary support request alone', () => {
    const result = classify(message());

    expect(result.verdict).toBe('clean');
    expect(result.score).toBe(0);
    expect(result.category).toBeNull();
  });

  it('records a reason for everything it does flag', () => {
    const result = classify(
      message({ attachments: [{ filename: 'invoice.exe', contentType: 'application/octet-stream' }] }),
    );

    expect(result.signals.length).toBeGreaterThan(0);
    for (const signal of result.signals) {
      expect(signal.rule).toBeTruthy();
      expect(signal.category).toBeTruthy();
    }
  });
});

describe('operator lists', () => {
  it('blocks a denied sender outright', () => {
    const result = classify(
      message({ denyList: ['dana@acme-industries.com'] }),
    );

    expect(result.verdict).toBe('spam');
    expect(result.signals[0].rule).toBe('sender_denied');
  });

  it('lets a denied domain cover its subdomains', () => {
    const result = classify(
      message({
        from: 'noreply@mail.spammy.example',
        denyList: ['spammy.example'],
      }),
    );

    expect(result.verdict).toBe('spam');
  });

  it('clears an allowed sender no matter what else fires', () => {
    const result = classify(
      message({
        subject: 'Verify your account or it will be suspended within 24 hours',
        text: 'Click here to restore your account. Confirm your password now.',
        headers: { 'Authentication-Results': 'dmarc=fail; spf=fail' },
        allowList: ['acme-industries.com'],
      }),
    );

    expect(result.verdict).toBe('clean');
    expect(result.signals).toHaveLength(0);
  });
});

describe('authentication', () => {
  it('treats a DMARC failure as the strong signal it is', () => {
    const result = classify(
      message({
        headers: {
          'Authentication-Results': 'mx.receiving-host.test; spf=fail; dkim=fail; dmarc=fail',
        },
      }),
    );

    expect(result.verdict).toBe('spam');
    expect(result.category).toBe('authentication');
    expect(result.signals.map((signal) => signal.rule)).toContain('dmarc_fail');
  });

  it('catches a display name claiming a domain it is not sending from', () => {
    const result = classify(
      message({
        from: '"PayPal Service <service@paypal.com>" <billing@secure-check.example>',
      }),
    );

    expect(result.signals.map((signal) => signal.rule)).toContain(
      'display_name_spoof',
    );
  });

  it('does not punish a subdomain sender', () => {
    const result = classify(
      message({
        from: '"Stripe <support@stripe.com>" <receipts@mail.stripe.com>',
      }),
    );

    expect(result.signals.map((signal) => signal.rule)).not.toContain(
      'display_name_spoof',
    );
  });
});

describe('phishing', () => {
  it('flags account-urgency language', () => {
    const result = classify(
      message({
        subject: 'Your account has been suspended',
        text: 'Unusual sign-in detected. Confirm your password within 24 hours or your access will be removed.',
      }),
    );

    expect(result.signals.map((signal) => signal.rule)).toContain(
      'urgency_lexicon',
    );
    expect(result.verdict).not.toBe('clean');
  });

  it('catches anchor text that names a different domain from its link', () => {
    const result = classify(
      message({
        html: '<p>Sign in at <a href="https://login-verify.example/x">stripe.com</a></p>',
      }),
    );

    expect(result.signals.map((signal) => signal.rule)).toContain(
      'link_text_mismatch',
    );
  });

  it('leaves an honest link alone', () => {
    const result = classify(
      message({
        html: '<p>Our docs are at <a href="https://stripe.com/docs">stripe.com</a></p>',
      }),
    );

    expect(result.verdict).toBe('clean');
  });

  it('flags a link to a bare IP address', () => {
    const result = classify(
      message({ html: '<a href="http://203.0.113.9/login">click</a>' }),
    );

    expect(result.signals.map((signal) => signal.rule)).toContain('link_to_ip');
  });
});

describe('malware', () => {
  it('quarantines an executable attachment', () => {
    const result = classify(
      message({
        attachments: [
          { filename: 'Invoice_2026.pdf.exe', contentType: 'application/pdf' },
        ],
      }),
    );

    expect(result.category).toBe('malware');
    expect(result.score).toBeGreaterThanOrEqual(45);
  });

  it('is not fooled by a lying content type', () => {
    const result = classify(
      message({
        attachments: [{ filename: 'photo.scr', contentType: 'image/jpeg' }],
      }),
    );

    expect(result.signals.map((signal) => signal.rule)).toContain(
      'executable_attachment',
    );
  });

  it('flags an archive whose password is in the body', () => {
    const result = classify(
      message({
        text: 'Documents attached. The password is Hunter2 — open it on your PC.',
        attachments: [{ filename: 'docs.zip', contentType: 'application/zip' }],
      }),
    );

    expect(result.signals.map((signal) => signal.rule)).toContain(
      'password_protected_archive',
    );
  });

  it('leaves an ordinary PDF alone', () => {
    const result = classify(
      message({
        attachments: [{ filename: 'screenshot.png', contentType: 'image/png' }],
      }),
    );

    expect(result.verdict).toBe('clean');
  });
});

describe('promotional', () => {
  it('treats List-Unsubscribe as a bulk-send declaration', () => {
    const result = classify(
      message({
        headers: { 'List-Unsubscribe': '<https://example.com/u/123>' },
      }),
    );

    expect(result.signals.map((signal) => signal.rule)).toContain(
      'list_unsubscribe',
    );
  });

  it('does not quarantine a newsletter on headers alone', () => {
    // A campaign a customer forwarded into support is still something the
    // operator should see. Suspicious, not hidden.
    const result = classify(
      message({
        headers: { 'List-Unsubscribe': '<https://example.com/u/123>' },
      }),
    );

    expect(result.verdict).toBe('suspicious');
  });

  it('quarantines an obvious campaign', () => {
    const result = classify(
      message({
        subject: '48 hours only — 40% off everything',
        text: 'Shop now for a limited time offer. You are receiving this because you signed up. Unsubscribe here.',
        headers: {
          'List-Unsubscribe': '<https://shop.example/u/9>',
          Precedence: 'bulk',
        },
      }),
    );

    expect(result.verdict).toBe('spam');
    expect(result.category).toBe('promotional');
  });
});

describe('gibberish', () => {
  it('flags a body of random strings', () => {
    const result = classify(
      message({
        subject: 'xkqzr7 plmfgh',
        text: 'zxcvbn qwrtpy lkjhgf mnbvcx plmokn ijnuhb ygvtfc rdxesz wqazxs edcrfv',
      }),
    );

    expect(result.category).toBe('gibberish');
    expect(result.verdict).toBe('spam');
  });

  it('leaves normal prose alone', () => {
    expect(classify(message()).verdict).toBe('clean');
  });

  it('does not mistake a non-English message for noise', () => {
    const result = classify(
      message({
        subject: 'Probleem met die uitvoerknoppie',
        text:
          'Goeie dag, ek kan nie my weeklikse verslag uitvoer nie. Die knoppie ' +
          'doen niks wanneer ek daarop klik nie. Kan julle asseblief kyk wat ' +
          'verkeerd is met my rekening? Baie dankie vir julle hulp.',
      }),
    );

    expect(result.verdict).toBe('clean');
  });

  it('tolerates prose carrying identifiers and product names', () => {
    const result = classify(
      message({
        text:
          'My order id is 8f3a-22bd and the SKU is XR-9920. The error code was ' +
          'ERR_CONN_RESET when I tried to download the invoice from the billing ' +
          'page, so I wanted to check whether something is wrong on your side.',
      }),
    );

    expect(result.verdict).toBe('clean');
  });
});

describe('looksLikeAWord', () => {
  it.each(['hello', 'export', 'rekening', 'invoice', 'ok', 'a7', 'weeklikse'])(
    'accepts %s',
    (word) => {
      expect(looksLikeAWord(word)).toBe(true);
    },
  );

  it.each(['zxcvbn', 'qwrtpy', 'xkqzr7mbn', 'a7f3kq9x', 'bcdfghjk'])(
    'rejects %s',
    (word) => {
      expect(looksLikeAWord(word)).toBe(false);
    },
  );
});

describe('cold outreach', () => {
  it('quarantines an SEO pitch', () => {
    const result = classify(
      message({
        from: 'Marcus <marcus@growth-agency.example>',
        subject: 'Quick question about bellyclock.com',
        text:
          'Hope this email finds you well. I came across your website and ' +
          'noticed some opportunities to boost your rankings. We help ' +
          'companies like yours with link building and guest posts. Would ' +
          'love to connect — do you have 15 minutes this week?',
      }),
    );

    expect(result.verdict).toBe('spam');
    expect(result.category).toBe('cold_outreach');
  });

  it('only nudges on a single phrase, since real mail uses them too', () => {
    const result = classify(
      message({
        text: "I'm reaching out because the export button has been broken for two days and I need the report for a board meeting on Friday.",
      }),
    );

    expect(result.verdict).toBe('clean');
  });
});

describe('empty deliveries', () => {
  it('flags a message with nothing in it', () => {
    const result = classify(
      message({ subject: null, text: null, html: null }),
    );

    expect(result.category).toBe('empty');
  });

  it('does not flag an attachment-only message', () => {
    const result = classify(
      message({
        subject: 'Logs',
        text: null,
        html: null,
        attachments: [{ filename: 'app.log', contentType: 'text/plain' }],
      }),
    );

    expect(result.verdict).toBe('clean');
  });
});

describe('the known-correspondent discount', () => {
  it('rescues a newsletter forwarded into an existing thread', () => {
    const promotional = {
      headers: { 'List-Unsubscribe': '<https://example.com/u/1>' },
      text: 'Forwarding this — is this offer real? Unsubscribe link at the bottom, view in browser too.',
    };

    expect(classify(message(promotional)).verdict).not.toBe('clean');
    expect(
      classify(message({ ...promotional, inReplyTo: '<abc@acme-industries.com>' }))
        .verdict,
    ).toBe('clean');
  });

  it('still quarantines malware from somebody we know', () => {
    // A compromised account mid-thread is exactly how a convincing attack
    // arrives, so the discount must not be an exemption.
    const result = classify(
      message({
        knownCorrespondent: true,
        inReplyTo: '<abc@acme-industries.com>',
        attachments: [{ filename: 'statement.exe', contentType: 'application/pdf' }],
        headers: { 'Authentication-Results': 'spf=fail; dkim=fail; dmarc=fail' },
      }),
    );

    expect(result.verdict).toBe('spam');
  });
});
