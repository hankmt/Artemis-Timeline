<script>
  import { createEventDispatcher } from "svelte";

  export let visibleAudio = [];
  export let currentClipFile = null;

  const dispatch = createEventDispatcher();

  $: audioDotsHtml = visibleAudio
    .map(({ clip, pct }) => {
      const classes = ["audio-dot"];
      if (currentClipFile === clip.f) classes.push("playing");
      return `<div class="${classes.join(" ")}" style="left:${pct}%" data-audio-file="${escapeHtmlAttr(clip.f || "")}"><span class="audio-tip">🔊 ${escapeHtmlText(clip.desc || "")}</span></div>`;
    })
    .join("");

  function escapeHtmlText(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function escapeHtmlAttr(value) {
    return escapeHtmlText(value)
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function handleClick(event) {
    const dot = event.target.closest(".audio-dot[data-audio-file]");
    if (!dot) return;

    event.stopPropagation();
    const file = dot.getAttribute("data-audio-file");
    if (file) {
      dispatch("selectaudio", { file });
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="timeline-audio-dots" on:click={handleClick}>
  {@html audioDotsHtml}
</div>