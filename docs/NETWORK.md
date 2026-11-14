# Network: what the game needs, what can fail, how to add a relay

Written for the owner's next session. Nothing here was tested between two real home networks; see "Not verified".

## What the game needs

- **Signalling** (finding each other): the public PeerJS cloud (`0.peerjs.com`, WebSocket over HTTPS). Only used to set up connections, no game traffic.
- **STUN** (learning the own public address): `stun.l.google.com`, `stun1.l.google.com`, `stun.cloudflare.com`.
- **Data**: host-authoritative star. Every guest opens two WebRTC data channels to the host (reliable and unreliable, `src/net/session.ts`). Small: poses at 20 Hz plus state patches.
- **Voice**: full mesh. Every pair of the four players has its own audio call (`src/net/voice.ts`), so each player holds up to 3 audio links to people who are NOT necessarily the host. A voice link can fail while data works.
- No TURN relay was configured. Two players whose routers do not allow a direct UDP path cannot connect.

## What was found in the code

- `session.ts` passed only three STUN servers, and passing `config` to PeerJS replaces its built-in list. The PeerJS library default also contains a shared public TURN (`turn:eu-0.turn.peerjs.com:3478`, user `peerjs`, password `peerjsp`); the game did not use it. It is **not** enabled now (it is a third-party shared server, not one the game used before); see option C.
- Voice reuses the session's `Peer` object, so signalling server and ICE servers are one setting for data and voice.
- A guest who cannot connect gets `blocked` after 20 s (signalling worked, no link opened) or `no-server`. Roster and voice links are independent: voice failure used to be invisible.

## What changed

- `src/net/netconfig.ts`: one source of truth. Boot fetches `${BASE_URL}net.json` (optional; missing, slow or invalid = defaults). Built-in STUN servers stay; `iceServers` in net.json are added (set `"replaceDefaults": true` to use only yours). `peer` replaces the signalling server. Invalid entries are dropped silently.
- URL parameters for quick tests: `?turn=<url>&turnuser=<u>&turnpass=<p>` (one TURN server), `?relay=1` (only relay candidates are used: if the game connects like this, the relay really works), `?signal=local` unchanged.
- Main menu **Verbindung testen / Test connection** (`src/net/diag.ts`): signalling reachable and timed, ICE gathering (host / srflx / relay counts, IPv6, symmetric-NAT hint when two STUN servers report different public ports), microphone level, WebGL renderer and software check. Plain-language verdict and a **Kopieren** button; the report holds kinds and counts, never addresses. Players can paste it into the chat.
- Join errors now say what to try. The crew list shows "kein Ton" / "no sound" for a player whose voice has not played for 15 s while data works.
- Test: `node tests/net-diag.mjs`.

## Realistic failure cases (German home connections)

| Case | What happens | Check shows |
|---|---|---|
| Normal NAT (cone) on both sides | Direct connection works via STUN. | "Direktverbindung sollte klappen" |
| DS-Lite / CGNAT (common with cable providers; IPv4 shared with other customers, no port forwarding) | Often still direct: carrier NAT is frequently cone-type. If it is symmetric, no direct path. | srflx found; maybe symmetric hint |
| Symmetric / strict NAT on one side | Works if the other side is open. Two strict sides: fails without relay. Voice mesh can fail between two guests even if the host is reachable from both. | "Dein Netz ist streng" |
| IPv6-only or IPv6 preferred | Works only when both ends have IPv6 (check shows IPv6 yes). A DS-Lite user usually has IPv6 as well, so two DS-Lite players can often connect over IPv6. | "IPv6-Adresse gefunden" |
| Firewall blocks UDP (office, school, some VPNs) | No srflx. | "Keine öffentliche Adresse" |
| Signalling cloud slow or down | Nobody can host or join. | "Matchmaking-Server nicht erreichbar" |

Rule of thumb: with four players, one strict network is usually survivable, two strict networks usually are not without a relay.

## Options to add a relay (TURN)

All of them end in one edit: create `public/net.json` (copy of `public/net.example.json`), rebuild/deploy. Or test first with the URL parameters, no deploy. Then run the check on every machine: the verdict must say "Relay erreichbar", and `?relay=1` must still allow a session.

Caution: `net.json` is served by the public site and the repo is public, so TURN credentials in it are readable by anyone. Add `public/net.json` to `.gitignore` if the repo should not hold it (the deploy script builds from `public/`, so it is still published with the site). Prefer an account with a usage cap and rotate after the evening.

### A. Hosted TURN service with a free tier
Needs from the owner: an account at the provider, a TURN credential (static username/password if the provider offers them; providers that only issue short-lived credentials by API cannot be used through a static file), a look at the current free-tier limits. Effort: about 15 minutes. Relay traffic per player is small (voice about 30-50 kbit/s per link plus a few kbit/s of data), so an evening for four is far below typical free quotas; verify the current numbers with the provider.
```json
{ "iceServers": [ { "urls": ["turn:HOST:80", "turn:HOST:443?transport=tcp", "turns:HOST:443?transport=tcp"], "username": "USER", "credential": "PASS" } ] }
```

### B. coturn on a server the owner already rents
Needs: a Linux server with a public IP (a small VPS is enough), a DNS name or the IP, firewall opening UDP/TCP 3478 (and 443 for TLS if wanted) plus UDP 49152-65535 for relay ports. Effort: 30-60 minutes. No third party involved.
```
# /etc/turnserver.conf
listening-port=3478
realm=heist
lt-cred-mech
user=heist:CHOOSE-A-LONG-PASSWORD
fingerprint
no-multicast-peers
```
```json
{ "iceServers": [ { "urls": ["turn:YOUR.SERVER:3478?transport=udp", "turn:YOUR.SERVER:3478?transport=tcp"], "username": "heist", "credential": "CHOOSE-A-LONG-PASSWORD" } ] }
```

### C. The shared public TURN that ships inside PeerJS
Needs: nothing (no account). It is a community server run by the PeerJS project with a published shared login; no guarantee, may be rate-limited or gone. Effort: one line. The owner decides whether using a third-party server is acceptable.
```json
{ "iceServers": [ { "urls": ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], "username": "peerjs", "credential": "peerjsp" } ] }
```

## Risk: the public PeerJS signalling cloud

It is a free shared service without a promise of availability. If it is slow or down, nobody can create or join a crew (running sessions keep working). The check shows its reachability and timing. Fallback: run your own PeerServer on any host players can reach:
```
npx peerjs --port 9000        # add --key/--path/--proxied as needed; put it behind HTTPS (e.g. a reverse proxy) because the game is served over HTTPS
```
then in `net.json`:
```json
{ "peer": { "host": "signal.example.org", "port": 443, "path": "/", "secure": true } }
```
Effort: 20-40 minutes including HTTPS. Players must reload the site after net.json changes.

## Evening checklist

1. Everyone opens the site, main menu, **Verbindung testen**, pastes the report into the chat (about 10 s).
2. Anyone with "Dein Netz ist streng" or "Keine öffentliche Adresse": try a phone hotspot or add a relay (above).
3. In a session: a "kein Ton" note in the crew list means the voice link to that player failed; data still works.

## Not verified

Everything was tested on one machine (loopback, local signalling). Never seen: the public PeerJS cloud under load, real STUN answers and the symmetric-NAT hint on a real router, CGNAT behaviour, a real TURN relay (credentials were never available), and the 15-second "kein Ton" timing on a real failing link.
