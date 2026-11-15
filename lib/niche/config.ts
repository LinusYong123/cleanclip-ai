// lib/niche/config.ts: one set of limits for every plan. Tune here.
export const FEED = {
  ideasPerReload: 5,
  reloadCooldownSeconds: 15, // minimum gap between reloads
  reloadsPerDay: 12, // resets at midnight UTC
  keywordsPerReload: 2, // keywords searched per reload (rotated at random, so each reload differs)
  followedChannelsPerReload: 3,
  maxAgeDays: 7, // only videos from the last week
  searchCacheHours: 6, // YouTube searches are shared between users for this long
  quotaBudgetPerReload: 450, // YouTube API units one reload may spend
  historyDays: 30, // ideas aren't repeated within this window
} as const;
