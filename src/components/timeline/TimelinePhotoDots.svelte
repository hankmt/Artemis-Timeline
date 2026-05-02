<script>
  import { createEventDispatcher } from "svelte";

  export let visiblePhotos = [];
  export let currentPhotoIdx = 0;

  const dispatch = createEventDispatcher();

  $: photoDotsHtml = visiblePhotos
    .map(({ photo, index, pct }) => {
      const classes = ["photo-dot"];
      if (photo.sc) classes.push("spacecraft");
      if (index === currentPhotoIdx) classes.push("active");
      return `<div class="${classes.join(" ")}" style="left:${pct}%" data-idx="${index}" title="${escapeHtmlAttr(photo.loc || "")}"></div>`;
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
    const dot = event.target.closest(".photo-dot[data-idx]");
    if (!dot) return;

    event.stopPropagation();
    const index = Number(dot.getAttribute("data-idx"));
    if (Number.isFinite(index)) {
      dispatch("selectphoto", { index, ensureInView: false });
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="timeline-photo-dots" on:click={handleClick}>
  {@html photoDotsHtml}
</div>