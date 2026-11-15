import { parseVideoUrl } from "./platforms";

export const COMPILATION = /\b(top\s*\d+|top ten|best of|compilations?|compiled|reacts?|reacting|reaction|ranking|ranked|tier list|countdown|moments|highlights|funniest|greatest|\d+\s+(?:best|greatest|funniest|craziest|most)|montage|supercut|mashup|try not to|clips)\b/i;
/** Channel names that mark edit/clip/compilation accounts: penalised hardest. */
export const CHANNEL_FLAG = /\b(edits?|compilations?|clips?|shorts?|daily|react(?:s|ion|ions|ing)?|top\s*\d+|best of|highlights|memes?|fails?|viral|trending)\b/i;
/** Studios, developers, news archives, stock libraries and official releases. */
export const OFFICIAL = /\b(official|vevo|studios?|pictures|films?|entertainment|records|games?|developer|trailer|full (?:movie|film|episode|match|video|interview)|original|archives?|news|network|pond5|shutterstock|getty|storyblocks|nasa)\b/i;
/** Original subreddits where people name sources. Shown as leads (they are threads, not videos). */
export const LEAD_THREAD = /reddit\.com\/r\/(WhatIsThisMovie|HelpMeFind|tipofmytongue|whatisthissong|NameThatSong|tipofmyjoystick|Whatisthisthing)\b/i;
export const RANKING_TEXT = /\b(top\s*\d+|number\s*\d+|no\.?\s*\d+|#\d{1,2})\b/i;
const CREDITS = /\b(credits?|sources?|clips? (?:from|used)|original video|via @|footage from|all rights)\b/i;
const ATTR = /(?:credits?|source|via|clip from|scene from|taken from|from the (?:movie|film|show|series|game|anime)|footage from|original(?: video| clip)? (?:by|from))\s*[:\-–]?\s*(@?[A-Za-z0-9][\w .'&@!-]{2,60})/gi;

export function videoLinks(text: string) {
  return [...new Set((text.match(/https?:\/\/[^\s)<>"]+/g) ?? []).filter((u) => parseVideoUrl(u)))];
}

/** "Credit: @creator" / "Clip from Movie X" -> search phrases for the true source. */
export function attributions(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(ATTR)) {
    const t = m[1].replace(/[.!\-\s]+$/, "").trim();
    if (t.length >= 3 && !/^https?/i.test(t)) out.add(t);
  }
  return [...out].slice(0, 4);
}

export function classify(title: string, author: string, description = "") {
  const links = videoLinks(description);
  const channelFlag = CHANNEL_FLAG.test(author);
  const compilation = COMPILATION.test(title) || channelFlag || links.length >= 3 || (CREDITS.test(description) && links.length >= 1);
  const official = !compilation && OFFICIAL.test(`${title} ${author}`);
  return { compilation, channelFlag, official, links, attrib: attributions(description) };
}

export const coreQuery = (title = "") =>
  title.replace(new RegExp(COMPILATION.source, "gi"), " ").replace(/[|#()\[\]\-–—:!?]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
