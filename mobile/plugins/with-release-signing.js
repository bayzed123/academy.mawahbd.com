// @ts-check
/**
 * Signs the release build (the AAB for Google Play and the APK for phones) with the owner's upload key.
 *
 * The key never lives in this repository. The Android build workflow (.github/workflows/android.yml) writes it to a temporary file from the
 * repository secrets and passes four environment variables to Gradle:
 *   MAWAH_UPLOAD_STORE_FILE, MAWAH_UPLOAD_STORE_PASSWORD, MAWAH_UPLOAD_KEY_ALIAS, MAWAH_UPLOAD_KEY_PASSWORD
 * Without them (a build on a developer's computer) the release build falls back to the debug key, which Google Play refuses; the workflow
 * checks the signature of what it built, so a debug-signed build can never pass as a Play Store build.
 *
 * It also gives Gradle more memory: a release build for four processor types needs more than the 2 GB of the template.
 */
const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

const MARK = "MAWAH_UPLOAD_STORE_FILE";

const RELEASE_SIGNING = `
        release {
            // the owner's upload key, from the workflow (never from the repository)
            def uploadStore = System.getenv("${MARK}")
            if (uploadStore) {
                storeFile file(uploadStore)
                storePassword System.getenv("MAWAH_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("MAWAH_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("MAWAH_UPLOAD_KEY_PASSWORD")
            }
        }`;

/** @param {string} gradle */
function addReleaseSigning(gradle) {
  if (gradle.includes(MARK)) return gradle;
  // 1. a "release" signing config next to the template's "debug" one
  const signingConfigs = /signingConfigs\s*\{/;
  if (!signingConfigs.test(gradle)) throw new Error("with-release-signing: no signingConfigs block in android/app/build.gradle (the Expo template changed)");
  let out = gradle.replace(signingConfigs, (m) => m + RELEASE_SIGNING);
  // 2. the release build type uses it when the key is there (the template points it at the debug key)
  const releaseUsesDebug = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseUsesDebug.test(out)) throw new Error("with-release-signing: the release build type does not use signingConfigs.debug (the Expo template changed)");
  out = out.replace(releaseUsesDebug, `$1signingConfig System.getenv("${MARK}") ? signingConfigs.release : signingConfigs.debug`);
  return out;
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withReleaseSigning = (config) => {
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") throw new Error("with-release-signing: android/app/build.gradle is not Groovy");
    cfg.modResults.contents = addReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
  config = withGradleProperties(config, (cfg) => {
    const jvm = cfg.modResults.find((p) => p.type === "property" && p.key === "org.gradle.jvmargs");
    const value = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";
    if (jvm && jvm.type === "property") jvm.value = value;
    else cfg.modResults.push({ type: "property", key: "org.gradle.jvmargs", value });
    return cfg;
  });
  return config;
};

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
