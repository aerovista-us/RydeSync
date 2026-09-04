# RydeSync Dashboard Cockpit

The `05 Dashboard` view is intentionally a condensed duplicate of existing RydeSync surfaces, not a second control plane.

Primary dashboard surfaces:

- compact live crew map
- online crew strip layered over the map
- duplicated push-to-talk button and microphone enable control
- duplicated shared playback transport for existing host/co-host controls
- duplicated local Listen / Mute controls
- current shared track and playback state
- collapsed connection-health details for realtime, TURN/ICE path, location and sync

All dashboard actions proxy the canonical controls already owned by the Room + Map and Music views. Dashboard code does not create room, voice or playback authority of its own.
