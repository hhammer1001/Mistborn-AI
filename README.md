# Mistborn AI

A two-player deckbuilding card game inspired by Brandon Sanderson's
Mistborn series, with a pluggable bot framework and online play backed
by InstantDB.

## Stack

- **Client**: React 19 + Vite + TypeScript ([client/](client/))
- **Engine**: Pure-TypeScript game state machine (no DOM dependencies),
  shared between bot and multiplayer paths
  ([client/src/engine/](client/src/engine/))
- **Backend**: InstantDB (auth, lobby rooms, in-flight game state, and
  the post-game match log)

There is no separate server process — every multiplayer message goes
through InstantDB's realtime sync. The host of an online room is the
authoritative simulator; the guest writes intents to a `pendingAction`
field that the host processes.

## Setup

```bash
cd client
npm install
cp .env.example .env  # then fill in VITE_INSTANTDB_APP_ID
```

The `.env` needs at minimum:

```
VITE_INSTANTDB_APP_ID=<your instant app id>
VITE_WEB3FORMS_KEY=<optional, only needed for the in-app feedback form>
```

## Running locally

```bash
npm run dev      # Vite dev server, http://localhost:5200/
npm run build    # type-check + production bundle
npm run preview  # serve the production bundle locally
```

## Schema management (InstantDB)

The schema lives in [client/src/instant.schema.ts](client/src/instant.schema.ts)
and is the source of truth for the production database structure.
Changes are deployed via the `instant-cli` (`devDependency`) using the
helper scripts:

```bash
# One-time per machine: log into your InstantDB account
npm run schema:login

# Pull the current production schema into instant.schema.ts
npm run schema:pull

# Push local schema changes to production
npm run schema:push
```

The `schema:*` scripts read `VITE_INSTANTDB_APP_ID` from `.env` so they
target the same app as the client. `schema:push` is idempotent and
prints `No schema changes to apply!` if local and production are in sync.

**Workflow**:
1. Edit `instant.schema.ts` (add/modify entities, links, indexes).
2. Run `npm run schema:push`.
3. Update [client/src/lib/instantdb.ts](client/src/lib/instantdb.ts)
   if the change affects what the React `init()` schema declares for
   client-side typing.

The schema file is versioned in git. Treat it like any other source
file: review diffs before pushing, and pull first if you suspect
someone else has edited production.

## Project layout

```
client/
  src/
    App.tsx                  # Top-level router/state
    engine/                  # Game state machine + bots
      game.ts, session.ts    # Authoritative game state
      player.ts, deck.ts     # Player + card containers
      *Bot.ts                # Pluggable bot strategies
    components/              # React UI
      MenuShell.tsx          # Steel Ministry menu (sidebar + stage)
      Lobby.tsx              # In-room waiting + character select
      ...                    # Game-board components
    hooks/
      useGame.ts             # Bot-game state + match-log writes
      useMultiplayerGame.ts  # MP host/guest + match-log writes
      useLobby.ts            # Room create/join
      useAuth.ts             # InstantDB magic-code auth
    lib/
      instantdb.ts           # SDK init + client-side schema
      matchLog.ts            # saveMatchRecord helper
    instant.schema.ts        # **Production schema (CLI source of truth)**
```

## Match log

Every finished game writes one `matches` row plus two `matchPlayers`
rows to InstantDB. Both natural ends and forfeits are persisted —
forfeits set `victoryType: "F"` and `forfeiter: 0|1`. Bot games are
attributed to a sentinel profile (`__bot__`) so bot performance is
sliceable by human opponent on the backend.

Tab close / refresh mid-match currently leaves an orphan game with no
match record; reconnection support is deferred.

## Deployment

The client deploys to Cloudflare Pages from the `main` branch (or
whichever branch is configured in the Cloudflare dashboard). The build
command is `cd client && npm install && npm run build`; the output
directory is `client/dist`.

InstantDB is a separate service — schema pushes happen via the CLI and
are not part of the Cloudflare build. Push schema changes _before_
merging client code that depends on them.
