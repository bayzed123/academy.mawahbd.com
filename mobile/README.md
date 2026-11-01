# MAWAH Academy — Android app

React Native + Expo (SDK 58), TypeScript, expo-router. It talks to the same API as the website (`https://mawahacademy.com`).

```bash
npm ci
npm run check        # TypeScript + the app's tests
npx expo start       # "a" opens an Android emulator; or scan the QR code with Expo Go
```

* Builds (signed AAB + APK) run in GitHub Actions: `.github/workflows/android.yml`.
* The owner's steps (upload key, secrets, Google Play): [docs/android-app.md](../docs/android-app.md).
* Never commit a keystore (`*.jks`) or its passwords: the repository is public. `.gitignore` refuses them.
