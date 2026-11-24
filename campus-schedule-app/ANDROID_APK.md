# Android APK distribution

Run `npm run build:apk` from campus-schedule-app. The preview profile builds a signed, standalone release APK, not an Expo Go development client. It uses the existing remote keystore and automatically increments the Android version code. Keep the same keystore for updates.

The Expo preview environment contains the public Supabase URL and publishable key so sign-in and account sync work. These are client configuration, not service-role credentials. Never put service-role keys, private VAPID keys or cron secrets in an APK or EXPO_PUBLIC variables.

After the build succeeds, download the APK from its Expo build page on your Android phone. Allow installation from the browser/file manager when Android asks, then install. Future APKs with the same package name and signing key can update the app without uninstalling it. Back up important data before testing. The native app and browser have separate local storage: sign in and sync to transfer cloud habits; unsynced guest habits do not appear automatically.

The widget-enabled source adds Android local notifications for habits, classes, tasks and timed focus/break endings. Turn on Settings → Reminders → Remind me and grant notification permission. It queues the next 64 reminders up to seven days ahead, plus the current timed focus/break ending. Opening the app, checking in, editing, snoozing, changing accounts or turning reminders off refreshes/cancels the appropriate queue. Offline changes are supported locally; remote changes apply when this device syncs. Android battery restrictions can delay alarms; force-stopping the app can prevent delivery until it is reopened. No Firebase credentials or paid push service is required for local reminders.

Add the Android widget through Settings → Reminders → Add habit widget, or long-press the Android home screen → Widgets → Isked habits. It shows today's completion and up to four habits depending on size, prioritizing unfinished habits. Tap a row to open that habit for check-in or studying. It does not log progress directly in the launcher. Refreshes after local changes and on Android's periodic widget refresh (about 30 minutes, subject to OS limits). No live per-second timer is shown. Widget data stays on-device; private notes/reflections and cloud credentials are omitted, and switching/signing out clears inaccessible habit data.

Install the updated APK over version 2 to retain native local data. Test on a real Android device before distributing widely; successful builds and mocked tests do not replace device QA.

Android package: com.davesuan.campusschedule
Expo project: @dadave123/campus-schedule-app
No Play Store submission is performed by this build command.

## Widget/reminder build submitted 23 November 2026

- Version 1.0.0, Android version code 5; last observed EAS status IN_QUEUE. No new APK is available yet.
- Build page: https://expo.dev/accounts/dadave123/projects/campus-schedule-app/builds/cdb319c9-badb-4ee1-b657-b912feaec1e3
- Existing remote signing key reused. Download from this page only after FINISHED; the older APK below does not contain these new native features.
- Local TypeScript, logic, Android bundle, web export and targeted browser checks pass. Native compilation and real-device checks remain pending.

## Older build completed 22 November 2026

- Version 1.0.0, Android version code 2; EAS status FINISHED.
- Build page: https://expo.dev/accounts/dadave123/projects/campus-schedule-app/builds/3d85fe2e-c190-4fe6-a497-d57ac9fa78bf
- APK: https://expo.dev/artifacts/eas/FmB63kvaWrDXL8ZOiUp5JdeC8-EmvgyC2pzhSRLVhbU.apk
- Local copy: releases/Isked-1.0.0-2.apk (ignored by Git).
