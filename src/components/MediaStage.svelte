<script>
  import { createEventDispatcher } from "svelte";
  import { getFlickrId } from "../lib/time.js";
  import { webMediaUrl } from "../lib/media.js";

  export let photo = null;
  export let titleMap = {};
  export let descriptionMap = {};
  export let hasPrev = false;
  export let hasNext = false;
  export let imageDescriptionOpen = false;

  const dispatch = createEventDispatcher();

  $: flickrId = photo ? getFlickrId(photo.f) : null;
  $: imageTitle = flickrId ? titleMap[flickrId] || "" : "";
  $: imageDescription = flickrId
    ? descriptionMap[flickrId] || imageTitle
    : imageTitle;
  $: imageAlt =
    imageTitle || (photo ? `${photo.p} — ${photo.loc}` : "Current photo");
  $: imageSrc = photo && !photo.v ? webMediaUrl(photo.f) : "";
  $: videoSrc = photo && photo.v ? webMediaUrl(photo.f) : "";
  $: posterSrc =
    photo && photo.v
      ? webMediaUrl(photo.f.replace(/\.mp4$/i, "-poster.jpg"))
      : "";
</script>

<div class="photo-side">
  <div class="photo-container">
    <img
      id="currentPhoto"
      class="photo-img"
      alt={photo ? imageAlt : "No photos match this filter"}
      src={photo && !photo.v ? imageSrc : ""}
      style:display={photo?.v ? "none" : ""}
    />
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      id="currentVideo"
      class="photo-img"
      controls
      playsinline
      preload="none"
      poster={photo?.v ? posterSrc : ""}
      src={photo?.v ? videoSrc : ""}
      style:display={photo?.v ? "" : "none"}
    ></video>

    <button
      class="nav-arrow nav-prev"
      id="prevBtn"
      disabled={!hasPrev}
      title="Previous photo"
      on:click={() => dispatch("prev")}>‹</button
    >
    <button
      class="nav-arrow nav-next"
      id="nextBtn"
      disabled={!hasNext}
      title="Next photo"
      on:click={() => dispatch("next")}>›</button
    >

    {#if imageDescription}
      <button
        class="photo-desc-btn"
        id="photoDescBtn"
        type="button"
        on:click={() => dispatch("opendesc", { text: imageDescription })}
        >Show Desc</button
      >
    {/if}
  </div>

  <div class="photo-links">
    {#if imageDescription}
      <div class="desc-hover" id="descHover">
        <button
          aria-expanded={imageDescriptionOpen}
          class="photo-desc-toggle"
          id="descToggleBtn"
          type="button"
          on:click={() => dispatch("toggleimagedesc")}>Image Description</button
        >
        <div
          class:open={imageDescriptionOpen}
          class="desc-hover-tip"
          id="descHoverTip"
        >
          {imageDescription}
        </div>
      </div>
    {/if}
  </div>
</div>
