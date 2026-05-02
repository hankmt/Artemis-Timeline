<script>
  import { createEventDispatcher } from "svelte";
  import TimelineActivityBars from "./timeline/TimelineActivityBars.svelte";
  import TimelineAudioDots from "./timeline/TimelineAudioDots.svelte";
  import TimelineHoverTip from "./timeline/TimelineHoverTip.svelte";
  import TimelineLabels from "./timeline/TimelineLabels.svelte";
  import TimelinePhotoDots from "./timeline/TimelinePhotoDots.svelte";
  import TimelineZoomControls from "./timeline/TimelineZoomControls.svelte";
  import {
    ACTIVITY_COLORS,
    SCHEDULE,
    getActivityAt,
  } from "../lib/mission-data.js";
  import { formatTimeShort } from "../lib/time.js";

  export let photos = [];
  export let audio = [];
  export let currentPhotoIdx = 0;
  export let currentClipFile = null;
  export let viewStart = 0;
  export let viewEnd = 0;
  export let timelineStart = 0;
  export let timelineEnd = 0;
  export let showAudioDots = false;

  const dispatch = createEventDispatcher();

  let trackEl;
  let hoverVisible = false;
  let hoverLeft = 0;
  let hoverTime = "";
  let hoverActivity = "";
  let hoverColor = "#555";
  let activePointerId = null;
  let pendingPointerId = null;
  let pendingStartX = 0;
  let pendingStartY = 0;
  let dragMode = null;
  let lastPanX = 0;
  let dragMoved = false;
  let scrubbing = false;
  let localViewStart = 0;
  let localViewEnd = 0;
  let suppressPropSync = false;

  const MIN_VIEW_SPAN = 2 * 3600000;

  $: if (
    !suppressPropSync &&
    (viewStart !== localViewStart || viewEnd !== localViewEnd)
  ) {
    localViewStart = viewStart;
    localViewEnd = viewEnd;
  }

  $: span = Math.max(1, localViewEnd - localViewStart);
  $: fullSpan = Math.max(1, timelineEnd - timelineStart);
  $: zoomedIn = span < fullSpan * 0.95;
  $: currentPhoto = photos[currentPhotoIdx] || null;
  $: playheadPercent = currentPhoto
    ? Math.max(
        -5,
        Math.min(105, ((currentPhoto.t - localViewStart) / span) * 100),
      )
    : 0;
  $: playheadStyle = `left:${playheadPercent}%`;
  $: labels = buildLabels(localViewStart, span);
  $: visibleActivities = SCHEDULE.map((activity) => {
    const left = Math.max(
      -5,
      Math.min(105, ((activity.s - localViewStart) / span) * 100),
    );
    const right = Math.max(
      -5,
      Math.min(105, ((activity.e - localViewStart) / span) * 100),
    );
    return {
      activity,
      left,
      width: right - left,
    };
  }).filter(
    ({ left, width, activity }) =>
      left < 100 &&
      width > 0 &&
      ((activity.e - localViewStart) / span) * 100 > 0,
  );

  $: visiblePhotos = photos
    .map((photo, index) => ({
      photo,
      index,
      pct: Math.max(
        -5,
        Math.min(105, ((photo.t - localViewStart) / span) * 100),
      ),
    }))
    .filter(({ pct }) => pct >= -2 && pct <= 102);

  $: visibleAudio = audio
    .map((clip) => ({
      clip,
      pct: Math.max(
        -5,
        Math.min(105, ((clip.t - localViewStart) / span) * 100),
      ),
    }))
    .filter(({ pct }) => pct >= -2 && pct <= 102);

  function timeToViewPercent(time) {
    return Math.max(-5, Math.min(105, ((time - localViewStart) / span) * 100));
  }

  function buildLabels(start, currentSpan) {
    const count = window.matchMedia("(max-width: 768px)").matches ? 6 : 11;
    return Array.from({ length: count }, (_, index) => {
      const time = start + (currentSpan * index) / (count - 1);
      const date = new Date(time);
      if (currentSpan < 24 * 3600000) {
        return date.toLocaleString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: "America/New_York",
        });
      }
      if (currentSpan < 3 * 24 * 3600000) {
        return date.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          hour12: true,
          timeZone: "America/New_York",
        });
      }
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "America/New_York",
      });
    });
  }

  function clampRange(start, end) {
    let nextStart = start;
    let nextEnd = end;
    if (nextStart < timelineStart) {
      nextEnd += timelineStart - nextStart;
      nextStart = timelineStart;
    }
    if (nextEnd > timelineEnd) {
      nextStart -= nextEnd - timelineEnd;
      nextEnd = timelineEnd;
    }
    if (nextStart < timelineStart) nextStart = timelineStart;
    return { start: nextStart, end: nextEnd };
  }

  function emitView(start, end) {
    const next = clampRange(start, end);
    suppressPropSync = true;
    localViewStart = next.start;
    localViewEnd = next.end;
    dispatch("viewchange", { viewStart: next.start, viewEnd: next.end });
    queueMicrotask(() => {
      suppressPropSync = false;
    });
  }

  function setScrubbing(active) {
    scrubbing = active;
    if (!active) hoverVisible = false;
  }

  function getTimeFromClientX(clientX) {
    const rect = trackEl.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width),
    );
    return localViewStart + span * fraction;
  }

  function selectNearestPhotoFromTime(time, ensureInView = false) {
    if (!photos.length) return;
    let bestIndex = 0;
    let bestDistance = Infinity;
    photos.forEach((photo, index) => {
      const distance = Math.abs(photo.t - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    dispatch("selectphoto", { index: bestIndex, ensureInView });
  }

  function jumpToNearestPhotoForClientX(clientX) {
    if (!photos.length) return;
    const time = getTimeFromClientX(clientX);

    let bestIndex = 0;
    let bestDistance = Infinity;
    photos.forEach((photo, index) => {
      const distance = Math.abs(photo.t - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (currentPhotoIdx !== bestIndex) {
      dispatch("selectphoto", { index: bestIndex, ensureInView: false });

      if (zoomedIn) {
        const photoTime = photos[bestIndex].t;
        const margin = span * 0.15;
        if (
          photoTime < localViewStart + margin ||
          photoTime > localViewEnd - margin
        ) {
          const start = photoTime - span / 2;
          emitView(start, start + span);
        }
      }
      return;
    }

    dispatch("selectphoto", { index: bestIndex, ensureInView: false });
  }

  function zoomTimeline(factor, anchorFraction) {
    const clampedAnchor = Math.max(0, Math.min(1, anchorFraction));
    const newSpan = Math.max(MIN_VIEW_SPAN, Math.min(fullSpan, span * factor));
    const anchor = localViewStart + span * clampedAnchor;
    const start = anchor - newSpan * clampedAnchor;
    emitView(start, start + newSpan);
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = trackEl.getBoundingClientRect();
    const anchorFraction = (event.clientX - rect.left) / rect.width;

    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const deltaX = event.shiftKey ? event.deltaY * 0.5 : event.deltaX;
      const shift = (deltaX / rect.width) * span;
      emitView(localViewStart + shift, localViewEnd + shift);
      updateHover(event);
      return;
    }

    const factor = event.deltaY > 0 ? 1.15 : 0.87;
    zoomTimeline(factor, anchorFraction);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest(".photo-dot, .audio-dot, .zoom-btn")) return;

    hoverVisible = false;
    dragMoved = false;

    if (event.pointerType === "mouse") {
      activePointerId = event.pointerId;
      try {
        trackEl.setPointerCapture(event.pointerId);
      } catch {
        activePointerId = null;
        return;
      }
      lastPanX = event.clientX;
      dragMode = zoomedIn ? "pan" : "scrub";
      if (dragMode === "scrub") {
        setScrubbing(true);
        jumpToNearestPhotoForClientX(event.clientX);
      }
      event.preventDefault();
      return;
    }

    pendingPointerId = event.pointerId;
    pendingStartX = event.clientX;
    pendingStartY = event.clientY;
  }

  function handlePointerMove(event) {
    if (activePointerId === event.pointerId) {
      if (dragMode === "pan") {
        const deltaX = event.clientX - lastPanX;
        if (Math.abs(deltaX) >= 2) dragMoved = true;
        const rect = trackEl.getBoundingClientRect();
        const shift = -(deltaX / rect.width) * span;
        emitView(localViewStart + shift, localViewEnd + shift);
        lastPanX = event.clientX;
      } else if (dragMode === "scrub") {
        dragMoved = true;
        jumpToNearestPhotoForClientX(event.clientX);
      }
      event.preventDefault();
      return;
    }

    if (pendingPointerId !== event.pointerId) return;
    const dx = event.clientX - pendingStartX;
    const dy = event.clientY - pendingStartY;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;

    if (Math.abs(dx) >= Math.abs(dy)) {
      activePointerId = event.pointerId;
      pendingPointerId = null;
      try {
        trackEl.setPointerCapture(event.pointerId);
      } catch {
        activePointerId = null;
        return;
      }
      lastPanX = event.clientX;
      dragMoved = true;
      dragMode = zoomedIn ? "pan" : "scrub";
      if (dragMode === "scrub") {
        setScrubbing(true);
        jumpToNearestPhotoForClientX(event.clientX);
      }
      event.preventDefault();
    } else {
      pendingPointerId = null;
    }
  }

  function finishPointer(event) {
    if (activePointerId === event.pointerId) {
      if (dragMode === "pan" && !dragMoved) {
        jumpToNearestPhotoForClientX(event.clientX);
      }
      if (dragMode === "scrub") {
        jumpToNearestPhotoForClientX(event.clientX);
      }
      if (trackEl.hasPointerCapture(event.pointerId)) {
        trackEl.releasePointerCapture(event.pointerId);
      }
      activePointerId = null;
      dragMode = null;
      setScrubbing(false);
      return;
    }

    if (pendingPointerId === event.pointerId) {
      pendingPointerId = null;
      jumpToNearestPhotoForClientX(event.clientX);
    }
  }

  function updateHover(event) {
    if (activePointerId !== null) {
      hoverVisible = false;
      return;
    }

    const rect = trackEl.getBoundingClientRect();
    const left = event.clientX - rect.left;
    const time = getTimeFromClientX(event.clientX);
    if (time < timelineStart || time > timelineEnd) {
      hoverVisible = false;
      return;
    }

    const activity = getActivityAt(time);
    hoverVisible = true;
    hoverLeft = Math.max(60, Math.min(rect.width - 120, left));
    hoverTime = formatTimeShort(time);
    hoverActivity = activity ? activity.l : "No scheduled activity";
    hoverColor = activity ? ACTIVITY_COLORS[activity.a] : "#555";
  }

  function zoom(factor) {
    zoomTimeline(factor, 0.5);
  }

  function handleAudioSelect(file) {
    const clip = audio.find((entry) => entry.f === file);
    if (clip) {
      selectNearestPhotoFromTime(clip.t, true);
    }
  }
</script>

<div class="timeline-bar">
  <div
    aria-label="Mission timeline scrubber"
    bind:this={trackEl}
    class:zoomed={zoomedIn}
    class:scrubbing
    class="timeline-track"
    role="application"
    on:mousemove={updateHover}
    on:mouseleave={() => (hoverVisible = false)}
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={finishPointer}
    on:pointercancel={finishPointer}
    on:wheel={handleWheel}
  >
    <TimelineActivityBars {visibleActivities} />

    <TimelinePhotoDots
      {visiblePhotos}
      {currentPhotoIdx}
      on:selectphoto={(event) => dispatch("selectphoto", event.detail)}
    />

    {#if showAudioDots}
      <TimelineAudioDots
        {visibleAudio}
        {currentClipFile}
        on:selectaudio={(event) => handleAudioSelect(event.detail.file)}
      />
    {/if}

    <div class="timeline-playhead" style={playheadStyle}></div>

    {#if hoverVisible}
      <TimelineHoverTip
        {hoverLeft}
        {hoverTime}
        {hoverActivity}
        {hoverColor}
      />
    {/if}

    <TimelineZoomControls
      on:zoomin={() => zoom(0.5)}
      on:zoomout={() => zoom(2)}
      on:reset={() => emitView(timelineStart, timelineEnd)}
    />
  </div>

  <TimelineLabels {labels} />
</div>
