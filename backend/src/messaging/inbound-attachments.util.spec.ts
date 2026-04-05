import {
  buildGuestAgentText,
  formatAttachmentsForAgent,
  parseResendInboundAttachments,
} from './inbound-attachments.util';

describe('parseResendInboundAttachments', () => {
  it('returns empty for non-array', () => {
    expect(parseResendInboundAttachments(undefined)).toEqual([]);
    expect(parseResendInboundAttachments({})).toEqual([]);
  });

  it('parses filename and size variants', () => {
    expect(
      parseResendInboundAttachments([
        { filename: 'a.pdf', size: 2048 },
        { name: 'b.png', content_length: 100 },
        { file_name: ' c.txt ', size: '42' },
      ]),
    ).toEqual([
      { filename: 'a.pdf', sizeBytes: 2048 },
      { filename: 'b.png', sizeBytes: 100 },
      { filename: 'c.txt', sizeBytes: 42 },
    ]);
  });

  it('skips items without a filename', () => {
    expect(parseResendInboundAttachments([{ size: 1 }])).toEqual([]);
  });
});

describe('formatAttachmentsForAgent', () => {
  it('returns empty string when no attachments', () => {
    expect(formatAttachmentsForAgent([])).toBe('');
  });

  it('formats lines with optional size', () => {
    const lines = formatAttachmentsForAgent([
      { filename: 'x.pdf', sizeBytes: 500 },
      { filename: 'y.bin', sizeBytes: null },
    ]);
    expect(lines).toContain('[Attachment: x.pdf (~500 B)]');
    expect(lines).toContain('[Attachment: y.bin]');
  });
});

describe('buildGuestAgentText', () => {
  const id = (t: string) => t;

  it('non-booking: inquiry + attachments', () => {
    const s = buildGuestAgentText('direct', 'Hello', '', [{ filename: 'a.pdf', sizeBytes: 100 }], id);
    expect(s).toContain('[Attachment: a.pdf');
    expect(s).toContain('Hello');
  });

  it('booking: uses extractBookingInquiry', () => {
    const s = buildGuestAgentText('booking', 'RAW', '', [], (t) => (t === 'RAW' ? 'PARSED' : t));
    expect(s).toBe('PARSED');
  });

  it('falls back when empty', () => {
    expect(buildGuestAgentText('direct', '', 'Subj', [], id)).toBe('Subj');
    expect(buildGuestAgentText('direct', '', '', [], id)).toBe(
      'The guest sent an empty or non-text message.',
    );
  });
});
