<script>
  import { ACTIVITY_COLORS, ACTIVITY_LABELS } from "../../lib/mission-data.js";

  export let visibleActivities = [];
</script>

<div class="timeline-activity-bars">
  {#each visibleActivities as { activity, left, width }}
    <div
      class:observation-bar={activity.a === "observation"}
      class:observation-bar-plain={activity.a === "deep-obs"}
      class="timeline-activity-bar"
      style={`left:${left}%;width:${width}%;background:${ACTIVITY_COLORS[activity.a]}`}
      title={activity.l}
    >
      {#if width > 8}
        {ACTIVITY_LABELS[activity.a]}
      {/if}
    </div>
  {/each}
</div>