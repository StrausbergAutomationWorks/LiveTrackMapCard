/**
 * What a path-follower's plan() returns when there is no way round over water:
 * place the marker at its fix, never slide it across land (Lee, 2026-09-29,
 * ECLIPSE through the DuSable Harbor breakwater). Its own module so Entity can
 * read it without importing the tile code.
 */
export const PLACE = "place";
