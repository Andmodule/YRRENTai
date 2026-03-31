import { isZodomusSuccessBody } from './zodomus-status.util';

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
