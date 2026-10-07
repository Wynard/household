import { describe, expect, it } from 'vitest';
import { money, parseDecimal, qty } from './format';

describe('format', () => {
  it('formats money the Romanian way', () => {
    expect(money(1500)).toBe('1 500,00 lei');
    expect(money(-12.5)).toBe('−12,50 lei');
    expect(money(3, { sign: true })).toBe('+3,00 lei');
  });

  it('parses both decimal separators and thousands separators', () => {
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal('2.5')).toBe(2.5);
    expect(parseDecimal('1 234,50')).toBe(1234.5);
    expect(parseDecimal('1 234,50 lei')).toBe(1234.5);
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    expect(parseDecimal('1,234.5')).toBe(1234.5);
    expect(parseDecimal('')).toBeNaN();
    expect(parseDecimal('abc')).toBeNaN();
  });

  it('humanises quantities', () => {
    expect(qty(1500, 'g')).toBe('1,5 kg');
    expect(qty(250, 'g')).toBe('250 g');
    expect(qty(6, 'pcs')).toBe('6 pcs');
  });
});
