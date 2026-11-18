// Adds microphone permission declarations to the generated native projects.
// Runs after `npx cap add android|ios`. Idempotent.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest)) {
  let xml = readFileSync(manifest, 'utf8');
  for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
    if (!xml.includes(perm)) xml = xml.replace(/<\/manifest>\s*$/, `    <uses-permission android:name="${perm}" />\n</manifest>\n`);
  }
  // Do not let Android auto-backup copy the app database to the cloud; Saywell manages its own encrypted backups.
  xml = xml.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
  writeFileSync(manifest, xml);
  console.log('Android: RECORD_AUDIO permission added, allowBackup=false');

  // WebView must grant getUserMedia once the OS permission is given.
  const act = 'android/app/src/main/java/app/saywell/mobile/MainActivity.java';
  if (existsSync(act)) console.log('Android: MainActivity found (Capacitor BridgeWebChromeClient handles mic permission prompts).');
}

const plist = 'ios/App/App/Info.plist';
if (existsSync(plist)) {
  let p = readFileSync(plist, 'utf8');
  if (!p.includes('NSMicrophoneUsageDescription')) {
    p = p.replace(/<dict>/, '<dict>\n\t<key>NSMicrophoneUsageDescription</key>\n\t<string>Saywell uses the microphone only while you dictate. Recordings are encrypted on your device.</string>');
    writeFileSync(plist, p);
    console.log('iOS: NSMicrophoneUsageDescription added');
  }
}
