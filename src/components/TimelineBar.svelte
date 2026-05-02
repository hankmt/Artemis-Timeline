<script>
  import { createEventDispatcher } from 'svelte';
  import { ACTIVITY_COLORS, ACTIVITY_LABELS, SCHEDULE, getActivityAt } from '../lib/mission-data.js';
  import { formatTimeShort } from '../lib/time.js';

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
  let hoverTime = '';
  let hoverActivity = '';
  let hoverColor = '#555';
  let activePointerId = null;
  let pendingPointerId = null;
  let pendingStartX = 0;
  let pendingStartY = 0;
  let dragMode = null;
  let lastPanX = 0;
  let dragMoved = false;

  const MIN_VIEW_SPAN = 2 * 3600000;

  $: span = Math.max(1, viewEnd - viewStart);
  $: fullSpan = Math.max(1, timelineEnd - timelineStart);
  $: zoomedIn = span < fullSpan * 0.95;
  $: currentPhoto = photos[currentPhotoIdx] || null;
  $: playheadPercent = currentPhoto ? timeToViewPercent(currentPhoto.t) : 0;
  $: labels = buildLabels();

  function timeToViewPercent(time) {
    return Math.max(-5, Math.min(105, ((time - viewStart) / span) * 100));
  }

  function buildLabels() {
    const count = window.matchMedia('(max-width: 768px)').matches ? 6 : 11;
    return Array.from({ length: count }, (_, index) => {
      const time = viewStart + (span * index) / (count - 1);
      const date = new Date(time);
      if (span < 24 * 3600000) {
        return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
      }
      if (span < 3 * 24 * 3600000) {
        return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'America/New_York' });
      }
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
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
    dispatch('viewchange', { viewStart: next.start, viewEnd: next.end });
  }

  function getTimeFromClientX(clientX) {
    const rect = trackEl.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewStart + span * fraction;
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
    dispatch('selectphoto', { index: bestIndex, ensureInView });
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = trackEl.getBoundingClientRect();
    const anchorFraction = (event.clientX - rect.left) / rect.width;

    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const deltaX = event.shiftKey ? event.deltaY * 0.5 : event.deltaX;
      const shift = (deltaX / rect.width) * span;
      emitView(viewStart + shift, viewEnd + shift);
      return;
    }

    const factor = event.deltaY > 0 ? 1.15 : 0.87;
    const newSpan = Math.max(MIN_VIEW_SPAN, Math.min(fullSpan, span * factor));
    const anchor = viewStart + span * anchorFraction;
    const start = anchor - newSpan * anchorFraction;
    emitView(start, start + newSpan);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.photo-dot, .audio-dot, .zoom-btn')) return;

    hoverVisible = false;
    dragMoved = false;

    if (event.pointerType === 'mouse') {
      activePointerId = event.pointerId;
      trackEl.setPointerCapture(event.pointerId);
      lastPanX = event.clientX;
      dragMode = zoomedIn ? 'pan' : 'scrub';
      if (dragMode === 'scrub') {
        selectNearestPhotoFromTime(getTimeFromClientX(event.clientX), true);
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
      if (dragMode === 'pan') {
        const deltaX = event.clientX - lastPanX;
        if (Math.abs(deltaX) >= 2) dragMoved = true;
        const rect = trackEl.getBoundingClientRect();
        const shift = -(deltaX / rect.width) * span;
        emitView(viewStart + shift, viewEnd + shift);
        lastPanX = event.clientX;
      } else if (dragMode === 'scrub') {
        dragMoved = true;
        selectNearestPhotoFromTime(getTimeFromClientX(event.clientX), true);
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
      trackEl.setPointerCapture(event.pointerId);
      lastPanX = event.clientX;
      dragMoved = true;
      dragMode = zoomedIn ? 'pan' : 'scrub';
      if (dragMode === 'scrub') {
        selectNearestPhotoFromTime(getTimeFromClientX(event.clientX), true);
      }
      event.preventDefault();
    } else {
      pendingPointerId = null;
    }
  }

  function finishPointer(event) {
    if (activePointerId === event.pointerId) {
      if (dragMode === 'pan' && !dragMoved) {
        selectNearestPhotoFromTime(getTimeFromClientX(event.clientX), true);
      }
      if (dragMode === 'scrub') {
        selectNearestPhotoFromTime(getTimeFromClientX(event.clientX), true);
      }
      if (trackEl.hasPointerCapture(event.pointerId)) {
        trackEl.releasePointerCapture(event.pointerId);
      }
      activePointerId = null;
      dragMode = null;
      return;
    }

    if (pendingPointerId === event.pointerId) {
      pendingPointerId = null;
      selectNearestPhotoFromTime(getTimeFromClientX(event.clientX), true);
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
    hoverActivity = activity ? activity.l : 'No scheduled activity';
    hoverColor = activity ? ACTIVITY_COLORS[activity.a] : '#555';
  }

  function zoom(factor) {
    const newSpan = Math.max(MIN_VIEW_SPAN, Math.min(fullSpan, span * factor));
    const start = currentPhoto ? currentPhoto.t - newSpan / 2 : viewStart;
    emitView(start, start + newSpan);
  }
</script>

<div class="timeline-bar">
  <div aria-label="Mission timeline scrubber" bind:this={trackEl} class:zoomed={zoomedIn} class="timeline-track" role="application" on:mousemove={updateHover} on:mouseleave={() => (hoverVisible = false)} on:pointerdown={handlePointerDown} on:pointermove={handlePointerMove} on:pointerup={finishPointer} on:pointercancel={finishPointer} on:wheel={handleWheel}>
    <div class="timeline-activity-bars">
      {#each SCHEDULE as activity}
        {@const left = Math.max(0, timeToViewPercent(activity.s))}
        {@const right = Math.min(100, timeToViewPercent(activity.e))}
        {#if right > 0 && left < 100 && right - left > 0}
          <div class:observation-bar={activity.a === 'observation'} class:observation-bar-plain={activity.a === 'deep-obs'} class="timeline-activity-bar" style={`left:${left}%;width:${right - left}%;background:${ACTIVITY_COLORS[activity.a]}`} title={activity.l}>
            {#if right - left > 8}
              {ACTIVITY_LABELS[activity.a]}
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <div class="timeline-photo-dots">
      {#each photos as photo, index}
        {@const pct = timeToViewPercent(photo.t)}
        {#if pct >= -2 && pct <= 102}
          <button class:active={index === currentPhotoIdx} class:spacecraft={photo.sc} class="photo-dot" style={`left:${pct}%`} title={photo.loc} type="button" on:click|stopPropagation={() => dispatch('selectphoto', { index, ensureInView: false })}></button>
        {/if}
      {/each}
    </div>

    {#if showAudioDots}
      <div class="timeline-audio-dots">
        {#each audio as clip}
          {@const pct = timeToViewPercent(clip.t)}
          {#if pct >= -2 && pct <= 102}
            <button class:playing={currentClipFile === clip.f} class="audio-dot" style={`left:${pct}%`} type="button" on:click|stopPropagation={() => selectNearestPhotoFromTime(clip.t, true)}>
              <span class="audio-tip">🔊 {clip.desc}</span>
            </button>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="timeline-playhead" style={`left:${playheadPercent}%`}></div>

    {#if hoverVisible}
      <div class="timeline-hover-tip" style={`left:${hoverLeft}px`}>
        <div class="tip-time">{hoverTime}</div>
        <div class="tip-activity"><span class="tip-dot" style={`background:${hoverColor}`}></span><span class="tip-label">{hoverActivity}</span></div>
      </div>
    {/if}

    <div class="zoom-controls">
      <button class="zoom-btn" title="Zoom in" type="button" on:click|stopPropagation={() => zoom(0.5)}>+</button>
      <button class="zoom-btn" title="Zoom out" type="button" on:click|stopPropagation={() => zoom(2)}>−</button>
      <button class="zoom-btn" title="Reset zoom" type="button" on:click|stopPropagation={() => emitView(timelineStart, timelineEnd)}>⊙</button>
    </div>
  </div>

  <div class="timeline-labels">
    {#each labels as label}
      <span>{label}</span>
    {/each}
  </div>
</div>