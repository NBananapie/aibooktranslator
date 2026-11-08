import { describe, expect, it } from 'vitest';
import { analyzePageLayout, joinLines, LayoutTextItem } from './layoutAnalysisEngine';

const PAGE_HEIGHT = 800;

/** 构造一个 TextItem：x, 顶部 y（左上角原点）, 文本, 字号 */
function item(x: number, top: number, str: string, size = 10): LayoutTextItem {
  return {
    str,
    transform: [size, 0, 0, size, x, PAGE_HEIGHT - top - size],
    width: str.length * size * 0.5,
    height: size,
  };
}

describe('joinLines', () => {
  it('removes hyphenation before lowercase continuation', () => {
    expect(joinLines('soft-', 'ware is')).toBe('software is');
  });
  it('keeps hyphen before uppercase or digits', () => {
    expect(joinLines('Covid-', '19 cases')).toBe('Covid-19 cases');
  });
  it('joins normal lines with a space', () => {
    expect(joinLines('hello', 'world')).toBe('hello world');
  });
});

describe('analyzePageLayout', () => {
  it('groups lines into paragraphs separated by large gaps', () => {
    const items = [
      item(50, 100, 'First paragraph line one'),
      item(50, 112, 'first paragraph line two.'),
      item(50, 160, 'Second paragraph.'),
    ];
    const blocks = analyzePageLayout(items, [0, 0, 600, PAGE_HEIGHT], 3);
    expect(blocks.map(b => b.text)).toEqual([
      'First paragraph line one first paragraph line two.',
      'Second paragraph.',
    ]);
    expect(blocks[0].id).toBe('p3_b0');
  });

  it('reads two-column pages column by column', () => {
    const items: LayoutTextItem[] = [];
    for (let i = 0; i < 10; i++) {
      const top = 100 + i * 12;
      items.push(item(40, top, `left ${i}`));
      items.push(item(330, top, `right ${i}`));
    }
    const blocks = analyzePageLayout(items, [0, 0, 600, PAGE_HEIGHT], 1);
    const text = blocks.map(b => b.text).join(' ');
    expect(text.indexOf('left 9')).toBeLessThan(text.indexOf('right 0'));
    expect(text).not.toMatch(/left 0 right 0/);
  });

  it('marks large-font lines as headings', () => {
    const items = [item(50, 50, 'Chapter One', 20), item(50, 90, 'Body text here.'), item(50, 102, 'More body.')];
    const blocks = analyzePageLayout(items, [0, 0, 600, PAGE_HEIGHT], 1);
    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'Chapter One' });
  });
});
