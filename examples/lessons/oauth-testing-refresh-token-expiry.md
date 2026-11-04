---
id: oauth-testing-refresh-token-expiry
title: OAuth login stops working about a week after setup because the app is still in Testing publishing status
keywords: oauth, refresh token, invalid_grant, testing status, publishing status, consent screen, google oauth, token expired, reauthorize
strong: invalid_grant, token has been expired or revoked
min_match: 2
engines: node, electron, python, web, expo
errors: invalid_grant, token has been expired or revoked
created: 2026-11-04
verified: 2026-11-04
source: generic example
---
**Didn't work:** rewriting the token refresh code and adding retries; clearing the stored tokens and logging in again, which worked for a few days; raising the requested token lifetime (there is no such setting for this case); reinstalling the app on the test device.

**Root cause:** Google's OAuth consent screen has a publishing status. An app for external users that is still in `Testing` gets refresh tokens that expire after 7 days. The refresh call then fails with `invalid_grant`, and the failure looks like a bug in the code even though the code is fine. Test users are also limited to 100 accounts in this status. Other providers have similar rules, so check the provider's documentation for a token lifetime that depends on app status.

**Fix:** Move the consent screen to `In production` in the cloud console (the publishing status is on the OAuth consent screen page). Unverified apps in production show a warning screen to users and may need verification for sensitive or restricted scopes, so plan that before a public launch. In the app, treat `invalid_grant` as "sign in again" rather than as a crash: clear the stored refresh token, show the login screen once, and continue. Do not log the token values when you report this error.
