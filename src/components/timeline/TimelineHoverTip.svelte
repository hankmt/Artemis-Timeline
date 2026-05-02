<script>
  export let hoverLeft = 0;
  export let hoverTime = "";
  export let hoverActivity = "";
  export let hoverColor = "#555";
</script>

<div class="timeline-hover-tip" style={`left:${hoverLeft}px`}>
  <div class="tip-time">{hoverTime}</div>
  <div class="tip-activity">
    <span class="tip-dot" style={`background:${hoverColor}`}></span><span
      class="tip-label">{hoverActivity}</span
    >
  </div>
</div>