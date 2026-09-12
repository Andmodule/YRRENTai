import {
  assertZodomusSuccess,
  deriveZodomusPropertyStatus,
  formatZodomusReturnMessage,
  isZodomusSuccessBody,
} from './zodomus-status.util';

describe('isZodomusSuccessBody', () => {
  it('возвращает true при returnCode "0"', () => {
    expect(isZodomusSuccessBody({ status: { returnCode: '0' } })).toBe(true);
  });

  it('возвращает true при returnCode 200 (число)', () => {
    expect(isZodomusSuccessBody({ status: { returnCode: 200 } })).toBe(true);
  });

  it('возвращает true при плоском returnCode "0"', () => {
    expect(isZodomusSuccessBody({ returnCode: '0' })).toBe(true);
  });

  it('возвращает false при returnCode "400"', () => {
    expect(isZodomusSuccessBody({ status: { returnCode: '400' } })).toBe(false);
  });

  it('возвращает true если нет returnCode вообще', () => {
    expect(isZodomusSuccessBody({ data: [] })).toBe(true);
  });

  it('возвращает true для null/undefined', () => {
    expect(isZodomusSuccessBody(null)).toBe(true);
    expect(isZodomusSuccessBody(undefined)).toBe(true);
  });
});

describe('formatZodomusReturnMessage', () => {
  it('stringifies property-check object messages', () => {
    const msg = {
      'Property status': 'Evaluation OTA',
      'Channel status': 'Error: Zodomus is still waiting to access channel data',
    };
    expect(formatZodomusReturnMessage(msg)).toContain('Evaluation OTA');
  });
});

describe('deriveZodomusPropertyStatus', () => {
  it('maps Evaluation OTA / waiting channel to evaluation', () => {
    expect(
      deriveZodomusPropertyStatus(
        JSON.stringify({
          'Property status': 'Evaluation OTA',
          'Channel status': 'Error: Zodomus is still waiting to access channel data',
        }),
      ),
    ).toBe('evaluation');
  });

  it('maps Property status not Active', () => {
    expect(deriveZodomusPropertyStatus('Property status not Active')).toBe('not_active');
  });

  it('maps HOTEL_ACCESS_DENIED to evaluation', () => {
    expect(deriveZodomusPropertyStatus('fault code HOTEL_ACCESS_DENIED')).toBe('evaluation');
  });
});

describe('assertZodomusSuccess', () => {
  it('puts JSON detail when returnMessage is an object', () => {
    try {
      assertZodomusSuccess('POST /property-check', {
        status: {
          returnCode: '400',
          returnMessage: {
            'Property status': 'Evaluation OTA',
            'Channel status': 'waiting to access channel data',
          },
        },
      });
      fail('expected throw');
    } catch (e) {
      const r = (e as { getResponse: () => Record<string, unknown> }).getResponse();
      expect(String(r.detail)).toContain('Evaluation OTA');
      expect(deriveZodomusPropertyStatus(String(r.detail))).toBe('evaluation');
    }
  });
});
