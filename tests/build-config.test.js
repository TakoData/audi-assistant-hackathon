const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname,"../babel.config.js"),"utf8");
function bundleConfig(env, production=true) {
  const sandbox = {module:{exports:{}},process:{env},URL};
  vm.runInNewContext(source,sandbox);
  return sandbox.module.exports({env:()=>production});
}
test("release rejects local emulator relay instead of shipping a broken APK", () => {
  for(const url of ["http://10.0.2.2:8787","https://localhost:8787","https://192.168.1.1",""]) {
    assert.throws(()=>bundleConfig({EXPO_PUBLIC_TAKO_PROXY_URL:url,EXPO_PUBLIC_DEMO_ACCESS_TOKEN:"demo-token"}), /hosted HTTPS/);
  }
});
test("release requires demo authorization and accepts configured hosted relay", () => {
  assert.throws(()=>bundleConfig({EXPO_PUBLIC_TAKO_PROXY_URL:"https://vw-assistant-demo.vercel.app"}),/access token/);
  assert.doesNotThrow(()=>bundleConfig({EXPO_PUBLIC_TAKO_PROXY_URL:"https://vw-assistant-demo.vercel.app",EXPO_PUBLIC_DEMO_ACCESS_TOKEN:"test-token"}));
});
test("development can still use a local relay", () => {
  assert.doesNotThrow(()=>bundleConfig({EXPO_PUBLIC_TAKO_PROXY_URL:"http://10.0.2.2:8787"},false));
});
