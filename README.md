# Audi-inspired Assistant — Android hackathon starter

A React Native / Expo Android prototype: tap to speak, get a Tako Answer, hear it read aloud, and see a glanceable knowledge card when Tako returns one. A portrait assistant panel sits beside an interactive OpenStreetMap. The home screen is deliberately minimal.

**[Download the Android APK and source ZIP](https://github.com/TakoData/audi-assistant-hackathon/releases/latest)** — public downloads, no GitHub invitation required.

## Just try it

1. On an Android device, download `Audi-Assistant-v1.4.0.apk` from Releases.
2. Open the file. If Android asks, allow that browser or file manager to install this app. You can turn that permission off afterward. A managed corporate device may need its administrator's approval.
3. Open **Audi Assistant Demo**, allow microphone access, and tap **Tap to talk**. Wait for **I'm listening** before speaking. The keyboard button also accepts questions.

The prebuilt APK uses Tako's hosted demo relay; no account or API-key entry is needed. Internet access is required. The demo service is shared, may be limited or withdrawn, and is not an availability guarantee. The app includes a revocable demo-access token, not the underlying Tako API key.

The APK declares Android 7 / API 24 or newer and contains arm64, ARMv7, x86 and x86_64 binaries. Use a landscape tablet or emulator for the intended layout. Voice needs a working Android speech-recognition service and TTS voice; these may not be installed on Android Automotive or custom Android images. A physical-device microphone/speaker check is still required.

## Give this to your coding agent

> Use this repository as our hackathon starting point. Read README.md and HANDOFF.md. Install the dependencies, run the tests, configure our own backend credentials, and build/run the React Native Android app. Preserve tap-to-talk, spoken answers, glanceable cards and the map. Test our target device's microphone, audio playback and card rendering before calling it ready. Never put the Tako API key in the app, in an EXPO_PUBLIC variable, or in Git. Ask us for missing credentials; do not substitute mock answers or another weather provider. Report any failed or untested scenarios clearly.

## Source and independent setup

Clone this public repository or download the source ZIP and import it into your own repository. No contact with the original developers is needed for source access. **Your own builds need your own Tako API key and relay configuration**; the source intentionally contains no live credentials.

Prerequisites: Node 22.13+ (or another version accepted by package.json), JDK 17, Android Studio / SDK, and an Android device with USB debugging or a running emulator. Set `ANDROID_HOME` to your SDK location. Android SDK license acceptance is required.

```sh
git clone https://github.com/TakoData/audi-assistant-hackathon.git
cd audi-assistant-hackathon
npm ci
npm run verify
```

### Local development

Copy `.env.example` to `.env` and edit it locally:

- `TAKO_API_KEY`: your real key, used only by the Node relay.
- `DEMO_ACCESS_TOKEN`: your randomly generated relay-access token.
- `EXPO_PUBLIC_DEMO_ACCESS_TOKEN`: the same relay-access token (not your Tako key).
- `EXPO_PUBLIC_TAKO_PROXY_URL`: `http://10.0.2.2:8787` for the Android emulator, or your development computer's LAN address for a physical device.
- Leave `DEMO_MODE=false`; do not enable fault injection in a shared deployment.

Start `npm run server` in one terminal. In another, run `npm run android` to generate/build the native project and launch the development app. This is a native development build, not an Expo Go app. Keep the development server running. If you change Expo public variables, restart/rebuild as needed. An HTTP local relay is for debug development only; shared release APKs require HTTPS.

### Independent, no-setup APK for your team

Deploy `server/index.js` on your own HTTPS hosting. `vercel.json` is included for Vercel. Set `TAKO_API_KEY` and `DEMO_ACCESS_TOKEN` on the server; set a suitable `DEMO_RATE_LIMIT_PER_HOUR`. The mobile build only needs the relay URL and matching demo token.

```sh
export EXPO_PUBLIC_TAKO_PROXY_URL=https://YOUR-RELAY.example.com
export EXPO_PUBLIC_DEMO_ACCESS_TOKEN=YOUR-DEMO-TOKEN
npx expo prebuild --platform android --no-install
npm run build:demo
```

Use your actual values, not the placeholders above. These are POSIX-shell examples; on Windows set equivalent environment variables in PowerShell and use the Android/Gradle tooling for that platform. The included `build:demo` script invokes `./gradlew` and is intended for macOS/Linux.

Output: `android/app/build/outputs/apk/release/app-release.apk`. The script performs a real relay readiness query before building. The GitHub Actions workflow provides the same build on Linux when you configure repository secrets `DEMO_RELAY_URL` and `DEMO_ACCESS_TOKEN`.

The current prototype uses a development signing key and package `com.tako.volkswagen.demo` for continuity with earlier demos. For your own distributions, choose your own package ID and signing key. Different signing keys cannot update an existing install of the same package; prefer a new package ID rather than uninstalling and losing app data.

## What's where

| File | Purpose |
| --- | --- |
| `App.tsx` | Voice recognition, request lifecycle, TTS, app shell, diagnostics |
| `src/components/AssistantPanel.tsx` | Minimal home, typed input, answer/card panel |
| `src/components/AudiIcon.tsx` | Consistent outline icon wrapper |
| `src/components/NavigationMap.tsx` | Interactive map and navigation-style overlays |
| `src/components/KnowledgeCard.tsx` | Glanceable card WebView with resize handshake |
| `src/tako.ts` | Client networking, normalization, retry/error handling |
| `server/index.js` | Server-side Tako relay and demo authorization |
| `plugins/withImmersiveDisplay.cjs` | Android full-screen behavior across Expo prebuilds |
| `tests/` | Automated regression tests |

## Limits, privacy and testing

- This is an Audi-inspired hackathon prototype, not official Audi/VW production software or a vehicle-control application. Some rail/climate icons are decorative. The map does not calculate routes.
- User question text is sent to the relay and Tako; Android speech services may process microphone audio remotely. Map tiles go to OpenStreetMap and cards load from Tako. Do not enter confidential or personal data unless your team has reviewed these services and their policies.
- A text-only answer is valid: Tako does not return a card for every request. Weather requests use Tako data and web sources, not an external weather fallback.
- The shared demo relay and map tiles depend on third-party availability. The in-memory rate limiter is not a durable spending cap or production abuse protection. Add authenticated users/devices, durable quotas, budget controls and your own mapping arrangement for wider use.
- Run `npm run verify`, then the device/query checks described in HANDOFF.md. A passing test suite or TTS completion callback does not establish real microphone input, audible playback, factual accuracy or production readiness.
- Retain third-party notices. Leaflet's license is reproduced in `LEAFLET-LICENSE.txt` and in the bundled `src/mapAssets.ts`. The icons are from Expo's Feather/Material icon families, not proprietary Audi assets. Third-party code and trademarks retain their respective terms; public source access is not a grant of trademark rights.
