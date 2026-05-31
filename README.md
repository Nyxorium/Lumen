# Lumen

A browser extension that surfaces the AT Protocol `pronouns` field on [bsky.app](https://bsky.app) profile pages.

Pronouns appear next to the handle, exactly as they do in [Nyxo Sky](https://nyxo-sky.pages.dev), [Witchsky](https://witchsky.app), or other clients. No sign-in required!

## Developing

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` from this repo

### Chrome / Chromium

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the repo folder

## How it works

When you visit a profile on bsky.app, Lumen fetches the profile record from the public AT Protocol API and injects the `pronouns` field next to the handle. If no pronouns are set, nothing changes.

## Icon

[PIA09178](https://images.nasa.gov/details/PIA09178) by NASA/JPL-Caltech/Univ. of Ariz. — public domain.