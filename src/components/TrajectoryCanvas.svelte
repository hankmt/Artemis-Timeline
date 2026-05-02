<script>
  import {
    KM_TO_MI,
    MOON_RADIUS_KM,
    TRAJ_COS,
    TRAJ_MOON,
    TRAJ_ROT,
    TRAJ_SC,
    TRAJ_SIN,
    TRAJ_START,
    TRAJ_STEP_MOON,
    TRAJ_STEP_SC,
    getDisplayDistance,
    getMoonDistKm,
    getTrajIndex,
    interpTraj,
  } from '../lib/mission-data.js';

  export let timestamp = null;
  export let useMetric = false;

  let canvas;
  let label = 'Trajectory · JPL Horizons data';

  function rotXY(x, y) {
    return [x * TRAJ_COS - y * TRAJ_SIN, x * TRAJ_SIN + y * TRAJ_COS];
  }

  function draw() {
    if (!canvas || timestamp === null) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 400;
    const height = Math.round(width * 0.32);
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const padding = 12;
    const allPoints = TRAJ_SC.concat([[0, 0]]);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const point of allPoints) {
      const [rx, ry] = rotXY(point[0], point[1]);
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
    }

    const rangeX = (maxX - minX) * 1.01;
    const rangeY = Math.max((maxY - minY) * 1.2, rangeX * 0.18);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const scale = Math.min((width - padding * 2) / rangeX, (height - padding * 2) / rangeY);

    function toCanvas(x, y) {
      const [rx, ry] = rotXY(x, y);
      return [
        width / 2 + (rx - centerX) * scale,
        height / 2 - (ry - centerY) * scale,
      ];
    }

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(79,195,247,0.12)';
    ctx.lineWidth = 1.5;
    TRAJ_SC.forEach((point, index) => {
      const [x, y] = toCanvas(point[0], point[1]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const completedIndex = Math.floor(getTrajIndex(timestamp));
    if (completedIndex > 0) {
      for (let index = 1; index < Math.min(completedIndex + 1, TRAJ_SC.length); index += 1) {
        const [x0, y0] = toCanvas(TRAJ_SC[index - 1][0], TRAJ_SC[index - 1][1]);
        const [x1, y1] = toCanvas(TRAJ_SC[index][0], TRAJ_SC[index][1]);
        const fraction = index / TRAJ_SC.length;
        let red;
        let green;
        let blue;

        if (fraction < 0.5) {
          const t = fraction * 2;
          red = Math.round(79 + (255 - 79) * t);
          green = Math.round(195 + (255 - 195) * t);
          blue = Math.round(247 + (255 - 247) * t);
        } else {
          const t = (fraction - 0.5) * 2;
          red = 255;
          green = Math.round(255 - (255 - 140) * t);
          blue = Math.round(255 - (255 - 60) * t);
        }

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = `rgba(${red},${green},${blue},0.7)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    const [earthX, earthY] = toCanvas(0, 0);
    ctx.beginPath();
    ctx.arc(earthX, earthY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#4488cc';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(earthX, earthY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(68,136,204,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#6699bb';
    ctx.font = '8px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Earth', earthX, earthY - 8);

    const moonPosition = interpTraj(TRAJ_MOON, TRAJ_STEP_MOON, timestamp);
    const [moonX, moonY] = toCanvas(moonPosition[0], moonPosition[1]);
    if (moonX > -20 && moonX < width + 20 && moonY > -20 && moonY < height + 20) {
      ctx.beginPath();
      ctx.arc(moonX, moonY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#888';
      ctx.fill();
      ctx.fillStyle = '#666';
      ctx.font = '7px Inter, sans-serif';
      ctx.fillText('Moon', moonX, moonY - 7);
    }

    const spacecraft = timestamp < TRAJ_START ? [0, 0] : interpTraj(TRAJ_SC, TRAJ_STEP_SC, timestamp);
    const [sx, sy] = toCanvas(spacecraft[0], spacecraft[1]);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 10);
    glow.addColorStop(0, 'rgba(79,195,247,0.6)');
    glow.addColorStop(1, 'rgba(79,195,247,0)');
    ctx.beginPath();
    ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4FC3F7';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#4FC3F7';
    ctx.font = 'bold 7px Inter, sans-serif';
    ctx.fillText('Orion', sx, sy > height / 2 ? sy - 8 : sy + 12);

    const [flybyX, flybyY] = toCanvas(TRAJ_SC[117][0], TRAJ_SC[117][1]);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '7px Inter, sans-serif';
    ctx.fillText('Flyby', flybyX, flybyY - 7);

    if (timestamp < TRAJ_START || timestamp > TRAJ_START + TRAJ_SC.length * TRAJ_STEP_SC) {
      label = 'Trajectory · JPL Horizons data';
      return;
    }

    const earthDistance = getDisplayDistance(timestamp);
    const moonDistance = getMoonDistKm(timestamp) - MOON_RADIUS_KM;
    const earthLabel = earthDistance === -1
      ? 'Liftoff'
      : earthDistance < 1
        ? 'Near Earth'
        : useMetric
          ? `${Math.round(earthDistance * 1.60934).toLocaleString()} km from Earth`
          : `${Math.round(earthDistance).toLocaleString()} mi from Earth`;
    const moonLabel = moonDistance <= 0
      ? 'At the Moon'
      : useMetric
        ? `${Math.round(moonDistance).toLocaleString()} km from Moon`
        : `${Math.round(moonDistance * KM_TO_MI).toLocaleString()} mi from Moon`;

    label = `${earthLabel}  ·  ${moonLabel}`;
  }

  $: if (canvas && timestamp !== null) {
    draw();
  }

  function handleResize() {
    draw();
  }
</script>

<svelte:window on:resize={handleResize} />

<div class="traj-section">
  <canvas bind:this={canvas} width="400" height="200"></canvas>
  <div class="traj-label">{label}</div>
</div>