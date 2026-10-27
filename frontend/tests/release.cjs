const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
test("service worker never intercepts private or cross-origin requests", () => {
  const listeners = {};
  vm.runInNewContext(fs.readFileSync("public/sw.js","utf8"), {
    self:{addEventListener:(name,fn)=>listeners[name]=fn,location:{origin:"https://kuku.example"}},
    URL, caches:{}, fetch:()=>{throw new Error("Unexpected fetch")}
  });
  for (const url of ["https://kuku.example/api/chats","https://api.example/api/chats","https://kuku.example/auth/me","https://kuku.example/file?token=secret"]) {
    let intercepted=false;
    listeners.fetch({request:{url,method:"GET",headers:new Headers(),mode:"cors"},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false,url);
  }
});
test("API proxy preserves cookies without caching", async () => {
  const handler = require("../api/[...path].js");
  const oldFetch=global.fetch, oldOrigin=process.env.BACKEND_URL;
  process.env.BACKEND_URL="https://api.example";
  let sent;
  global.fetch=async (url,options)=>{sent={url:String(url),options};return new Response('{"ok":true}',{headers:{"content-type":"application/json","set-cookie":"kuku_refresh=test; HttpOnly; Path=/api/auth"}});};
  const headers={};
  const res={setHeader:(k,v)=>headers[k]=v,end:(body)=>res.body=body,status:(code)=>{res.statusCode=code;return res;},json:(v)=>res.body=v};
  try {
    await handler({url:"/api/auth/refresh",method:"POST",headers:{cookie:"kuku_refresh=old",origin:"https://kuku.example","x-kuku-platform":"web"},body:{}},res);
    assert.equal(sent.url,"https://api.example/api/auth/refresh");
    assert.equal(sent.options.headers.cookie,"kuku_refresh=old");
    assert.equal(headers["Cache-Control"],"no-store");
    assert.match(headers["Set-Cookie"][0],/HttpOnly/);
    assert.equal(res.statusCode,200);
  } finally {global.fetch=oldFetch;if(oldOrigin===undefined)delete process.env.BACKEND_URL;else process.env.BACKEND_URL=oldOrigin;}
});
