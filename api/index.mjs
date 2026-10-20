import { handleApi } from '../api.mjs';

// Keep the same Web Request/Response handler for local and hosted execution.
// The rewrite carries the original endpoint when Vercel exposes its destination.
export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/index') {
      const endpoints = url.searchParams.getAll('__aether_endpoint');
      url.pathname = endpoints.length === 1 ? `/api/${endpoints[0]}` : '/api/not-found';
      url.searchParams.delete('__aether_endpoint');
      return handleApi(new Request(url, request));
    }
    return handleApi(request);
  },
};
