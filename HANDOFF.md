# Hackathon handoff — v1.4.0

## Included / excluded

This is a clean snapshot of the current prototype, with Audi-inspired neutral styling, a minimal tap-to-talk home, a left knowledge panel, a real map and Android immersive mode. It is not the old Volkswagen v1.3.0 evaluator release.

The repository and source ZIP include source, the dependency lockfile, tests, an Expo config plugin and build scripts. They exclude private repository history, `.env` files, real API keys, local Android SDKs, node_modules, build caches, signing keystores, local logs and personal Mac launchers. The public APK separately includes the shared demo-access token required for its hosted backend; assume that token can be extracted.

## Before presenting

1. Install the exact APK on your actual target Android device. Confirm launch and map loading.
2. Allow microphone access. Tap to talk, wait for the ready state, speak a question and confirm the transcript matches. Also test a second consecutive question and returning from the background.
3. Listen to the spoken answer. Test Stop and Replay. A callback alone does not prove audible output.
4. Try a company/market question, weather with an explicit city, a comparison and a text-only explanation. Inspect card readability and scrolling. A card is only expected when Tako returns one.
5. Test denied microphone permission, offline/reconnection, an empty question and a long answer. Keep typed input available as a fallback.
6. Repeat on the venue network. Do not rely solely on a Mac emulator rehearsal.

## Automated checks

`npm run verify` runs TypeScript and 19 code/relay regression tests. It does not use a real microphone and the relay tests mock upstream responses.

With one device connected and the app installed, `node scripts/device-query-pack.mjs` submits eight questions through the keyboard UI, including cold starts. It writes artifacts and requires answer completion, card readiness when a card is returned, and the TTS-finished callback. A single-query check can be run as:

```sh
AUDI_TEST_QUERY='Weather in San Francisco today' node scripts/device-query-pack.mjs
```

`scripts/demo-readiness.sh` is a macOS/zsh-oriented device rehearsal helper. It requires the SDK, Node, curl and ripgrep. It intentionally submits a real query and can interrupt your current app interaction. The device scripts default to the original Android package ID; adapt them if your team changes it. The shell readiness helper also contains the original demo hostname for its DNS check; update it for your own relay.

`node scripts/query-regression.mjs` runs five real relay queries; add `--full` for twenty. Set `VW_DEMO_RELAY_URL` and `DEMO_ACCESS_TOKEN` in the process environment to test your own relay. This incurs usage on the configured Tako account. Reports mark a non-empty answer as a transport pass, not a guarantee of correctness.

## Known risks / no hardware signoff

The current visual build was checked in an Android emulator, and its 19 automated tests passed. No physical Android-device validation is claimed for this release. Mac emulator microphone forwarding and display stalls have occurred during development; a full emulator restart may be required. The source includes a keyboard path and diagnostic panel but cannot guarantee the host computer's microphone or graphics driver.

Tap the settings icon or long-press AUDI to open diagnostics. A relay readiness check makes a real query. Test microphone returns to the voice UI. In local direct mode only, Data access allows an administrator to configure a key; the prebuilt shared-relay APK does not require this.

## Independent ownership

Import the source ZIP into your organization's repository, or clone this public repository. Bring your own Tako account/key, deploy your own relay, configure the mobile URL/demo token and build. No private-repository access or original Mac Keychain entry is needed. `build:demo` supports explicit environment variables; its Keychain lookup is only an optional convenience for the original development Mac.

For a hackathon-wide deployment, review budget limits, request quotas, logging/privacy, authentication and expiration of shared access. Production vehicle work additionally requires appropriate safety, distraction, accessibility, security, licensing and release-signing reviews.
