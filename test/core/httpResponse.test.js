/**
 * Tests for HTTP Response Body Helpers
 * @module test/core/httpResponse
 */

import {
  RESPONSE_EXCERPT_MAX_LENGTH,
  excerptResponseBody,
  extractResponseErrorDetail,
  parseJsonBody,
  unwrapGraphQLData,
} from '../../src/core/httpResponse';

const SOURCE = 'Example API Error: GetThings';

describe('httpResponse', () => {
  describe('excerptResponseBody', () => {
    it('returns a short body unchanged', () => {
      expect(excerptResponseBody('<html>Bad Gateway</html>')).toBe('<html>Bad Gateway</html>');
    });

    it('caps a long body at the excerpt limit', () => {
      expect(excerptResponseBody('x'.repeat(50000))).toHaveLength(RESPONSE_EXCERPT_MAX_LENGTH);
    });

    it.each([undefined, null, ''])('returns an empty string for %p', (body) => {
      expect(excerptResponseBody(body)).toBe('');
    });
  });

  describe('extractResponseErrorDetail', () => {
    it('serializes the whole GraphQL errors array, keeping locations', () => {
      const body = JSON.stringify({
        errors: [{ message: 'generic', locations: [{ line: 1, column: 49 }] }],
      });

      expect(extractResponseErrorDetail(body))
        .toBe('[{"message":"generic","locations":[{"line":1,"column":49}]}]');
    });

    it('falls back to a bounded excerpt when the body is not JSON', () => {
      expect(extractResponseErrorDetail('<html>Bad Gateway</html>')).toBe('<html>Bad Gateway</html>');
      expect(extractResponseErrorDetail(`<html>${'x'.repeat(5000)}`)).toHaveLength(RESPONSE_EXCERPT_MAX_LENGTH);
    });

    it('falls back to the raw body when JSON carries no errors', () => {
      expect(extractResponseErrorDetail('{"message":"rate limited"}')).toBe('{"message":"rate limited"}');
    });

    it.each([undefined, null, ''])('returns an empty string for %p', (body) => {
      expect(extractResponseErrorDetail(body)).toBe('');
    });
  });

  describe('parseJsonBody', () => {
    it('returns the parsed body', () => {
      expect(parseJsonBody('{"accounts":[{"id":"1"}]}', SOURCE)).toEqual({ accounts: [{ id: '1' }] });
    });

    it('returns valid non-object JSON as-is', () => {
      expect(parseJsonBody('null', SOURCE)).toBeNull();
      expect(parseJsonBody('[1,2]', SOURCE)).toEqual([1, 2]);
    });

    it('names the source and quotes the body when the body is not JSON', () => {
      expect(() => parseJsonBody('<html>Request blocked by CloudFront</html>', SOURCE))
        .toThrow(new RegExp(`^${SOURCE} returned a success status with a body that is not JSON \\(.+\\) — <html>Request blocked by CloudFront</html>$`));
    });

    it('keeps the parse error as the cause', () => {
      let thrown;
      try {
        parseJsonBody('{"truncated":', SOURCE);
      } catch (error) {
        thrown = error;
      }

      expect(thrown.cause).toBeInstanceOf(SyntaxError);
    });

    it('truncates a huge body rather than pasting a whole error page into the message', () => {
      expect(() => parseJsonBody(`<html>${'x'.repeat(50000)}</html>`, SOURCE))
        .toThrow(expect.objectContaining({
          message: expect.stringMatching(/^.{1,1000}$/s),
        }));
    });

    it.each([undefined, null, ''])('throws without a dangling separator for an empty body (%p)', (body) => {
      expect(() => parseJsonBody(body, SOURCE)).toThrow(/not JSON \(.+\)$/);
    });
  });

  describe('unwrapGraphQLData', () => {
    it('returns the data member', () => {
      expect(unwrapGraphQLData({ data: { user: { id: 'u1' } } }, SOURCE)).toEqual({ user: { id: 'u1' } });
    });

    it('serializes the whole errors array into the message', () => {
      const body = { errors: [{ message: 'field not accepted', path: ['user', 'accounts'] }] };

      expect(() => unwrapGraphQLData(body, SOURCE))
        .toThrow(`${SOURCE} returned GraphQL errors: [{"message":"field not accepted","path":["user","accounts"]}]`);
    });

    it('throws on errors even when partial data is present', () => {
      expect(() => unwrapGraphQLData({ data: { user: null }, errors: [{ message: 'denied' }] }, SOURCE))
        .toThrow('denied');
    });

    it('treats a non-array errors value as an error', () => {
      expect(() => unwrapGraphQLData({ errors: { message: 'unexpected shape' } }, SOURCE))
        .toThrow('unexpected shape');
    });

    it('ignores an empty errors array', () => {
      expect(unwrapGraphQLData({ data: { ok: true }, errors: [] }, SOURCE)).toEqual({ ok: true });
    });

    it.each([null, undefined, {}, []])('returns undefined when there is no data (%p)', (body) => {
      expect(unwrapGraphQLData(body, SOURCE)).toBeUndefined();
    });
  });
});
