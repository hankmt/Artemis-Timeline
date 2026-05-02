<script>
  import { createEventDispatcher } from 'svelte';

  export let currentFilter = 'all';
  export let activeCams = [];
  export let audioMuted = true;
  export let audioNow = '';
  export let counterText = '0 / 0';
  export let dropdownLabel = 'Showing All Photos and Videos';

  const dispatch = createEventDispatcher();

  function isFilterActive(filter) {
    return currentFilter === filter && activeCams.length === 0;
  }

  function isCameraActive(camera) {
    return activeCams.includes(camera);
  }
</script>

<div class="controls-row">
  <button class="filter-dropdown-trigger" type="button" on:click={() => dispatch('openfilters')}>
    <span>{dropdownLabel}</span>
    <span class="filter-dropdown-chevron" aria-hidden="true">&#x2039;</span>
  </button>

  <button class:active={isFilterActive('all')} class="filter-btn" on:click={() => dispatch('setfilter', { filter: 'all' })}>All Photos and Video</button>
  <button class:active={isFilterActive('spacecraft')} class="filter-btn" on:click={() => dispatch('setfilter', { filter: 'spacecraft' })}>Crew Photos Only</button>
  <button class:active={isFilterActive('exterior')} class="filter-btn" on:click={() => dispatch('setfilter', { filter: 'exterior' })}>Spacecraft Exterior</button>

  <span class="filter-sep">|</span>

  <button class:active={isCameraActive('d5a')} class="filter-btn cam-filter" on:click={() => dispatch('togglecam', { camera: 'd5a' })}>D5 #1</button>
  <button class:active={isCameraActive('d5b')} class="filter-btn cam-filter" on:click={() => dispatch('togglecam', { camera: 'd5b' })}>D5 #2</button>
  <button class:active={isCameraActive('z9')} class="filter-btn cam-filter" on:click={() => dispatch('togglecam', { camera: 'z9' })}>Z9</button>
  <button class:active={isCameraActive('gopro')} class="filter-btn cam-filter" on:click={() => dispatch('togglecam', { camera: 'gopro' })}>GoPro</button>
  <button class:active={isCameraActive('iphone')} class="filter-btn cam-filter" on:click={() => dispatch('togglecam', { camera: 'iphone' })}>iPhone</button>

  <span class="filter-sep">|</span>

  <button class:active={isFilterActive('videos')} class="filter-btn" on:click={() => dispatch('setfilter', { filter: 'videos' })}>Videos</button>

  <span class="filter-sep">|</span>

  <button class:active={!audioMuted} class:audio-on={!audioMuted} class="filter-btn mute-btn" on:click={() => dispatch('toggleaudio')}>
    <span class="audio-checkbox" aria-hidden="true"></span>
    <span>PLAY AUDIO</span>
  </button>
  <span class="audio-now">{audioNow}</span>
  <div class="controls-spacer"></div>
  <span class="info-text">{counterText}</span>
</div>