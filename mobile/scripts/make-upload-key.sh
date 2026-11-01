#!/usr/bin/env bash
# Makes the app's Google Play UPLOAD KEY on YOUR computer (Mac or Linux) and prints what GitHub needs.
# Run it in a folder OUTSIDE the project:  bash make-upload-key.sh
# It never sends anything anywhere. Keep mawah-upload.jks and the password safe (two offline copies); never put them in the repository or a chat.
set -euo pipefail
command -v keytool >/dev/null || { echo "keytool was not found. Install Java 17 (https://adoptium.net), then run this again."; exit 1; }
[ -e mawah-upload.jks ] && { echo "mawah-upload.jks already exists here. It is your key: do not make a second one."; exit 1; }
alias=mawah-upload
echo "Choose a strong password (at least 12 characters). Type it when keytool asks, twice."
keytool -genkeypair -v -storetype PKCS12 -keystore mawah-upload.jks -alias "$alias" -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=MAWAH Academy, O=MAWAH Academy, C=BD"
base64 < mawah-upload.jks | tr -d '\n' > mawah-upload.base64.txt
echo
echo "Done. Now open GitHub: the repository -> Settings -> Secrets and variables -> Actions -> New repository secret:"
echo "  ANDROID_KEYSTORE_BASE64   = everything inside mawah-upload.base64.txt (one long line)"
echo "  ANDROID_KEYSTORE_PASSWORD = the password you just typed"
echo "  ANDROID_KEY_ALIAS         = $alias"
echo "  ANDROID_KEY_PASSWORD      = the same password"
echo
echo "Then delete mawah-upload.base64.txt, and copy mawah-upload.jks and the password to two safe places."
