---
id: fps-viewmodel-arm-rest-pose
title: First-person arms look twisted or detached because the rig's rest pose and axes do not match the camera
keywords: viewmodel, first person arms, fps hands, arm rig, rest pose, wrist twisted, hands detached, bind pose, camera forward
strong: viewmodel, fps arms, first person hands
min_match: 2
engines: godot, unity
paths: **/*viewmodel*, **/*arms*.*, **/player/hands/**
created: 2026-11-04
verified: 2026-11-04
source: generic example
---
**Didn't work:** rotating the hand and forearm bones by eye in the editor until the hands looked right from one camera angle; mirroring the model with a negative scale to fix a flipped wrist; changing the field of view and the viewmodel offset, which moved the problem instead of removing it; re-exporting the model several times with the same settings.

**Root cause:** The arm rig was authored in its own modelling space, often with a different up or forward axis from the engine camera. Godot cameras look down local -Z. Unity cameras look down local +Z. An arm that was exported with its bones pointing along another axis ends up rotated 90 or 180 degrees relative to the camera. The second part of the problem is the rest pose: the skeleton's bind (T or A) pose is not always the pose the animations start from. A pivot that was tuned against one of them looks wrong when the animation plays, so the wrist twists during idle or reload and the hands look detached from the gun.

**Fix:** Correct the orientation once, in a fixed place, and keep the runtime free of guesswork:

1. Apply all transforms on the rig before export (in Blender, Ctrl+A then All Transforms), and check that the arm's forward direction matches the engine's camera forward.
2. In the engine, parent the arm root to a pivot node that is a child of the camera. Put the orientation correction (usually a 90 or 180 degree Y rotation, or a fixed basis change) on that pivot, not on individual bones.
3. Pause the animation at its first frame and compare the bone axes against the pivot. If they differ, the rest pose was exported with a different reference; re-bind the skin to the rest pose you use in play.
4. Verify with the camera at zero pitch and yaw, looking at the gun from close range. Only after that check idle, reload and sprint.
