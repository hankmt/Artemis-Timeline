<script>
  import { onDestroy, onMount } from "svelte";
  import { createEventDispatcher } from "svelte";
  import TrajectoryCanvas from "./TrajectoryCanvas.svelte";
  import {
    PREORDER_DEADLINE,
    PREORDER_URL,
    webMediaUrl,
  } from "../lib/media.js";

  export let photo = null;
  export let title = "";
  export let timeText = "—";
  export let earthDistanceText = "—";
  export let moonDistanceText = "—";
  export let descriptionText = "";
  export let imageDescriptionText = "";
  export let imageDescriptionOpen = false;
  export let useMetric = false;
  export let photographer = "—";
  export let location = "—";
  export let camera = "—";
  export let settings = "—";

  const dispatch = createEventDispatcher();

  let panelEl;
  let sheetState = "middle";
  let sheetTop = "";
  let dragging = false;
  let dragStartY = 0;
  let dragStartTop = 0;
  let calendarDismissed = false;

  $: countdownText = getCountdownText();

  function applySheetState(state) {
    sheetState = state;
    sheetTop = "";
  }

  function cycleSheet() {
    applySheetState(
      sheetState === "closed"
        ? "middle"
        : sheetState === "middle"
          ? "open"
          : "closed",
    );
  }

  function dismissCalendar() {
    calendarDismissed = true;
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function snapPxFor(state) {
    const viewportHeight = window.innerHeight;
    const handleHeight = 56;
    const middleHeight = 290;

    if (state === "open") return viewportHeight * 0.35;
    if (state === "middle") return viewportHeight - middleHeight;
    return viewportHeight - handleHeight;
  }

  function getSheetTopPx() {
    return panelEl?.getBoundingClientRect().top ?? 0;
  }

  function pickClosestSnap(currentTop) {
    const states = ["open", "middle", "closed"];
    let bestState = "open";
    let bestDistance = Infinity;

    for (const state of states) {
      const distance = Math.abs(currentTop - snapPxFor(state));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestState = state;
      }
    }

    return bestState;
  }

  function syncMobileLayout() {
    if (!isMobileViewport()) {
      dragging = false;
      sheetTop = "";
    }
  }

  function startDrag(clientY) {
    if (!isMobileViewport() || !panelEl) return;

    dragging = true;
    dragStartY = clientY;
    dragStartTop = getSheetTopPx();
    sheetTop = `${dragStartTop}px`;
  }

  function moveDrag(clientY) {
    if (!dragging) return;

    const delta = clientY - dragStartY;
    const minTop = window.innerHeight * 0.35;
    const maxTop = snapPxFor("closed");
    const nextTop = Math.max(minTop, Math.min(maxTop, dragStartTop + delta));
    sheetTop = `${nextTop}px`;
  }

  function endDrag() {
    if (!dragging || !panelEl) return;

    dragging = false;
    const finalTop = getSheetTopPx();
    const dragDistance = Math.abs(finalTop - dragStartTop);

    if (dragDistance < 6) cycleSheet();
    else applySheetState(pickClosestSnap(finalTop));
  }

  function handleTouchStart(event) {
    startDrag(event.touches[0].clientY);
  }

  function handleTouchMove(event) {
    if (!dragging) return;
    moveDrag(event.touches[0].clientY);
    if (event.cancelable) event.preventDefault();
  }

  function handleMouseDown(event) {
    startDrag(event.clientY);
  }

  function handleMouseMove(event) {
    moveDrag(event.clientY);
  }

  function handleKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      cycleSheet();
    }
  }

  onMount(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const handleViewportChange = () => syncMobileLayout();

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("resize", handleViewportChange);

    if (mediaQuery.addEventListener)
      mediaQuery.addEventListener("change", handleViewportChange);
    else mediaQuery.addListener(handleViewportChange);

    syncMobileLayout();

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("resize", handleViewportChange);

      if (mediaQuery.removeEventListener)
        mediaQuery.removeEventListener("change", handleViewportChange);
      else mediaQuery.removeListener(handleViewportChange);
    };
  });

  onDestroy(() => {
    dragging = false;
  });

  function getCountdownText() {
    const msLeft = PREORDER_DEADLINE - Date.now();
    if (msLeft <= 0) return "";
    const daysLeft = Math.ceil(msLeft / 86400000);
    return `${daysLeft}${daysLeft === 1 ? " day left" : " days left to pre-order"}`;
  }
</script>

<aside
  bind:this={panelEl}
  class={`meta-panel sheet-${sheetState} ${dragging ? "sheet-dragging" : ""}`}
  id="metaPanel"
  style:top={sheetTop}
>
  <div
    class="bottom-sheet-handle"
    id="sheetHandle"
    role="button"
    tabindex="0"
    on:keydown={handleKeydown}
    on:mousedown={handleMouseDown}
    on:touchstart={handleTouchStart}
    on:touchmove={handleTouchMove}
    on:touchend={endDrag}
    on:touchcancel={endDrag}
  >
    <div class="sheet-handle-bar"></div>
    <div class="sheet-handle-title" id="sheetHandleTitle">
      {sheetState === "open" ? "Collapse Information" : "Show More Information"}
    </div>
  </div>

  <TrajectoryCanvas timestamp={photo?.t ?? null} {useMetric} />

  {#if imageDescriptionText}
    <div class="mobile-image-desc desc-hover">
      <button
        aria-expanded={imageDescriptionOpen}
        class="photo-desc-toggle"
        type="button"
        on:click={() => dispatch("toggleimagedesc")}>Image Description</button
      >
      <div class:open={imageDescriptionOpen} class="desc-hover-tip">
        {imageDescriptionText}
      </div>
    </div>
  {/if}

  {#if !calendarDismissed}
    <div class="calendar-promo" id="calendarPromo">
      <button
        class="calendar-dismiss"
        type="button"
        title="Dismiss"
        on:click={dismissCalendar}>&times;</button
      >
      <a
        class="calendar-cover-wrap"
        href={PREORDER_URL}
        target="_blank"
        rel="noopener"
      >
        <img
          alt="Farther — 2027 Calendar"
          class="calendar-cover"
          id="calendarCover"
          src={webMediaUrl("Farther.png")}
        />
        {#if countdownText}
          <div class="calendar-countdown" id="calendarCountdown">
            <div class="countdown-number" id="countdownDays">
              {countdownText.split(" ")[0]}
            </div>
            <div class="countdown-label">days left to pre-order</div>
          </div>
        {/if}
      </a>
      <div class="calendar-body">
        <div class="calendar-title">FARTHER — 2027 Calendar</div>
        {#if countdownText}
          <div class="calendar-countdown-mobile" id="countdownMobile">
            {countdownText}
          </div>
        {/if}
        <div class="calendar-subtitle">
          13 months of historic Artemis II mission photography on premium matte
          paper.
        </div>
        <a
          class="calendar-link"
          href={PREORDER_URL}
          target="_blank"
          rel="noopener">Pre-order Now →</a
        >
      </div>
    </div>
  {/if}

  <div class="meta-section">
    {#if title}
      <div class="meta-field title-row" id="photoTitleRow">
        <div class="meta-value highlight meta-title" id="metaTitle">
          {title}
        </div>
      </div>
    {/if}

    <div class="meta-field">
      <div class="meta-label">Time (EDT)</div>
      <div class="meta-value highlight time-value" id="metaTime">
        {timeText}
      </div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Distance from Earth</div>
      <div class="meta-value highlight" id="metaDistance">
        {earthDistanceText}
      </div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Distance to Moon</div>
      <div class="meta-value highlight" id="metaMoonDist">
        {moonDistanceText}
      </div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Photographer</div>
      <div class="meta-value highlight" id="metaPhotographer">
        {photographer}
      </div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Location</div>
      <div class="meta-value" id="metaLocation">{location}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Camera</div>
      <div class="meta-value" id="metaCamera">{camera}</div>
    </div>
    <div class="meta-field">
      <div class="meta-label">Settings</div>
      <div class="meta-value" id="metaSettings">{settings}</div>
    </div>
    <button
      class="units-toggle"
      id="unitsToggle"
      type="button"
      on:click={() => dispatch("toggleunits")}
      >{useMetric ? "Show in miles" : "Show in km"}</button
    >
  </div>

  {#if descriptionText}
    <div class="meta-section" id="descSection">
      <h3>Description</h3>
      <div class="meta-desc" id="metaDesc">{descriptionText}</div>
    </div>
  {/if}

  <div class="data-sources">
    <div class="src-links">
      <a
        href="https://www.flickr.com/photos/nasa2explore/"
        target="_blank"
        rel="noopener">NASA Flickr</a
      >
      <span class="src-sep">·</span>
      <a
        href="https://ssd.jpl.nasa.gov/horizons/"
        target="_blank"
        rel="noopener">JPL Horizons</a
      >
      <span class="src-sep">·</span>
      <a
        href="https://www.nasa.gov/artemisaudio/"
        target="_blank"
        rel="noopener">Artemis Audio</a
      >
      <span class="src-sep">·</span>
      <a href="https://www.dvidshub.net/" target="_blank" rel="noopener"
        >DVIDS</a
      >
      <span class="src-sep">·</span>
      <a
        href="https://www.youtube.com/@Astronomy_Live"
        target="_blank"
        rel="noopener">Astronomy Live</a
      >
      <span class="src-sep">·</span>
      <a
        href="https://github.com/hankmt/Artemis-Timeline"
        target="_blank"
        rel="noopener">GitHub</a
      >
    </div>
  </div>
</aside>
