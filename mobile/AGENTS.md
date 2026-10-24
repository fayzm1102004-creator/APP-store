# Egyptian Marketplace Mobile Application

## Project Paths
- **Repository Root**: `D:\Backend\marketplace`
- **Backend Project Folder**: `D:\Backend\marketplace\backend`
- **Mobile Project Folder**: `D:\Backend\marketplace\mobile`

## Global Rules
1. Work only in the single unified project folders (`D:\Backend\marketplace\backend` and `D:\Backend\marketplace\mobile`).
2. NEVER run database commands (no `dotnet ef database update/drop`, `psql`, `pg_dump`). Generate migrations only, show the SQL for the user to apply.
3. Tests run only against the database named in the env var `TEST_DB` (or InMemory).
4. Do NOT deploy anything; the hosting platform is paused. Local work only.
5. Never print or commit secrets. Secrets come from environment variables.
6. Execute ONE stage at a time. After each stage report: files changed, endpoints added, raw test output, and what could NOT be verified. Then STOP and wait for confirmation.

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Biometric Security Architecture & Token Binding
- **UI-Level Lock**: The biometric gate (`isLocked` / `UnlockScreen`) operates as an application UI-level lock.
- **Token Storage**: The refresh token is stored encrypted via `expo-secure-store` (`Keychain` on iOS, `KeyStore/EncryptedSharedPreferences` on Android) without hardware key-binding (`requireAuthentication: false`).
- **No Hardware Biometric Key Binding**: The refresh token is NOT cryptographically bound to hardware biometric sensor keys. Enrolling or removing fingerprints at the OS level does not automatically invalidate or wipe the stored refresh token in SecureStore. The app guards UI visibility and requires biometric authentication before presenting the app or calling `/auth/refresh` on cold starts.
