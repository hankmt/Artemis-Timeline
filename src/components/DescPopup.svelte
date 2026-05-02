<script>
  import { createEventDispatcher } from "svelte";

  export let open = false;
  export let text = "";

  const dispatch = createEventDispatcher();

  function close() {
    dispatch("close");
  }
</script>

{#if open}
  <div class="desc-popup-modal" id="descPopupModal">
    <button
      class="desc-popup-backdrop"
      type="button"
      on:click={close}
      aria-label="Close description popup"
    ></button>
    <div
      class="desc-popup-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="descPopupHeading"
    >
      <button
        class="desc-popup-close"
        type="button"
        on:click={close}
        aria-label="Close">&times;</button
      >
      <h3 id="descPopupHeading">Image Description</h3>
      <div class="desc-popup-text" id="descPopupText">{text}</div>
    </div>
  </div>
{/if}
