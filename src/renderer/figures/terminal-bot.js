const NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, String(value));
  }
  return node;
}

function heartPath(cx, cy, size = 12) {
  const s = size;
  return `M${cx} ${cy + s * .75}C${cx - s * .55} ${cy + s * .15} ${cx - s} ${cy - s * .25} ${cx - s} ${cy - s * .55}C${cx - s} ${cy - s * 1.05} ${cx - s * .2} ${cy - s * 1.1} ${cx} ${cy - s * .55}C${cx + s * .2} ${cy - s * 1.1} ${cx + s} ${cy - s * 1.05} ${cx + s} ${cy - s * .55}C${cx + s} ${cy - s * .25} ${cx + s * .55} ${cy + s * .15} ${cx} ${cy + s * .75}Z`;
}

function spiralPath(cx, cy) {
  let d = '';
  const turns = 3.2;
  const steps = 42;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const angle = turns * Math.PI * 2 * k;
    const radius = 2 + 11 * k;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(angle) * radius).toFixed(1)} ${(cy + Math.sin(angle) * radius).toFixed(1)}`;
  }
  return d;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ledColor(frame) {
  if (frame.status === 'shell') return '#4da3ff';
  if (frame.status === 'edit') return '#f59e0b';
  if (frame.status === 'search') return '#a78bfa';
  if (frame.status === 'ask') return '#ff5d5d';
  if (frame.status === 'agents') return '#22d3ee';
  const colors = {
    thinking: '#f59e0b',
    working: '#4da3ff',
    waiting: '#ff5d5d',
    speaking: '#34d399',
    happy: '#fbbf24',
    error: '#ef4444',
    sleeping: '#64748b',
    listening: '#22d3ee',
  };
  return colors[frame.mode] ?? '#6ee7b7';
}

export function createTerminalBot() {
  const root = svg('g', { class: 'terminal-bot' });
  const body = svg('g');
  const antenna = svg('line', {
    x1: 128, y1: 96, x2: 128, y2: 70,
    stroke: '#6ee7b7', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: .8,
  });
  const led = svg('circle', { cx: 128, cy: 66, r: 5, fill: '#6ee7b7' });
  const ledGlow = svg('circle', { cx: 128, cy: 66, r: 9, fill: '#6ee7b7', opacity: .14 });

  const torso = svg('rect', {
    x: 74, y: 92, width: 108, height: 120, rx: 36,
    fill: '#202633', stroke: '#6ee7b7', 'stroke-width': 3,
  });
  const screen = svg('rect', {
    x: 91, y: 110, width: 74, height: 60, rx: 18,
    fill: '#0a0f15', stroke: '#2c3a4d', 'stroke-width': 2,
  });
  const screenSheen = svg('path', {
    d: 'M101 118 Q128 111 155 118', fill: 'none', stroke: '#1b2d3a', 'stroke-width': 5, 'stroke-linecap': 'round',
  });
  const badge = svg('text', {
    x: 128, y: 194, 'text-anchor': 'middle', fill: '#6ee7b7',
    'font-family': 'Consolas, monospace', 'font-size': 13, 'font-weight': 700, 'letter-spacing': 1,
  });
  badge.textContent = '>_';

  const leftEye = svg('g');
  const rightEye = svg('g');
  const leftSocket = svg('circle', { cx: 110, cy: 140, r: 12, fill: '#07130f', stroke: '#6ee7b7', 'stroke-width': 3 });
  const rightSocket = svg('circle', { cx: 146, cy: 140, r: 12, fill: '#07130f', stroke: '#6ee7b7', 'stroke-width': 3 });
  const leftPupil = svg('circle', { cx: 110, cy: 140, r: 4.5, fill: '#6ee7b7' });
  const rightPupil = svg('circle', { cx: 146, cy: 140, r: 4.5, fill: '#6ee7b7' });
  const leftMark = svg('path', { fill: 'none', stroke: '#6ee7b7', 'stroke-width': 3, 'stroke-linecap': 'round' });
  const rightMark = svg('path', { fill: 'none', stroke: '#6ee7b7', 'stroke-width': 3, 'stroke-linecap': 'round' });
  leftEye.append(leftSocket, leftPupil, leftMark);
  rightEye.append(rightSocket, rightPupil, rightMark);

  const mouth = svg('ellipse', { cx: 128, cy: 181, rx: 7, ry: 3, fill: '#6ee7b7' });
  const blushLeft = svg('circle', { cx: 94, cy: 166, r: 7, fill: '#ff8fa3', opacity: 0 });
  const blushRight = svg('circle', { cx: 162, cy: 166, r: 7, fill: '#ff8fa3', opacity: 0 });

  const leftLeg = svg('rect', { x: 99, y: 207, width: 20, height: 34, rx: 10, fill: '#202633', stroke: '#6ee7b7', 'stroke-width': 3 });
  const rightLeg = svg('rect', { x: 137, y: 207, width: 20, height: 34, rx: 10, fill: '#202633', stroke: '#6ee7b7', 'stroke-width': 3 });
  const leftFoot = svg('rect', { x: 96, y: 239, width: 28, height: 10, rx: 5, fill: '#6ee7b7', opacity: .75 });
  const rightFoot = svg('rect', { x: 132, y: 239, width: 28, height: 10, rx: 5, fill: '#6ee7b7', opacity: .75 });

  const leftArm = svg('path', { d: 'M82 146 Q66 158 64 180', fill: 'none', stroke: '#6ee7b7', 'stroke-width': 5, 'stroke-linecap': 'round' });
  const rightArm = svg('path', { d: 'M174 146 Q190 158 192 180', fill: 'none', stroke: '#6ee7b7', 'stroke-width': 5, 'stroke-linecap': 'round' });
  const leftHand = svg('circle', { cx: 64, cy: 184, r: 6, fill: '#6ee7b7' });
  const rightHand = svg('circle', { cx: 192, cy: 184, r: 6, fill: '#6ee7b7' });

  body.append(antenna, ledGlow, led, torso, screen, screenSheen, badge, leftEye, rightEye, mouth, blushLeft, blushRight);
  root.append(leftLeg, rightLeg, leftFoot, rightFoot, leftArm, rightArm, leftHand, rightHand, body);

  function setEye(group, socket, pupil, mark, eye, cx, lookX, lookY) {
    const shape = eye?.shape ?? 'ring';
    const rx = eye?.rx ?? 12;
    const ry = eye?.ry ?? 12;
    const closed = ['lid', 'up', 'down', 'gt', 'lt', 'heart', 'spiral'].includes(shape);
    socket.style.display = closed ? 'none' : '';
    pupil.style.display = closed ? 'none' : '';
    mark.style.display = closed ? '' : 'none';
    socket.setAttribute('r', String(shape === 'surprised' ? 15 : Math.max(9, rx)));
    pupil.setAttribute('r', String(shape === 'surprised' ? 5.5 : 4.5));
    if (!closed) {
      socket.setAttribute('cy', String(140 + (eye?.dy ?? 0)));
      pupil.setAttribute('cx', String(cx + lookX));
      pupil.setAttribute('cy', String(140 + (eye?.dy ?? 0) + lookY));
    }
    if (shape === 'lid') {
      const y = 140 + (eye?.dy ?? 0) - clamp(ry, 0, 12);
      mark.setAttribute('d', `M${cx - 12} ${y} L${cx + 12} ${y}`);
    } else if (shape === 'up') {
      mark.setAttribute('d', `M${cx - 12} ${142 + (eye?.dy ?? 0)} Q${cx} ${128 + (eye?.dy ?? 0)} ${cx + 12} ${142 + (eye?.dy ?? 0)}`);
    } else if (shape === 'down') {
      mark.setAttribute('d', `M${cx - 12} ${136 + (eye?.dy ?? 0)} Q${cx} ${150 + (eye?.dy ?? 0)} ${cx + 12} ${136 + (eye?.dy ?? 0)}`);
    } else if (shape === 'gt' || shape === 'lt') {
      const dir = shape === 'gt' ? 1 : -1;
      mark.setAttribute('d', `M${cx - dir * 8} ${130 + (eye?.dy ?? 0)} L${cx + dir * 9} ${140 + (eye?.dy ?? 0)} L${cx - dir * 8} ${150 + (eye?.dy ?? 0)}`);
    } else if (shape === 'heart') {
      mark.setAttribute('d', heartPath(cx, 140 + (eye?.dy ?? 0), 11));
    } else if (shape === 'spiral') {
      mark.setAttribute('d', spiralPath(cx, 140 + (eye?.dy ?? 0)));
    }
  }

  function draw(petG, face, frame) {
    if (root.parentNode !== petG) {
      petG.textContent = '';
      petG.append(root);
    }
    const t = Number(frame.t ?? 0);
    const mode = frame.mode ?? 'idle';
    const sit = Number(frame.sit ?? 0);
    const bob = mode === 'walk' ? Math.sin(t * 11) * 2.2
      : mode === 'run' ? Math.sin(t * 18) * 3.2
        : mode === 'dance' ? Math.sin(t * 7) * 3
          : Math.sin(t * 1.8) * .7;
    body.setAttribute('transform', `translate(0 ${(bob + sit * 9).toFixed(2)})`);

    const look = Array.isArray(frame.look) ? frame.look : frame.look && typeof frame.look === 'object' ? [frame.look.x, frame.look.y] : [0, 0];
    const lookX = clamp(Number(look[0] ?? 0), -3, 3);
    const lookY = clamp(Number(look[1] ?? 0), -2, 2);
    setEye(leftEye, leftSocket, leftPupil, leftMark, face?.eyes?.[0], 110, lookX, lookY);
    setEye(rightEye, rightSocket, rightPupil, rightMark, face?.eyes?.[1], 146, lookX, lookY);

    const gap = Array.isArray(face?.gap) ? face.gap[0] : 50;
    const talk = Number(frame.talk ?? 0);
    const open = clamp((gap - 35) / 65 + talk * .5, 0, 1);
    mouth.setAttribute('rx', String(4 + open * 7));
    mouth.setAttribute('ry', String(2 + open * 8));
    mouth.setAttribute('cy', String(181 + open * 2));

    const blush = clamp(Number(face?.blush ?? 0), 0, 1);
    blushLeft.setAttribute('opacity', String(blush * .8));
    blushRight.setAttribute('opacity', String(blush * .8));

    const wave = frame.gesture?.kind === 'wave' || mode === 'wave';
    if (wave) {
      const k = Math.sin(t * 12);
      rightArm.setAttribute('d', `M174 146 Q196 ${128 + k * 4} 198 ${108 + k * 7}`);
      rightHand.setAttribute('cx', 198);
      rightHand.setAttribute('cy', 104 + k * 7);
    } else {
      rightArm.setAttribute('d', 'M174 146 Q190 158 192 180');
      rightHand.setAttribute('cx', 192);
      rightHand.setAttribute('cy', 184);
    }
    const bow = frame.gesture?.kind === 'bow' || mode === 'bow';
    leftArm.setAttribute('d', bow ? 'M82 146 Q70 166 84 184' : 'M82 146 Q66 158 64 180');

    const color = ledColor({ mode, status: frame.status });
    led.setAttribute('fill', color);
    ledGlow.setAttribute('fill', color);
    ledGlow.setAttribute('opacity', mode === 'thinking' || mode === 'working' ? '.28' : '.12');
    led.setAttribute('r', mode === 'thinking' || mode === 'working' ? '5.5' : '5');
  }

  return {
    draw,
    anchors: { bubble: [128, 28] },
    extent: [58, 56, 198, 256],
    hits: [[128, 150, 78]],
  };
}

