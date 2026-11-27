const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(reply, native = false) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/api.ts', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(source, {
    exports, __DEV__: false, fetch: reply, Response, AbortController, setTimeout, clearTimeout,
    require: name => name === 'react-native' ? {Platform: {OS: native ? 'android' : 'web'}}
      : name === './config' ? {API_ORIGIN: 'https://api.example.test'}
      : name === 'expo-file-system/legacy' ? {
        getInfoAsync: async () => ({exists: true, size: 12}), FileSystemUploadType: {BINARY_CONTENT: 0},
        createUploadTask: () => ({uploadAsync: reply, cancelAsync: async () => {}}),
      } : {},
  });
  return exports;
}

test('malformed successful responses fail retryably without discarding the account', async () => {
  for (const body of ['<html>upstream unavailable</html>', '', 'null', 'true', '42', '"ok"']) {
    const m = harness(async () => new Response(body));
    await m.acceptSession({token: 'synthetic', user: {id: 'alice'}});
    await assert.rejects(m.api.getAs('alice', '/chats'), error => error.status === 502 && /try again/i.test(error.message));
    assert.equal(m.getSessionUserId(), 'alice');
    assert.equal(await m.getToken(), 'synthetic');
  }
});

test('JSON lists, objects and an explicit no-content acknowledgement remain supported', async () => {
  for (const [body, status, expected] of [['[]', 200, []], ['{"ok":true}', 200, {ok: true}], [null, 204, {}]]) {
    const m = harness(async () => new Response(body, {status}));
    await m.acceptSession({token: 'synthetic', user: {id: 'alice'}});
    assert.equal(JSON.stringify(await m.api.get('/chats')), JSON.stringify(expected));
  }
});

test('malformed error bodies retain HTTP status and controlled retry guidance', async () => {
  for (const body of ['null', '<html>private infrastructure detail</html>', '{"detail":[null,{},42]}']) {
    const m = harness(async () => new Response(body, {status: 503}));
    await m.acceptSession({token: 'synthetic', user: {id: 'alice'}});
    await assert.rejects(m.api.get('/chats'), error => error.status === 503 && /try again/i.test(error.message) && !error.message.includes('infrastructure'));
  }
});

test('validation errors ignore malformed entries without masking the real message', async () => {
  const m = harness(async () => new Response(JSON.stringify({detail: [null, 5, {msg: 4}, {msg: 'Choose a valid name.'}]}), {status: 422}));
  await m.acceptSession({token: 'synthetic', user: {id: 'alice'}});
  await assert.rejects(m.api.get('/chats'), error => error.status === 422 && error.message === 'Choose a valid name.');
});

test('an unreadable unauthorized refresh still expires the session once', async () => {
  const m = harness(async () => new Response('null', {status: 401}));
  await m.acceptSession({token: 'synthetic', user: {id: 'alice'}});
  let expired = 0;
  m.onSessionExpired(() => expired++);
  assert.equal(await m.refreshSession(), null);
  assert.equal(m.getSessionUserId(), null);
  assert.equal(expired, 1);
});

test('native uploads use the same malformed-body and status checks', async () => {
  for (const [status, body, expected] of [[200, 'null', 502], [200, '<html>unavailable</html>', 502], [403, 'null', 403], [302, '{}', 302]]) {
    const m = harness(async () => ({status, body}), true);
    await m.acceptSession({token: 'synthetic', user: {id: 'alice'}});
    await assert.rejects(m.uploadAttachment('synthetic-chat', 'file:///fixture.wav', 'fixture.wav', 'alice'), error => error.status === expected);
    assert.equal(m.getSessionUserId(), 'alice');
  }
});
