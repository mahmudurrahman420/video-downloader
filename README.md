# Video Downloader (Android · Expo · TypeScript)

An Android app that looks up video links through official APIs and downloads **only** when the source permits it.

| Source | What the app does | How |
|---|---|---|
| Direct video links (`.mp4`, `.webm`, `.mkv`, extension-less CDN links, Dropbox shares) | Download with progress, pause/resume (HTTP ranges), retry; redirects re-followed on every attempt | HEAD + 1-byte range probe, magic-byte check of the result |
| HLS streams (`.m3u8`, or detected by content type) | Pick a resolution; segments downloaded and joined into one MPEG-TS/MP4 file; resumes per segment; transient segment errors retried | RFC 8216 playlist parsing. Live, AES-encrypted and DRM streams are refused with the reason |
| Web pages that publish a video | Offers the files the page openly declares (Open Graph, JSON-LD VideoObject, HTML5 `<video>/<source>`), in each available quality; embedded YouTube/Vimeo players hand off to those adapters | Page markup only; platform CDN links skipped |
| Internet Archive | All public video formats of an item | Metadata API |
| Wikimedia Commons | Original + official transcodes, license shown | MediaWiki API |
| YouTube, Vimeo | Real metadata + thumbnail, open in official app, owner export steps (YouTube Studio / Takeout, Vimeo) | oEmbed. These platforms serve video only to their own players |
| Facebook, Instagram, TikTok, X, Twitch, Netflix | Specific explanation per platform + its own save/export option + open in app | No authorized third-party download method exists |

No DRM or platform protection is bypassed, and a download is only marked **Completed** after the file is verified on disk (non-empty, correct byte count, HTTP 2xx) and saved to shared storage.

## Features

- Home: URL field, **Paste** button, validation, thumbnail/title/author/duration/license, download options with file sizes
- Downloads: Pending / Completed / Failed tabs, live progress bar, percentage, bytes, status, Pause / Resume / Cancel / Retry / Play / Delete
- History: every lookup and download outcome, searchable, tap to copy link
- Settings: Dark / Light / System theme, Wi-Fi-only downloads, 1–3 simultaneous downloads, history controls
- Error handling: offline, timeouts, HTTP errors, private/removed videos, storage permission denied, low disk space, interrupted downloads (resumes from the last byte when the server supports ranges, restarts cleanly when it doesn't)
- Storage: files go to **Movies/Video Downloader** via Android MediaStore (`expo-media-library`), so they appear in Gallery and Files

## Project structure

```
App.tsx                         providers + theme + navigation
src/
  navigation/RootTabs.tsx       bottom tabs: Home, Downloads, History, Settings
  screens/                      Home, Downloads, History, Settings
  components/                   ui.tsx (Card, Button, ProgressBar, Badge…), VideoPreviewCard, DownloadItemCard
  services/
    url/                        parseUrl.ts, detect.ts (validation + source detection)
    providers/                  youtube, vimeo, internetArchive, wikimediaCommons, directFile
    downloads/                  fileStore.ts (temp files), mediaSaver.ts (permissions + MediaStore)
    http.ts                     timeouts, offline detection, error mapping, file probing
    persistence.ts              AsyncStorage
  store/                        SettingsContext, HistoryContext, DownloadsContext (queue + download engine)
  theme/                        colors, ThemeContext
tests/                          unit tests: every provider (mocked HTTP), URL validation, errors, file + HLS engines
tests/live/                     live integration tests against the real services (run in CI before every build)
app.json / eas.json             app + APK build configuration
```

## 1. Install the tools (once)

1. Install **Node.js 20 LTS or newer** from nodejs.org.
2. Open a terminal in this folder and install dependencies:

```bash
npm install
```

3. Check everything is healthy:

```bash
npm run typecheck
npm test
npx expo-doctor
```

## 2. Build a test APK — easiest way (cloud, no Android Studio)

Uses Expo's free EAS Build service. You need a free account at https://expo.dev/signup.

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

- First run asks to create an EAS project → answer **Yes**.
- Asks to generate a new Android keystore → answer **Yes** (Expo stores it for you).
- The build takes ~10–20 minutes. When it finishes, the terminal prints a link and a QR code to download the **.apk**.

Install it on your phone: open the link on the phone, download the APK, tap it, and allow "Install unknown apps" for your browser when Android asks.

## 3. Build the APK locally (optional)

Requires Android Studio (with Android SDK) and JDK 17.

```bash
npx expo prebuild --platform android --clean
cd android
./gradlew assembleRelease        # Windows: gradlew.bat assembleRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk` (signed with the debug key — fine for testing, not for the Play Store).

## 4. Run during development

This app uses native modules (media library, intent launcher), so use a development build rather than Expo Go:

```bash
npx expo run:android      # phone connected via USB with USB debugging on, or an emulator running
```

## Testing checklist

| Test | Link to paste | Expected |
|---|---|---|
| Archive download | `https://archive.org/details/BigBuckBunny_124` | Preview + MP4/OGV options → Downloads shows progress → Completed, saved to Movies/Video Downloader |
| Commons download | any `commons.wikimedia.org/wiki/File:….webm` video page | Original + transcode options, license shown |
| Direct file | a `.mp4` link you own | Rights checkbox required before Download enables |
| YouTube | any `youtube.com/watch?v=…` | Title + thumbnail, "Downloading is not permitted", **Watch on YouTube** |
| Invalid | `hello` | "Invalid link" message |
| Offline | turn on airplane mode, fetch | "No connection" |
| Interrupted | start a large download, force-close app, reopen | Item shows Paused · interrupted → Resume continues |
| Permission denied | deny Photos & videos | Explains and links to Settings; nothing marked complete |

## Notes

- Package name: `com.shohan.videodownloader` (change `android.package` in `app.json` before publishing).
- Android 13+ requests the "Photos and videos" (videos) permission; Android 10–12 uses storage permission.
- Downloads run while the app is open or briefly in the background; Android may stop very long downloads when the app is closed — they then appear as interrupted and can be resumed.
