<script>
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();
</script>

<div class="zoom-controls">
  <button
    class="zoom-btn"
    title="Zoom in"
    type="button"
    on:click|stopPropagation={() => dispatch("zoomin")}>+</button
  >
  <button
    class="zoom-btn"
    title="Zoom out"
    type="button"
    on:click|stopPropagation={() => dispatch("zoomout")}>−</button
  >
  <button
    class="zoom-btn"
    title="Reset zoom"
    type="button"
    on:click|stopPropagation={() => dispatch("reset")}>⊙</button
  >
</div>