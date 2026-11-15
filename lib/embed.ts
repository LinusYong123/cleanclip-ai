/** In-app player URLs, so people never have to leave the dashboard. Only YouTube can start/stop at a time. */
export function embedUrl(platform: string, id: string, link: string, start?: number, end?: number) {
  if (platform === "youtube") return `https://www.youtube.com/embed/${id}?rel=0${start != null ? `&start=${Math.floor(start)}&autoplay=1` : ""}${end ? `&end=${Math.ceil(end)}` : ""}`;
  if (platform === "tiktok") return `https://www.tiktok.com/embed/v2/${id}`;
  if (platform === "instagram") return `https://www.instagram.com/p/${id}/embed`;
  if (platform === "facebook") return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(link)}&show_text=false`;
  if (platform === "vimeo") return `https://player.vimeo.com/video/${id}${start != null ? "?autoplay=1" : ""}`;
  return null;
}
