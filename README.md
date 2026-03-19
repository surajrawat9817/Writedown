# Writedown (frontend-only)

Writedown is a production-grade whiteboard built with a custom Canvas engine and a CRDT-backed data model (Yjs). This repo is currently configured to run and deploy as a **static site** (no backend).

The app auto-opens the last active board on `/` and persists boards in your browser storage, so reloads and returning later will restore the board.

## Features

- **Infinite canvas** with world/screen coordinate separation
- **Smooth zoom + pan**
  - Wheel zoom (centered on cursor)
  - Pan via middle mouse drag or **Space + drag**
  - Viewport state persisted per board
- **Tools**
  - Freehand pen (smoothed strokes using `perfect-freehand`)
  - Shapes: rectangle, ellipse, line, arrow
  - Text: double-click to create/edit
  - Select + multi-select (Shift+click, drag selection box)
- **Transforms**
  - Move, resize (handles), rotate (rotation handle)
  - Z-order preserved via a board order array
- **Undo/Redo**
  - `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo
  - Disabled/greyed out when not available
- **Clipboard**
  - `Ctrl/Cmd+C` copy selection
  - `Ctrl/Cmd+V` paste (slight offset per paste)
- **Export**
  - PNG export (board or selection)
  - JSON export (order + elements snapshot)
- **Performance**
  - `requestAnimationFrame` render loop
  - Spatial indexing (`rbush`) + viewport culling to avoid drawing off-screen elements

## Tech stack

- **Frontend:** React (latest) + TypeScript (strict)
- **State:** Zustand
- **UI:** Tailwind CSS + shadcn/ui + Radix primitives
- **Motion:** Framer Motion
- **Canvas engine:** custom 2D Canvas abstraction + `requestAnimationFrame`
- **CRDT model:** Yjs
- **Stroke smoothing:** `perfect-freehand`

## Architecture (high level)

### Source of truth

The board state lives in a **Yjs document** (`Y.Doc`). Even though this build is frontend-only, Yjs is still used as the data model because it provides:

- A normalized, conflict-free representation of edits (CRDT)
- A built-in undo manager (`Y.UndoManager`) that behaves well with batched edits

Board state is stored under the Yjs root map:

- `board` (Y.Map)
  - `elements` (Y.Map<id, Y.Map>) — per-element properties
  - `order` (Y.Array<string>) — draw order / z-index
  - `schemaVersion` (number)

### Rendering + interaction pipeline

- **`CanvasEngine`** owns:
  - the viewport transform (`scale`, `tx`, `ty`)
  - pointer/keyboard interaction state machine (pan, drag, resize, rotate, create, freehand)
  - the `requestAnimationFrame`-based render loop
- **`BoardController`** bridges Yjs ↔ runtime snapshots:
  - Maintains an in-memory `Map<string, Element>` snapshot
  - Maintains an `rbush` spatial index for hit testing + viewport queries
  - Exposes high-level operations: create, update, delete, freehand point appends, text diffs, undo/redo

### State separation

- **UI state (Zustand):** current tool, style settings, selected ids, grid toggles, undo/redo availability
- **Canvas/model state (Yjs + BoardController):** elements and order
- **Commands (CommandBus):** undo/redo/export actions from the UI

## Persistence (browser storage)

This build persists everything locally:

- **Last active board id (cookie):**
  - Cookie name: `whiteboard_last_board`
  - Used to auto-open a board when visiting `/`
- **Board data (Yjs update):**
  - Primary: **IndexedDB** database `whiteboard`, store `boards`
  - Fallback: `localStorage` key `whiteboard:boardUpdate:v1:<boardId>` (Base64)
  - Saved on a debounce and flushed on `pagehide` / when the tab is backgrounded
- **Viewport (pan/zoom):**
  - `localStorage` key `whiteboard:viewport:v1:<boardId>`
- **User identity:**
  - `localStorage` key `whiteboard:userIdentity:v1` (guest id/name/color)

Notes:

- Clearing browser storage will delete your boards.
- Storage quotas vary by browser; very large boards may hit IndexedDB limits.

## Keyboard shortcuts

- Tools:
  - `V` select
  - `H` pan
  - `P` pen
  - `R` rectangle
  - `O` ellipse
  - `L` line
  - `A` arrow
  - `T` text
- Editing:
  - `Ctrl/Cmd+Z` undo
  - `Ctrl/Cmd+Shift+Z` redo
  - `Ctrl/Cmd+A` select all
  - `Backspace/Delete` delete selection
  - `Ctrl/Cmd+C` copy
  - `Ctrl/Cmd+V` paste
- Navigation:
  - `Space + drag` pan (temporary)
  - Middle mouse drag pan

## Project structure

```
apps/
  web/
    src/
      pages/                 # Routes (/, /home, /board/:id)
      whiteboard/
        canvas/              # Engine, controller, rendering, hit-testing
        components/          # Toolbar, top bar
        hooks/               # Session lifecycle
        session/             # Local (frontend-only) session + persistence
        store/               # Zustand UI store
        utils/               # Cookies, viewport storage, identity, etc.
packages/
  shared/                    # Zod schemas + shared types/utilities
```

## Local development

Prereqs:

- Node.js **>= 20**

Commands (run from repo root):

- Install: `npm install`
- Dev server: `npm run dev` (Vite on `http://localhost:5174`)
- Typecheck: `npm run typecheck`
- Tests: `npm run test`
- Production build: `npm run build` (outputs to `apps/web/dist`)
- Preview build: `npm run preview -w apps/web`

## Deployment (GitHub Pages)

This repo includes a GitHub Pages workflow:

- Workflow: `.github/workflows/deploy.yml`
- Artifact: `apps/web/dist`

Steps:

1. Push this repository to GitHub (default branch `main`).
2. In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` and wait for the workflow to finish.
4. Your site URL will be:
   - `https://<user>.github.io/<repo>/`

If the workflow fails in `actions/configure-pages@v5` with `Get Pages site failed (404)`, Pages is not enabled yet.
You can fix it either by enabling Pages in repo settings (step 2), or by adding a PAT as `PAGES_TOKEN`
(repo Settings → Secrets and variables → Actions → New repository secret) so the workflow can enable Pages automatically.

### SPA routing on GitHub Pages

GitHub Pages returns `404.html` for unknown routes. To support refresh/deep-links like `/board/<id>`:

- `apps/web/public/404.html` rewrites to `/?p=<path>`
- `apps/web/index.html` reads `p` and restores the intended client route

If you deploy to a **custom domain** (no `/<repo>/` base path), adjust `segmentCount` in `apps/web/public/404.html`.

## Deployment (Netlify) (optional)

- `netlify.toml` publishes `apps/web/dist` and adds an SPA redirect
- `scripts/deploy-netlify.sh` performs `npm ci`, `npm run build`, then deploys via Netlify CLI

## Trade-offs / current limitations

- This build is **frontend-only**:
  - No multi-user collaboration
  - No server-side persistence
  - Sharing a board URL is only meaningful on the same browser/device (unless you also migrate storage)

If you want real-time collaboration again, the existing Yjs-based architecture is designed to plug into a sync layer (e.g., WebSocket) without changing the canvas/model code.
