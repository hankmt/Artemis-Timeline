<script>
  import { createEventDispatcher } from 'svelte';
  import { getFlickrId } from '../lib/time.js';
  import { webMediaUrl } from '../lib/media.js';

  export let photo = null;
  export let titleMap = {};
  export let descriptionMap = {};
  export let hasPrev = false;
  export let hasNext = false;

  const dispatch = createEventDispatcher();

  let descOpen = false;

  $: flickrId = photo ? getFlickrId(photo.f) : null;
  $: imageTitle = flickrId ? titleMap[flickrId] || '' : '';
  $: imageDescription = flickrId ? descriptionMap[flickrId] || imageTitle : imageTitle;
  $: if (!imageDescription) descOpen = false;
  $: imageAlt = imageTitle || (photo ? `${photo.p} — ${photo.loc}` : 'Current photo');
  $: imageSrc = photo && !photo.v ? webMediaUrl(photo.f) : '';
  $: videoSrc = photo && photo.v ? webMediaUrl(photo.f) : '';
  $: posterSrc = photo && photo.v ? webMediaUrl(photo.f.replace(/\.mp4$/i, '-poster.jpg')) : '';

  function toggleDescription() {
    if (!imageDescription) return;
    descOpen = !descOpen;
  }
</script>

<div class="photo-side">
  <div class="photo-container">
    {#if photo?.v}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="photo-img" controls playsinline preload="none" poster={posterSrc} src={videoSrc}></video>
    {:else}
      <img class="photo-img" alt={imageAlt} src={imageSrc}>
    {/if}

    <button class="nav-arrow nav-prev" disabled={!hasPrev} title="Previous photo" on:click={() => dispatch('prev')}>‹</button>
    <button class="nav-arrow nav-next" disabled={!hasNext} title="Next photo" on:click={() => dispatch('next')}>›</button>

    {#if imageDescription}
      <button class="photo-desc-btn" type="button" on:click={() => dispatch('opendesc', { text: imageDescription })}>Show Desc</button>
    {/if}
  </div>

  <div class="photo-links">
    {#if imageDescription}
      <div class="desc-hover">
        <button aria-expanded={descOpen} class="photo-desc-toggle" type="button" on:click={toggleDescription}>Image Description</button>
        <div class:open={descOpen} class="desc-hover-tip">{imageDescription}</div>
      </div>
    {/if}
  </div>
</div>