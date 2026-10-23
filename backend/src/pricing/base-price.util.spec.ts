import { channelPriceFromBase, channelTargets } from './base-price.util';

describe('channelPriceFromBase', () => {
  it.each([
    [500, 0, 500],
    [89.9, 0, 89.9], // no markup: the base as it is, not rounded
    [89.9, null, 89.9],
    [89.9, 10, 99], // 98.89 → 99
    [500, 10, 550],
    [500, -5, 475],
    [284, 10, 312], // 312.4 → 312
    [289, 10, 318], // 317.9 → 318
    [290, -15, 247], // 246.5 → 247 (half up)
    [500, null, 500],
    [500, undefined, 500],
    [500, Number.NaN, 500],
    [284.444, 0, 284.44],
  ])('%p with %p %% → %p', (base, pct, want) => {
    expect(channelPriceFromBase(base, pct as number | null | undefined)).toBe(want);
  });
});

describe('channelTargets', () => {
  const dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];

  it('a price typed for the night wins; else base with the markup; neither → left out', () => {
    const t = channelTargets(
      dates,
      { '2026-11-01': 500, '2026-11-02': 500, '2026-11-04': 0 },
      { '2026-11-02': 450, '2026-11-03': 480 },
      10,
    );
    expect([...t]).toEqual([
      ['2026-11-01', 550],
      ['2026-11-02', 450],
      ['2026-11-03', 480],
    ]);
  });

  it('a zero or negative typed price is ignored', () => {
    expect([...channelTargets(['2026-11-01'], { '2026-11-01': 500 }, { '2026-11-01': 0 }, 0)]).toEqual([['2026-11-01', 500]]);
  });
});
