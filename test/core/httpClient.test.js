/**
 * Tests for HTTP Client Adapter
 * @module test/core/httpClient
 */

import { createMockHttpClient } from '../../src/core/httpClient';

describe('httpClient', () => {
  describe('createMockHttpClient', () => {
    let client;

    beforeEach(() => {
      client = createMockHttpClient();
    });

    describe('request', () => {
      it('should return default response when no handler is set', async () => {
        const response = await client.request({
          method: 'GET',
          url: 'https://api.example.com/data',
        });

        expect(response.status).toBe(200);
        expect(response.responseText).toBe('{}');
      });

      it('should record the request', async () => {
        await client.request({
          method: 'POST',
          url: 'https://api.example.com/data',
          headers: { 'Content-Type': 'application/json' },
          data: '{"key":"value"}',
        });

        expect(client.requests).toHaveLength(1);
        expect(client.requests[0].method).toBe('POST');
        expect(client.requests[0].url).toBe('https://api.example.com/data');
        expect(client.requests[0].headers).toEqual({ 'Content-Type': 'application/json' });
        expect(client.requests[0].data).toBe('{"key":"value"}');
      });

      it('should record multiple requests in order', async () => {
        await client.request({ method: 'GET', url: '/first' });
        await client.request({ method: 'POST', url: '/second' });
        await client.request({ method: 'DELETE', url: '/third' });

        expect(client.requests).toHaveLength(3);
        expect(client.requests[0].url).toBe('/first');
        expect(client.requests[1].url).toBe('/second');
        expect(client.requests[2].url).toBe('/third');
      });
    });

    describe('custom handler', () => {
      it('should use handler provided at construction', async () => {
        const customClient = createMockHttpClient({
          handler: (req) => ({
            status: 201,
            responseText: `Created: ${req.url}`,
            responseHeaders: '',
            response: null,
          }),
        });

        const response = await customClient.request({
          method: 'POST',
          url: '/resources',
        });

        expect(response.status).toBe(201);
        expect(response.responseText).toBe('Created: /resources');
      });

      it('should support async handlers', async () => {
        const customClient = createMockHttpClient({
          handler: async () => ({
            status: 200,
            responseText: '{"async":true}',
            responseHeaders: '',
            response: { async: true },
          }),
        });

        const response = await customClient.request({ method: 'GET', url: '/async' });
        expect(response.response).toEqual({ async: true });
      });
    });

    describe('setHandler', () => {
      it('should change handler after construction', async () => {
        // Default handler returns 200
        const firstResponse = await client.request({ method: 'GET', url: '/test' });
        expect(firstResponse.status).toBe(200);

        // Change handler to return 404
        client.setHandler(() => ({
          status: 404,
          responseText: 'Not found',
          responseHeaders: '',
          response: null,
        }));

        const secondResponse = await client.request({ method: 'GET', url: '/test' });
        expect(secondResponse.status).toBe(404);
        expect(secondResponse.responseText).toBe('Not found');
      });

      it('should allow handler to inspect request details', async () => {
        client.setHandler((req) => ({
          status: req.method === 'GET' ? 200 : 405,
          responseText: '',
          responseHeaders: '',
          response: null,
        }));

        const getResponse = await client.request({ method: 'GET', url: '/test' });
        expect(getResponse.status).toBe(200);

        const postResponse = await client.request({ method: 'POST', url: '/test' });
        expect(postResponse.status).toBe(405);
      });
    });

    describe('handler errors', () => {
      it('should propagate handler exceptions as rejections', async () => {
        client.setHandler(() => {
          throw new Error('Server exploded');
        });

        await expect(
          client.request({ method: 'GET', url: '/boom' }),
        ).rejects.toThrow('Server exploded');
      });
    });
  });
});