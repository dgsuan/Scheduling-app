// Execute the real Edge handler with mocked auth, rate limiting and provider IO.
// No API keys, network, hosted database or AI usage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
let handler, authorized = true, configured = true, limited = false, payload, calls = 0;
const source = fs.readFileSync(new URL('../supabase/functions/habit-coach/index.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
vm.runInNewContext(compiled, {
  Response, Request, TextDecoder, AbortSignal,
  Deno: { serve: fn => { handler = fn; }, env: { get: name => name === 'OPENAI_API_KEY' || name === 'HABIT_COACH_MODEL' ? configured ? 'test-only' : undefined : 'test-only' } },
  serviceKey: () => 'test-only',
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: authorized ? { id: 'test-user' } : null }, error: null }) }, rpc: async () => ({ error: limited ? new Error('limit') : null }) }),
  fetch: async (_url, options) => { calls++; payload = JSON.parse(options.body); return Response.json({ output: [{ content: [{ type: 'output_text', text: 'Try a smaller step tomorrow.' }] }] }); },
});
const request = body => handler(new Request('http://test/habit-coach', { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const valid = { consent: true, summary: [{ opportunities: 7, completed: 4, title: 'SECRET', note: 'PRIVATE', mood: 'low' }] };
assert.equal((await handler(new Request('http://test/habit-coach', { method: 'OPTIONS' }))).status, 200);
assert.equal((await handler(new Request('http://test/habit-coach'))).status, 405);
authorized = false; assert.equal((await request(valid)).status, 401); authorized = true;
configured = false; assert.equal((await request(valid)).status, 503); configured = true;
assert.equal((await request({ ...valid, consent: false })).status, 400);
assert.equal((await request({ consent: true, summary: [{ opportunities: 1, completed: 2 }] })).status, 400);
assert.equal((await request({ consent: true, summary: Array(51).fill({ opportunities: 1, completed: 1 }) })).status, 400);
assert.equal((await request({ ...valid, extra: 'x'.repeat(9000) })).status, 413);
limited = true; assert.equal((await request(valid)).status, 429); limited = false;
assert.equal(calls, 0, 'rejected requests never call the provider');
const response = await request(valid);
assert.equal(response.status, 200);
assert.equal((await response.json()).answer, 'Try a smaller step tomorrow.');
assert.equal(calls, 1);
assert.equal(payload.store, false);
assert.ok(!JSON.stringify(payload).includes('SECRET') && !JSON.stringify(payload).includes('PRIVATE'));
assert.deepEqual(JSON.parse(payload.input), { days: 30, summary: [{ habit: 1, opportunities: 7, completed: 4 }] });
console.log('PASS coach auth, opt-in consent, body limits, rate-limit handling, provider payload privacy and response parsing');
