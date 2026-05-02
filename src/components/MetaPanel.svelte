<script>
  import { createEventDispatcher } from 'svelte';
  import TrajectoryCanvas from './TrajectoryCanvas.svelte';
  import { PREORDER_DEADLINE, PREORDER_URL, webMediaUrl } from '../lib/media.js';

  export let photo = null;
  export let title = '';
  export let timeText = '—';
  export let earthDistanceText = '—';
  export let moonDistanceText = '—';
  export let descriptionText = '';
  export let useMetric = false;
  export let photographer = '—';
  export let location = '—';
  export let camera = '—';
  export let settings = '—';

  const dispatch = createEventDispatcher();

  let sheetState = 'middle';
  let calendarDismissed = false;

  $: countdownText = getCountdownText();

  function cycleSheet() {
    sheetState = sheetState === 'closed' ? 'middle' : sheetState === 'middle' ? 'open' : 'closed';
  }

  function dismissCalendar() {
    calendarDismissed = true;
  }

  function getCountdownText() {
    const msLeft = PREORDER_DEADLINE - Date.now();
    if (msLeft <= 0) return '';
    const daysLeft = Math.ceil(msLeft / 86400000);
    return `${daysLeft}${daysLeft === 1 ? ' day left' : ' days left to pre-order'}`;
  }
</script>

<aside class={`meta-panel sheet-${sheetState}`}>
  <div class="bottom-sheet-handle" role="button" tabindex="0" on:click={cycleSheet} on:keydown={(event) => event.key === 'Enter' && cycleSheet()}>
    <div class="sheet-handle-bar"></div>
    <div class="sheet-handle-title">{sheetState === 'open' ? 'Collapse Information' : 'Show More Information'}</div>
  </div>

  <TrajectoryCanvas timestamp={photo?.t ?? null} {useMetric} />

  {#if !calendarDismissed}
    <div class="calendar-promo">
      <button class="calendar-dismiss" type="button" title="Dismiss" on:click={dismissCalendar}>&times;</button>
      <a class="calendar-cover-wrap" href={PREORDER_URL} target="_blank" rel="noopener">
        <img alt="Farther — 2027 Calendar" class="calendar-cover" src={webMediaUrl('Farther.png')}>
        {#if countdownText}
          <div class="calendar-countdown"><div class="countdown-label">{countdownText}</div></div>
        {/if}
      </a>
      <div class="calendar-body">
        <div class="calendar-title">FARTHER — 2027 Calendar</div>
        {#if countdownText}
          <div class="calendar-countdown-mobile">{countdownText}</div>
        {/if}
        <div class="calendar-subtitle">13 months of historic Artemis II mission photography on premium matte paper.</div>
        <a class="calendar-link" href={PREORDER_URL} target="_blank" rel="noopener">Pre-order Now →</a>
      </div>
    </div>
  {/if}

  <div class="meta-section">
    {#if title}
      <div class="meta-field title-row">
        <div class="meta-value highlight meta-title">{title}</div>
      </div>
    {/if}

    <div class="meta-field">
      <div class="meta-label">Time (EDT)</div>
      <div class="meta-value highlight time-value">{timeText}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Distance from Earth</div>
      <div class="meta-value highlight">{earthDistanceText}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Distance to Moon</div>
      <div class="meta-value highlight">{moonDistanceText}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Photographer</div>
      <div class="meta-value highlight">{photographer}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Location</div>
      <div class="meta-value">{location}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Camera</div>
      <div class="meta-value">{camera}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Settings</div>
      <div class="meta-value">{settings}</div>
    </div>
    <button class="units-toggle" type="button" on:click={() => dispatch('toggleunits')}>{useMetric ? 'Show in miles' : 'Show in km'}</button>
  </div>

  {#if descriptionText}
    <div class="meta-section">
      <h3>Description</h3>
      <div class="meta-desc">{descriptionText}</div>
    </div>
  {/if}

  <div class="data-sources">
    <div class="src-links">
      <a href="https://www.flickr.com/photos/nasa2explore/" target="_blank" rel="noopener">NASA Flickr</a>
      <span class="src-sep">·</span>
      <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">JPL Horizons</a>
      <span class="src-sep">·</span>
      <a href="https://www.nasa.gov/artemisaudio/" target="_blank" rel="noopener">Artemis Audio</a>
      <span class="src-sep">·</span>
      <a href="https://www.dvidshub.net/" target="_blank" rel="noopener">DVIDS</a>
      <span class="src-sep">·</span>
      <a href="https://www.youtube.com/@Astronomy_Live" target="_blank" rel="noopener">Astronomy Live</a>
      <span class="src-sep">·</span>
      <a href="https://github.com/hankmt/Artemis-Timeline" target="_blank" rel="noopener">GitHub</a>
    </div>
  </div>
</aside>