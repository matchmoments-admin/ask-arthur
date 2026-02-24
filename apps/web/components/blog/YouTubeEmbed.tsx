/**
 * Usage in markdown: place a YouTube URL on its own line.
 * The marked renderer will convert it to a responsive embed.
 *
 * Alternatively, use this syntax in markdown:
 * ::youtube[VIDEO_ID]
 */
export function youtubeHtml(videoId: string): string {
  return `<div class="video-embed">
    <iframe
      src="https://www.youtube.com/embed/${videoId}"
      title="Video"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    ></iframe>
  </div>`;
}
