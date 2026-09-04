# RydeSync Android foundation

This is the native sibling of the public RydeSync web client. It targets the same public `/v1` and `/v1/realtime` contracts; it does **not** connect directly to NXCore or require Tailscale.

## Current alpha.7 native scope

- Package: `com.aerovista.rydesync`
- Compose phone shell
- Media3 `MediaLibraryService` / `MediaLibrarySession` foundation for Android Auto
- ExoPlayer configured to stream protected RydeSync `/v1/echoverse/audio/{track_id}` endpoints with an AV Identity bearer adapter
- OkHttp API + WebSocket foundation
- pure-Kotlin room playback target/drift policy matching the web client
- AV Identity deliberately represented as `AvIdentityTokenProvider`; current identity bugs can be fixed behind that interface without modifying media/room logic
- no reusable account/service secret is embedded in the APK
- alpha.7 web/server PTT is not yet implemented in the Android client; native PTT is a separate device gate

## Toolchain

- Android Gradle Plugin 9.3.0
- compile/target SDK 37
- JDK 17
- Compose BOM 2026.08.00
- Media3 1.11.0

A Gradle wrapper binary is intentionally not committed by this generated slice. Open `apps/android` in current Android Studio or generate a Gradle 9.5 wrapper before CLI builds.

## Next native gates

1. Implement the Firebase → AeroVista Identity/AVCC token provider when the final mobile session contract is stable.
2. Persist the room token in Android Keystore-backed app storage only for the active ride/reconnect window.
3. Connect realtime `room.snapshot` / `playback.state` JSON to `RydeSyncPlaybackCoordinator`.
4. Add foreground ride location service with explicit opt-in and the existing ephemeral room location contract.
5. Expand the MediaLibrary browse tree only after the core shared-ride/player flow passes device testing.
