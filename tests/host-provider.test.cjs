'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHostProvider, MAX_QUERY_CHARS, MAX_RESPONSE_BYTES } = require('../src/host-provider');

const SEARCH_SOURCE = '08be0c3f7e0534e3469c09477b24b1f616760714';
const SEARCH_ORIGIN = 'https://search.test.invalid';

function response(status, body, contentType = 'application/json') {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

test('host provider exposes one pinned, read-only search capability', () => {
  const provider = createHostProvider({
    version: SEARCH_SOURCE,
    searchOrigin: SEARCH_ORIGIN,
    fetchImpl: async () => response(200, '{"results":[]}'),
  });
  assert.equal(provider.id, 'trained-assist-search');
  assert.equal(provider.version, SEARCH_SOURCE);
  assert.deepEqual(provider.tools.map(({ name }) => name), ['search_serp_free']);
  assert.equal(provider.tools[0].inputSchema.required.includes('query'), true);
});

test('host provider runs the domain search handler with a fixture fetch and fixed egress', async () => {
  const seen = [];
  const provider = createHostProvider({
    version: SEARCH_SOURCE,
    searchOrigin: SEARCH_ORIGIN,
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), redirect: init.redirect, signal: init.signal });
      return response(200, JSON.stringify({ results: [{ url: 'https://result.example/item', title: 'Fixture', content: 'Synthetic result' }] }));
    },
  });
  const out = await provider.tools[0].handler({ query: 'synthetic MCP adapter smoke', num: 1 }, { signal: new AbortController().signal });
  assert.equal(out.engine, 'searxng');
  assert.equal(out.source, SEARCH_ORIGIN);
  assert.deepEqual(out.results, [{ title: 'Fixture', url: 'https://result.example/item', snippet: 'Synthetic result', position: 1 }]);
  assert.equal(seen.length, 1);
  assert.equal(new URL(seen[0].url).origin, SEARCH_ORIGIN);
  assert.equal(seen[0].redirect, 'manual');
});

test('caller text cannot choose an outbound origin and query size is bounded', async () => {
  let calls = 0;
  const provider = createHostProvider({
    version: SEARCH_SOURCE,
    searchOrigin: SEARCH_ORIGIN,
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(new URL(url).origin, SEARCH_ORIGIN);
      return response(200, JSON.stringify({ results: [{ url: 'https://result.example/item', title: 'Fixture', content: 'ok' }] }));
    },
  });
  const tooLong = await provider.tools[0].handler({ query: 'x'.repeat(MAX_QUERY_CHARS + 1) }, {});
  assert.equal(tooLong.error, 'bad_request');
  assert.equal(calls, 0);
  const normal = await provider.tools[0].handler({ query: 'https://attacker.example/path?query=still-plain-text' }, {});
  assert.equal(normal.error, undefined);
  assert.equal(calls, 1);
});

test('provider refuses redirects before following a location to another origin', async () => {
  const redirecting = createHostProvider({
    version: SEARCH_SOURCE,
    searchOrigin: SEARCH_ORIGIN,
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'https://unexpected.example/' } });
    },
  });
  const redirected = await redirecting.tools[0].handler({ query: 'synthetic' }, {});
  assert.equal(redirected.error, 'search_failed');
  assert.match(redirected.message, /redirect refused/);

});

test('provider bounds upstream response bytes and carries run cancellation into fetch', async () => {
  const oversized = createHostProvider({
    version: SEARCH_SOURCE,
    searchOrigin: SEARCH_ORIGIN,
    fetchImpl: async () => response(200, 'x'.repeat(MAX_RESPONSE_BYTES + 1), 'application/json'),
  });
  const tooLarge = await oversized.tools[0].handler({ query: 'synthetic' }, {});
  assert.equal(tooLarge.error, 'search_failed');
  assert.match(tooLarge.message, /exceeded the size limit/);

  const controller = new AbortController();
  let fetchSignal;
  const abortable = createHostProvider({
    version: SEARCH_SOURCE,
    searchOrigin: SEARCH_ORIGIN,
    fetchImpl: async (_url, init) => {
      fetchSignal = init.signal;
      return new Promise((_, reject) => {
        if (init.signal.aborted) return reject(new Error('aborted'));
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });
  const pending = abortable.tools[0].handler({ query: 'synthetic' }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const aborted = await pending;
  assert.equal(fetchSignal.aborted, true);
  assert.equal(aborted.error, 'search_failed');
});

test('provider requires an immutable commit pin and a plain HTTPS origin', () => {
  assert.throws(() => createHostProvider({ searchOrigin: SEARCH_ORIGIN }), /pinned 40-character source commit/);
  assert.throws(() => createHostProvider({ version: SEARCH_SOURCE, searchOrigin: 'http://search.test.invalid' }), /HTTPS origin/);
  assert.throws(() => createHostProvider({ version: SEARCH_SOURCE, searchOrigin: 'https://user:pass@search.test.invalid' }), /without credentials/);
});
