import { describe, expect, it } from 'vitest';
import { formatPageRanges, parsePageRangeInput } from './pageRanges';
import { buildExplainUserPrompt } from './llm/prompts';

describe('formatPageRanges', () => {
  it('returns fallback page when input is empty', () => {
    expect(formatPageRanges([], 7)).toBe('P.7');
  });

  it('formats single and contiguous pages cleanly', () => {
    expect(formatPageRanges([42])).toBe('P.42');
    expect(formatPageRanges([43, 41, 42, 42])).toBe('P.41–43');
  });

  it('compresses multiple disjoint segments with ellipsis suffix when exceeding maxSegments', () => {
    expect(formatPageRanges([10, 11, 12, 15])).toBe('P.10–12, 15');
    expect(formatPageRanges([10, 11, 15, 18, 19, 25])).toBe('P.10–11, 15 等');
  });
});

describe('parsePageRangeInput', () => {
  it('parses comma/space separated single pages and hyphen/tilde ranges within bounds', () => {
    expect(parsePageRangeInput('40-43, 46，50~51', 60)).toEqual([40, 41, 42, 43, 46, 50, 51]);
  });

  it('clamps reversed or out-of-bounds ranges and enforces maxCount', () => {
    expect(parsePageRangeInput('5-3, 98-105', 100)).toEqual([3, 4, 5, 98, 99, 100]);
    expect(parsePageRangeInput('1-100', 200, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores invalid tokens gracefully', () => {
    expect(parsePageRangeInput('abc, 0, -4, 12', 50)).toEqual([12]);
  });
});

describe('buildExplainUserPrompt', () => {
  it('builds selection-focused prompt when selectedText is provided without question', () => {
    const prompt = buildExplainUserPrompt({
      selectedText: 'gradient descent',
      contextText: '=== 第 12 页 ===\nOptimization methods...',
    });
    expect(prompt).toContain('gradient descent');
    expect(prompt).toContain('=== 第 12 页 ===');
    expect(prompt).toContain('语境释义');
  });

  it('builds general multi-page Q&A prompt when selectedText is empty and question is provided', () => {
    const prompt = buildExplainUserPrompt({
      selectedText: '   ',
      contextText: '=== 第 41 页 ===\nA\n\n=== 第 42 页 ===\nB',
      question: '这两页的论证如何递进？',
    });
    expect(prompt).toContain('这两页的论证如何递进？');
    expect(prompt).not.toContain('关联划词选段');
    expect(prompt).toContain('=== 第 41 页 ===');
    expect(prompt).toContain('=== 第 42 页 ===');
  });
});
