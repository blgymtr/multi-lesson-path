---
id: fps-viewmodel-hands
title: FPS viewmodel hands look twisted or detached
keywords: viewmodel, fps hands, first person arms, wrist, el, kol, bilek
strong: viewmodel
min_match: 2
engines: godot, unity
paths: **/*viewmodel*, **/*arms*.*, **/player/hands/**
errors:
projects:
always: false
created: 2026-01-01
verified: 2026-01-01
source: synthetic fixture
---
**Didn't work:** rotating the hand bones by eye.
**Root cause:** the arm mesh pivot was not at the shoulder.
**Fix:** move the pivot to the shoulder and parent the camera to the head bone.
