import { isHostnameMatch } from '../../src/core/domainMatch';

describe('isHostnameMatch', () => {
  it('matches exact domain', () => {
    expect(isHostnameMatch('questrade.com', 'questrade.com')).toBe(true);
    expect(isHostnameMatch('app.monarch.com', 'app.monarch.com')).toBe(true);
  });

  it('matches subdomains', () => {
    expect(isHostnameMatch('my.questrade.com', 'questrade.com')).toBe(true);
    expect(isHostnameMatch('sub.my.questrade.com', 'questrade.com')).toBe(true);
    expect(isHostnameMatch('app.monarch.com', 'monarch.com')).toBe(true);
  });

  it('is case-insensitive and handles trailing dots', () => {
    expect(isHostnameMatch('MY.QUESTRADE.COM', 'Questrade.Com')).toBe(true);
    expect(isHostnameMatch('my.questrade.com.', 'questrade.com')).toBe(true);
    expect(isHostnameMatch('my.questrade.com', '.questrade.com.')).toBe(true);
  });

  it('rejects lookalike prefix domains (missing dot boundary)', () => {
    expect(isHostnameMatch('evilquestrade.com', 'questrade.com')).toBe(false);
    expect(isHostnameMatch('not-monarch.com', 'monarch.com')).toBe(false);
    expect(isHostnameMatch('mywealthsimple.com', 'wealthsimple.com')).toBe(false);
  });

  it('rejects attacker domains containing the target domain as a prefix/substring', () => {
    expect(isHostnameMatch('questrade.com.evil.com', 'questrade.com')).toBe(false);
    expect(isHostnameMatch('app.monarch.com.attacker.ca', 'monarch.com')).toBe(false);
    expect(isHostnameMatch('rogersbank.com.phishing.org', 'rogersbank.com')).toBe(false);
  });

  it('rejects empty, whitespace, or nullish inputs', () => {
    expect(isHostnameMatch('', 'questrade.com')).toBe(false);
    expect(isHostnameMatch('questrade.com', '')).toBe(false);
    expect(isHostnameMatch('   ', 'questrade.com')).toBe(false);
    expect(isHostnameMatch('questrade.com', '.')).toBe(false);
    expect(isHostnameMatch(null, 'questrade.com')).toBe(false);
    expect(isHostnameMatch(undefined, 'questrade.com')).toBe(false);
    expect(isHostnameMatch('questrade.com', null)).toBe(false);
  });
});
