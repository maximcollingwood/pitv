// Turn a YouTube watch / youtu.be / playlist URL into an embeddable URL.
export function youtubeEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    const list = u.searchParams.get("list");
    const v = u.searchParams.get("v");

    if (u.pathname === "/playlist" && list) {
      return `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1`;
    }
    if (v) return `https://www.youtube.com/embed/${v}?autoplay=1&rel=0`;
    if (u.hostname.includes("youtu.be")) {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}?autoplay=1&rel=0`;
    }
    if (u.pathname.startsWith("/embed/")) {
      return `${url}${url.includes("?") ? "&" : "?"}autoplay=1`;
    }
    if (list) {
      return `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1`;
    }
  } catch {
    /* fall through */
  }
  return "";
}
