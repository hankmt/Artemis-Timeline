<script>
  export let labels = [];
</script>

<div class="timeline-labels">
  {#each labels as label}
    <span>{label}</span>
  {/each}
</div>