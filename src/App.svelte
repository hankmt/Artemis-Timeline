<script>
  import { onDestroy, onMount } from "svelte";
  import ControlsBar from "./components/ControlsBar.svelte";
  import DescPopup from "./components/DescPopup.svelte";
  import FilterPopup from "./components/FilterPopup.svelte";
  import Header from "./components/Header.svelte";
  import MediaStage from "./components/MediaStage.svelte";
  import MetaPanel from "./components/MetaPanel.svelte";
  import TimelineBar from "./components/TimelineBar.svelte";
  import { filterPhotos } from "./lib/filtering.js";
  import { audioMediaUrl } from "./lib/media.js";
  import {
    ACTIVITY_COLORS,
    TRAJ_SC,
    TRAJ_START,
    TRAJ_STEP_SC,
    formatDistance,
    formatMoonDist,
    getActivityAt,
    getDisplayDistance,
    getMoonDistKm,
  } from "./lib/mission-data.js";
  import { loadViewerData } from "./lib/photo-data.js";
  import { formatTime, getFlickrId, photoSlug } from "./lib/time.js";

  const title = "ARTEMIS II PHOTO TIMELINE";

  let loading = true;
  let error = "";
  let photos = [];
  let audio = [];
  let titleMap = {};
  let descriptionMap = {};
  let useMetric = false;
  let currentFilter = "all";
  let activeCams = [];
  let currentPhotoIdx = 0;
  let viewStart = 0;
  let viewEnd = 0;
  let audioMuted = true;
  let currentAudio = null;
  let lastAudioClip = null;
  let descPopupOpen = false;
  let descPopupText = "";
  let imageDescriptionOpen = false;
  let filterPopupOpen = false;

  $: filteredPhotos = filterPhotos(photos, currentFilter, activeCams);
  $: if (filteredPhotos.length === 0) currentPhotoIdx = 0;
  $: if (filteredPhotos.length && currentPhotoIdx >= filteredPhotos.length)
    currentPhotoIdx = filteredPhotos.length - 1;
  $: currentPhoto = filteredPhotos[currentPhotoIdx] || null;
  $: timelineStart = photos[0]?.t ?? 0;
  $: timelineEnd = photos[photos.length - 1]?.t ?? 0;
  $: if (!viewStart && timelineStart) viewStart = timelineStart;
  $: if (!viewEnd && timelineEnd) viewEnd = timelineEnd;
  $: currentFlickrId = currentPhoto ? getFlickrId(currentPhoto.f) : null;
  $: currentTitle = currentFlickrId ? titleMap[currentFlickrId] || "" : "";
  $: currentImageDescription = currentFlickrId
    ? descriptionMap[currentFlickrId] || currentTitle
    : currentTitle;
  $: if (!currentImageDescription) imageDescriptionOpen = false;
  $: timeText = currentPhoto ? formatTime(currentPhoto.t) : "—";
  $: earthDistanceText = currentPhoto
    ? formatDistance(getDisplayDistance(currentPhoto.t), useMetric)
    : "—";
  $: moonDistanceText = currentPhoto
    ? currentPhoto.t >= TRAJ_START &&
      currentPhoto.t <= TRAJ_START + TRAJ_SC.length * TRAJ_STEP_SC
      ? formatMoonDist(getMoonDistKm(currentPhoto.t), useMetric)
      : currentPhoto.t < TRAJ_START
        ? useMetric
          ? "~385,000 km"
          : "~239,000 miles"
        : "—"
    : "—";
  $: currentActivity = currentPhoto ? getActivityAt(currentPhoto.t) : null;
  $: mobileActivityLabel = currentActivity
    ? currentActivity.l
    : "Between activities";
  $: mobileActivityColor = currentActivity
    ? ACTIVITY_COLORS[currentActivity.a]
    : "#555";
  $: currentClip = currentPhoto ? getAudioForTimestamp(currentPhoto.t) : null;
  $: currentClipFile = currentClip ? currentClip.f : null;
  $: audioNow = !audioMuted && currentClip ? `🔊 ${currentClip.desc}` : "";
  $: counterText = filteredPhotos.length
    ? `${currentPhotoIdx + 1} / ${filteredPhotos.length}`
    : "0 / 0";
  $: dropdownLabel = buildDropdownLabel();
  $: syncAudio(currentClip, audioMuted);

  onMount(async () => {
    try {
      const data = await loadViewerData();
      photos = data.photos;
      audio = data.audio;
      titleMap = data.titleMap;
      descriptionMap = data.descriptionMap;
      if (photos.length) {
        viewStart = photos[0].t;
        viewEnd = photos[photos.length - 1].t;
        navigateToHash();
      }
    } catch (loadError) {
      error =
        loadError instanceof Error ? loadError.message : String(loadError);
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    stopAudio();
  });

  function stopAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    lastAudioClip = null;
  }

  function getAudioForTimestamp(timestamp) {
    let best = null;
    for (const clip of audio) {
      if (clip.t <= timestamp && (!best || clip.t > best.t)) {
        best = clip;
      }
    }
    return best;
  }

  function syncAudio(clip, muted) {
    if (muted || !clip) {
      stopAudio();
      return;
    }

    if (lastAudioClip === clip.f && currentAudio) return;

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const nextAudio = new Audio(audioMediaUrl(clip.f));
    nextAudio.volume = 0.7;
    currentAudio = nextAudio;
    lastAudioClip = clip.f;
    nextAudio
      .play()
      .then(() => {
        if (currentAudio !== nextAudio) return;
      })
      .catch(() => {
        if (currentAudio === nextAudio) currentAudio = null;
        lastAudioClip = null;
      });
  }

  function resetView() {
    viewStart = timelineStart;
    viewEnd = timelineEnd;
  }

  function ensurePhotoInView() {
    if (!currentPhoto) return;
    if (currentPhoto.t >= viewStart && currentPhoto.t <= viewEnd) return;
    const span = viewEnd - viewStart;
    let start = currentPhoto.t - span / 2;
    let end = currentPhoto.t + span / 2;
    if (start < timelineStart) {
      end += timelineStart - start;
      start = timelineStart;
    }
    if (end > timelineEnd) {
      start -= end - timelineEnd;
      end = timelineEnd;
    }
    viewStart = Math.max(timelineStart, start);
    viewEnd = end;
  }

  function selectPhoto(index, ensureInView = false) {
    currentPhotoIdx = index;
    if (ensureInView) ensurePhotoInView();
    syncHash();
  }

  function goPrev() {
    if (currentPhotoIdx > 0) selectPhoto(currentPhotoIdx - 1, true);
  }

  function goNext() {
    if (currentPhotoIdx < filteredPhotos.length - 1)
      selectPhoto(currentPhotoIdx + 1, true);
  }

  function setFilter(filter) {
    activeCams = [];
    currentFilter = filter;
    currentPhotoIdx = 0;
    resetView();
    syncHash();
  }

  function toggleCamera(camera) {
    currentFilter = "all";
    activeCams = activeCams.includes(camera)
      ? activeCams.filter((entry) => entry !== camera)
      : [...activeCams, camera];
    currentPhotoIdx = 0;
    resetView();
    syncHash();
  }

  function buildDropdownLabel() {
    const parts = [];
    if (currentFilter === "spacecraft") parts.push("Crew Photos");
    else if (currentFilter === "exterior") parts.push("Spacecraft Exterior");
    else if (currentFilter === "videos") parts.push("Videos Only");
    if (activeCams.length)
      parts.push(
        `${activeCams.length} Camera${activeCams.length > 1 ? "s" : ""}`,
      );
    return parts.length
      ? `Showing ${parts.join(" • ")}`
      : "Showing All Photos and Videos";
  }

  function syncHash() {
    if (!currentPhoto) return;
    const nextHash = photoSlug(currentPhoto, titleMap);
    if (window.location.hash !== `#${nextHash}`) {
      history.replaceState(null, "", `#${nextHash}`);
    }
  }

  function navigateToHash() {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return false;

    const findIndex = (collection) =>
      collection.findIndex((photo) => photoSlug(photo, titleMap) === hash);
    const visibleIndex = findIndex(filteredPhotos);
    if (visibleIndex >= 0) {
      currentPhotoIdx = visibleIndex;
      return true;
    }

    const globalIndex = findIndex(photos);
    if (globalIndex >= 0) {
      currentFilter = "all";
      activeCams = [];
      currentPhotoIdx = globalIndex;
      return true;
    }

    return false;
  }

  function handleWindowKeydown(event) {
    if (event.key === "Escape") {
      descPopupOpen = false;
      filterPopupOpen = false;
      return;
    }
    if (event.key === "ArrowLeft") goPrev();
    if (event.key === "ArrowRight") goNext();
  }

  function openDesc(text) {
    if (!text) return;
    descPopupText = text;
    descPopupOpen = true;
  }
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<svelte:window
  on:keydown={handleWindowKeydown}
  on:hashchange={() => navigateToHash() && ensurePhotoInView()}
/>

{#if loading}
  <main class="app-shell loading-state"><div>Loading timeline…</div></main>
{:else if error}
  <main class="app-shell error-state">
    <h1>{title}</h1>
    <p>{error}</p>
  </main>
{:else}
  <main class="app-shell">
    <Header />

    <TimelineBar
      {audio}
      {currentClipFile}
      {currentPhotoIdx}
      photos={filteredPhotos}
      showAudioDots={!audioMuted}
      {timelineEnd}
      {timelineStart}
      {viewEnd}
      {viewStart}
      on:selectphoto={(event) =>
        selectPhoto(event.detail.index, event.detail.ensureInView)}
      on:viewchange={(event) => {
        viewStart = event.detail.viewStart;
        viewEnd = event.detail.viewEnd;
      }}
    />

    <div class="mobile-activity">
      {#if currentActivity}
        <span class="activity-dot" style={`background:${mobileActivityColor}`}
        ></span>
        <span class="activity-name">{mobileActivityLabel}</span>
      {:else}
        <span class="activity-name" style="color:#555">Between activities</span>
      {/if}
    </div>

    <ControlsBar
      {activeCams}
      {audioMuted}
      {audioNow}
      {counterText}
      {currentFilter}
      {dropdownLabel}
      on:openfilters={() => (filterPopupOpen = true)}
      on:setfilter={(event) => setFilter(event.detail.filter)}
      on:toggleaudio={() => {
        audioMuted = !audioMuted;
        if (audioMuted) {
          stopAudio();
        } else if (currentClip) {
          syncAudio(currentClip, false);
        }
      }}
      on:togglecam={(event) => toggleCamera(event.detail.camera)}
    />

    <div class="viewer">
      <MediaStage
        {descriptionMap}
        hasNext={currentPhotoIdx < filteredPhotos.length - 1}
        hasPrev={currentPhotoIdx > 0}
        {imageDescriptionOpen}
        photo={currentPhoto}
        {titleMap}
        on:next={goNext}
        on:opendesc={(event) => openDesc(event.detail.text)}
        on:prev={goPrev}
        on:toggleimagedesc={() =>
          (imageDescriptionOpen = !imageDescriptionOpen)}
      />

      <MetaPanel
        camera={currentPhoto?.cam || "—"}
        descriptionText={currentPhoto?.desc || ""}
        {earthDistanceText}
        {imageDescriptionOpen}
        imageDescriptionText={currentImageDescription}
        location={currentPhoto?.loc || "—"}
        {moonDistanceText}
        photographer={currentPhoto?.p || "—"}
        photo={currentPhoto}
        settings={currentPhoto?.set || "—"}
        {timeText}
        title={currentTitle}
        {useMetric}
        on:toggleimagedesc={() =>
          (imageDescriptionOpen = !imageDescriptionOpen)}
        on:toggleunits={() => (useMetric = !useMetric)}
      />
    </div>

    <FilterPopup
      {activeCams}
      {currentFilter}
      open={filterPopupOpen}
      on:close={() => (filterPopupOpen = false)}
      on:setfilter={(event) => setFilter(event.detail.filter)}
      on:togglecam={(event) => toggleCamera(event.detail.camera)}
    />

    <DescPopup
      open={descPopupOpen}
      text={descPopupText}
      on:close={() => (descPopupOpen = false)}
    />
  </main>
{/if}
