# NULL VAULT

Online co-op heist game for 2–4 players. Runs in the browser, no install.

**Play:** https://derbrane999mm-droid.github.io/heist/

- One player clicks **Create crew** and shares the invite link (Esc → *Copy invite link*) or the 5-character crew code.
- Everyone else opens the link, or enters the code and clicks **Join crew**.
- Use Chrome, Edge or Firefox on a laptop or PC. A headset is recommended for the built-in voice chat.

## Status

Foundation slice: hideout hub, crew codes, synced players, built-in voice chat, graphics presets, English/German, and the "crew check" practice-vault puzzle. Missions follow.

## Development

```
npm install
npm run dev          # local dev server
npm run typecheck
node tests/e2e.mjs   # 4 simulated players, full crew-check playthrough (headless Chrome)
NV_DIST=1 node tests/e2e.mjs   # same against the production build
node tests/shots.mjs high      # screenshot tour -> test-out/
scripts/deploy.sh    # build + publish to GitHub Pages
```

Tech: TypeScript, Vite, three.js (+ postprocessing, N8AO), Rapier physics, PeerJS (WebRTC data + voice). All textures and sounds are procedural.
