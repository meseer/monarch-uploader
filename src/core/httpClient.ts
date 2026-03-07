/**
 * HTTP Client Adapter
 *
 * Abstracts HTTP request operations behind a common interface.
 * The default implementation wraps Tampermonkey's GM_xmlhttpRequest.
 * Alternative implementations can be created for other environments
 * (e.g., native fetch, WebView bridges, React Native HTTP).
 *
 * Integration modules use this interface instead of calling GM_xmlhttpRequest
 * directly, making them environment-agnostic.
 *
 * @module core/httpClient
 */

// ============================================================
// Canonical interface definitions
// ============================================================

export interface HttpRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string | object;
  responseType?: string;
}

export interface HttpResponse {
  status: number;
  responseText: string;
  responseHeaders: string;
  response: unknown;
}

export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}

// ============================================================
// Implementations
// ============================================================

/**
 * Create an HTTP client backed by Tampermonkey's GM_xmlhttpRequest.
 *
 * This is the default client used in the userscript environment.
 * GM_xmlhttpRequest enables cross-origin requests that are not possible
 * with the standard fetch API due to CORS restrictions.
 */
export function createGMHttpClient(): HttpClient {
  return {
    request({ method, url, headers, data, responseType }: HttpRequestOptions): Promise<HttpResponse> {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: (method || 'GET') as Tampermonkey.Request['method'],
          url,
          headers: headers || {},
          data: data as string | undefined,
          responseType: responseType as XMLHttpRequestResponseType | undefined,
          onload: (response) => resolve({
            status: response.status,
            responseText: response.responseText,
            responseHeaders: response.responseHeaders,
            response: response.response,
          }),
          onerror: (error) => reject(new Error(
            `HTTP request failed: ${method || 'GET'} ${url} - ${error.statusText || 'Network error'}`,
          )),
          ontimeout: () => reject(new Error(
            `HTTP request timed out: ${method || 'GET'} ${url}`,
          )),
        });
      });
    },
  };
}

/** Mock HTTP client with request recording for tests */
export interface MockHttpClient extends HttpClient {
  requests: HttpRequestOptions[];
  setHandler(newHandler: (request: HttpRequestOptions) => HttpResponse | Promise<HttpResponse>): void;
}

/**
 * Create a mock HTTP client for testing purposes.
 *
 * Records all requests and returns configurable responses.
 * Useful for unit tests that need to verify API calls without
 * making real network requests.
 */
export function createMockHttpClient(options: {
  handler?: (request: HttpRequestOptions) => HttpResponse | Promise<HttpResponse>;
} = {}): MockHttpClient {
  const requests: HttpRequestOptions[] = [];
  let handler = options.handler || ((): HttpResponse => ({
    status: 200,
    responseText: '{}',
    responseHeaders: '',
    response: {},
  }));

  return {
    async request(requestOptions: HttpRequestOptions): Promise<HttpResponse> {
      requests.push({ ...requestOptions });
      const response = await handler(requestOptions);
      return response;
    },

    /** Array of all recorded requests for test assertions */
    requests,

    /**
     * Set a custom handler for mock responses
     */
    setHandler(newHandler: (request: HttpRequestOptions) => HttpResponse | Promise<HttpResponse>): void {
      handler = newHandler;
    },
  };
}

export default {
  createGMHttpClient,
  createMockHttpClient,
};