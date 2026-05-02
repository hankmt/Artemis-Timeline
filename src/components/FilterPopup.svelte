<script>
  import { createEventDispatcher } from 'svelte';

  export let open = false;
  export let currentFilter = 'all';
  export let activeCams = [];

  const dispatch = createEventDispatcher();

  function close() {
    dispatch('close');
  }

  function setFilter(filter) {
    dispatch('setfilter', { filter });
  }

  function toggleCamera(camera) {
    dispatch('togglecam', { camera });
  }
</script>

{#if open}
  <div class="filter-popup-modal">
    <button class="filter-popup-close" type="button" on:click={close}>
      <span>Close</span>
      <span class="filter-popup-close-chevron" aria-hidden="true">&#x2039;</span>
    </button>

    <div class="filter-popup-body">
      <div class="filter-section">
        <h4>Where Media Was Taken</h4>
        <label class="filter-option">
          <input checked={currentFilter === 'all' && activeCams.length === 0} name="filter-where" type="radio" on:change={() => setFilter('all')}>
          <span>All Photos and Video</span>
        </label>
        <label class="filter-option">
          <input checked={currentFilter === 'spacecraft' && activeCams.length === 0} name="filter-where" type="radio" on:change={() => setFilter('spacecraft')}>
          <span>Crew Photos Only</span>
        </label>
        <label class="filter-option">
          <input checked={currentFilter === 'exterior' && activeCams.length === 0} name="filter-where" type="radio" on:change={() => setFilter('exterior')}>
          <span>Spacecraft Exterior</span>
        </label>
      </div>

      <div class="filter-section">
        <h4>What Camera</h4>
        <label class="filter-option">
          <input checked={activeCams.includes('d5a')} type="checkbox" on:change={() => toggleCamera('d5a')}>
          <span>D5 #1 <em>Nikon D5 body 3500015 on Orion</em></span>
        </label>
        <label class="filter-option">
          <input checked={activeCams.includes('d5b')} type="checkbox" on:change={() => toggleCamera('d5b')}>
          <span>D5 #2 <em>Nikon D5 body 3500017 on Orion</em></span>
        </label>
        <label class="filter-option">
          <input checked={activeCams.includes('z9')} type="checkbox" on:change={() => toggleCamera('z9')}>
          <span>Z9 <em>Nikon Z 9 body 3920019 on Orion</em></span>
        </label>
        <label class="filter-option">
          <input checked={activeCams.includes('gopro')} type="checkbox" on:change={() => toggleCamera('gopro')}>
          <span>GoPro <em>exterior camera</em></span>
        </label>
        <label class="filter-option">
          <input checked={activeCams.includes('iphone')} type="checkbox" on:change={() => toggleCamera('iphone')}>
          <span>iPhone <em>crew iPhone 17 Pro Max</em></span>
        </label>
      </div>

      <div class="filter-section">
        <h4>Media Type</h4>
        <label class="filter-option">
          <input checked={currentFilter === 'videos' && activeCams.length === 0} type="checkbox" on:change={(event) => setFilter(event.currentTarget.checked ? 'videos' : 'all')}>
          <span>Videos Only</span>
        </label>
      </div>
    </div>
  </div>
{/if}