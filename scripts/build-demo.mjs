import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relay = (process.env.EXPO_PUBLIC_TAKO_PROXY_URL || "https://vw-assistant-demo.vercel.app").replace(/\/$/, "");
if (!relay.startsWith("https://") || /^(localhost|127\.|10\.|192\.168\.)/.test(new URL(relay).hostname)) throw new Error("A hosted HTTPS relay is required for demo builds.");
let token = process.env.EXPO_PUBLIC_DEMO_ACCESS_TOKEN || "";
if (!token && process.platform === "darwin") {
  token = execFileSync("security", ["find-generic-password", "-s", "com.tako.vw-demo.access-token", "-w"], {encoding:"utf8"}).trim();
}
if (!token) throw new Error("Demo access token missing. Configure EXPO_PUBLIC_DEMO_ACCESS_TOKEN.");
console.log("Checking hosted answer service before building…");
const response = await fetch(`${relay}/ready`, {method:"POST",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(55000)});
const ready = await response.json();
if (!response.ok || !ready.ok || !ready.answer_present) throw new Error(`Hosted answer check failed (${response.status}). Build stopped.`);
console.log("Hosted Tako answer confirmed. Building standalone APK.");
const java17 = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
const env = {...process.env, NODE_ENV:"production", EXPO_PUBLIC_TAKO_PROXY_URL:relay, EXPO_PUBLIC_DEMO_ACCESS_TOKEN:token};
if (process.platform === "darwin") {
  if(existsSync(java17)) env.JAVA_HOME = java17;
  env.ANDROID_HOME ||= path.join(process.env.HOME, "Library/Android/sdk");
}
// Force rebundling: Gradle does not track changes to public environment variables.
const bundle = spawnSync("./gradlew", [":app:createBundleReleaseJsAndAssets", "--rerun", "--max-workers=2", "--console=plain"], {cwd:path.join(root,"android"),env,stdio:"inherit"});
if(bundle.status !== 0) process.exit(bundle.status || 1);
const build = spawnSync("./gradlew", ["assembleRelease", "--max-workers=2", "--console=plain"], {cwd:path.join(root,"android"),env,stdio:"inherit"});
process.exit(build.status || 0);
