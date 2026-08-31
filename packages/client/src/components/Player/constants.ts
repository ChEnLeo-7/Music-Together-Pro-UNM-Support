/** Apple-style easing: fast launch, graceful deceleration */
export const SPRING = { type: 'spring' as const, duration: 0.4, bounce: 0 }

/** Shared layout transition for layoutId FLIP animations (cover-art, song-info) */
export const LAYOUT_TRANSITION = { layout: SPRING }
export const TITLE_LAYOUT_TRANSITION = { layout: { type: 'spring' as const, duration: 0.38, bounce: 0 } }
export const ARTIST_LAYOUT_TRANSITION = { layout: { type: 'spring' as const, duration: 0.42, bounce: 0 } }
