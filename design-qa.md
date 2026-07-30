# MyRA Classic Frontend - Design QA

## Visual Truth

- Reference: `Classical/templates/myra/MyRA.dc.html`
- Reference stylesheet: `Classical/styles.css`
- Primary reference capture: `/private/tmp/myra-classic-reference-home-same.png`
- Final implementation capture: `/private/tmp/myra-classic-implementation-home-self-contained.png`
- Combined comparison: `/private/tmp/myra-classic-home-comparison-final.png`
- Comparison viewport: 1485 x 931, light theme, Home screen
- Runtime: `http://127.0.0.1:4173/`

The reference contains illustrative inbox and calendar data. The implementation uses
the same layout with live API-backed sections, so the unauthenticated comparison
correctly renders `No data yet` and `Not connected` instead of copying mock records.

## Responsive Evidence

- Desktop Home, light: `/private/tmp/myra-classic-implementation-home-self-contained.png`
- Desktop Home, dark: `/private/tmp/myra-classic-home-dark-final.png`
- Tablet Home, 768 x 900: `/private/tmp/myra-classic-tablet-fresh.png`
- Tablet Usage, 768 x 900: `/private/tmp/myra-classic-tablet-stats-final.png`
- Mobile Home, 390 x 844: `/private/tmp/myra-classic-mobile-home.png`
- Mobile drawer, 390 x 844: `/private/tmp/myra-classic-mobile-drawer.png`
- Mobile Chat, light: `/private/tmp/myra-classic-mobile-chat.png`
- Mobile Chat, dark: `/private/tmp/myra-classic-mobile-chat-dark.png`
- Mobile Settings, dark: `/private/tmp/myra-classic-mobile-settings-dark.png`

Desktop, tablet, and mobile captures show no clipped text, broken grids, horizontal
overflow, or unusable controls. The mobile drawer overlays the workspace correctly,
and cards collapse to a single column where required.

## Fidelity Review

- Typography: Archivo, Cormorant Garamond, and IBM Plex Mono match the reference
  roles. Display headings, UI labels, and numeric values preserve the supplied
  hierarchy.
- Layout: the 236 px desktop sidebar, 57 px workspace header, 940 px Home content
  width, section order, and flat card structure match the Classic template.
- Color: the exact warm editorial light tokens and evergreen dark tokens are local
  to the frontend. Dark mode uses one restrained green glow on the composer.
- Surfaces: hairline borders, 4/6/8 px radii, low elevation, and compact controls
  replace the previous visual system throughout the app.
- Icons: visible controls use the Lucide icon family with consistent 1.7 stroke
  weight. No emoji, custom SVG substitutes, or CSS-drawn illustrations were added.
- Content: live empty, loading, success, syncing, failure, and disconnected states
  are retained. Missing Usage sections were added in the same Classic card language.
- Accessibility: controls keep semantic labels, pressed/selected states, visible
  focus rings, keyboard-capable inputs, practical tap targets, and theme-aware
  contrast.

## Interaction Checks

- Sidebar navigation, collapse control, mobile drawer, and route changes work.
- Home suggestions start a chat and retain the chosen model.
- Home and Chat model selectors expose Anthropic and OpenAI options.
- The selected model reaches the existing chat request as both `provider` and
  `model`.
- Composer typing enables Send; submission reaches the existing chat workflow.
- Attachment picker, source selection, voice controls, conversation history,
  conversation deletion, agent confirmation cards, and sync actions remain wired.
- Light/dark toggles update the full application and restore correctly.
- Settings selects, segmented controls, and toggles remain interactive.
- Guest Profile navigation redirects to Login without a render-time state update.
- Fresh-tab console check returned no errors or warnings.

## Fixes From Comparison Passes

1. Restored the supplied serif display font after removing an invalid variable cycle.
2. Matched the Home content width and vertical rhythm to the 940 px reference frame.
3. Removed an extra composer divider and reduced the global voice control footprint.
4. Replaced the chat fetch failure strip with a compact Classic error surface.
5. Removed the unnamed duplicate Usage empty card.
6. Corrected guest source states from `Connected` to `No data yet / Not connected`.
7. Stabilized Profile sync-history callbacks and removed all lint warnings.
8. Copied the exact Classic tokens into the frontend so builds no longer depend on
   the reference folder.

## Verification

- `npm run lint`: passed with no warnings
- `npm run build`: passed
- `git diff --check`: passed
- Production build warning: local Browserslist metadata is seven months old; this
  does not affect the implementation or build result.
- Authenticated Google/API data could not be exercised without a live backend and
  user session; those existing request paths and state handlers were retained and
  inspected.

final result: passed
