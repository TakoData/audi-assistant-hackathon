module.exports = function (api) {
  const production = api.env("production");
  if (production) {
    const relay = process.env.EXPO_PUBLIC_TAKO_PROXY_URL || "";
    const host = relay ? new URL(relay).hostname : "";
    if (!relay.startsWith("https://") || /^(localhost|127\.|10\.|192\.168\.|0\.)/.test(host)) {
      throw new Error("Release APK requires a hosted HTTPS relay. Run npm run build:demo; do not bundle the local development server.");
    }
    if (!process.env.EXPO_PUBLIC_DEMO_ACCESS_TOKEN?.trim()) {
      throw new Error("Release APK is missing its demo access token. Run npm run build:demo.");
    }
  }
  return { presets: ["babel-preset-expo"] };
};
