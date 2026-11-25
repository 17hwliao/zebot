export const MOTION_CHOICES = Object.freeze([
  ['walk', '走路'], ['run', '跑步'], ['stand', '站立'], ['jump', '跳跃'],
  ['hop', '小跳'], ['look', '张望'], ['turn', '转身'], ['nod', '点头'],
  ['shake', '摇头'], ['spin', '旋转'], ['sit', '坐下'], ['sleep', '睡觉'],
  ['dizzy', '眩晕'], ['wave', '招手'], ['bow', '鞠躬'], ['shiver', '发抖'],
  ['flap', '扑腾'], ['dance', '跳舞'],
]);

const SEQUENCE = [
  ['walk', 6500], ['run', 3500], ['wave', 2000], ['jump', 2000],
  ['turn', 1200], ['bow', 2000], ['dance', 4000], ['sit', 2500],
  ['sleep', 3000], ['stand', 1500],
];

export function performMotion(body, word) {
  if (!body || !MOTION_CHOICES.some(([id]) => id === word)) return false;
  if (body.busy()) return false;
  body.setRoam('off');
  if (word === 'walk' || word === 'run') {
    const { minX, maxX } = body.bounds;
    const target = body.pet.x < (minX + maxX) / 2 ? maxX - 12 : minX + 12;
    return body.walkTo(target, word === 'run', 0);
  }
  return body.doWord(word);
}

export function createMotionDemo(body, options = {}) {
  let automatic = true;
  let index = 0;
  let nextAt = 0;
  let pending = null;
  let talking = false;
  const status = options.onStatus ?? (() => {});
  return {
    tick(now) {
      if (talking) body.talk();
      if (pending) {
        if (!performMotion(body, pending)) return;
        status(MOTION_CHOICES.find(([id]) => id === pending)[1]);
        pending = null;
        nextAt = now + SEQUENCE[index][1];
        index = (index + 1) % SEQUENCE.length;
      }
      if (!automatic || now < nextAt) return;
      pending = SEQUENCE[index][0];
    },
    play(word) {
      if (!MOTION_CHOICES.some(([id]) => id === word)) return false;
      automatic = false;
      pending = word;
      status(`准备${MOTION_CHOICES.find(([id]) => id === word)[1]}`);
      return true;
    },
    setAutomatic(value) {
      automatic = Boolean(value);
      pending = automatic ? 'walk' : 'stand';
      index = 0;
      nextAt = 0;
    },
    setTalking(value) {
      talking = Boolean(value);
    },
    get automatic() { return automatic; },
  };
}

export function mountMotionControls(body, options = {}) {
  const panel = document.createElement('section');
  panel.className = 'motion-controls';
  panel.setAttribute('aria-label', '动作验收');
  const title = document.createElement('strong');
  title.textContent = '动态动作验收';
  const status = document.createElement('span');
  status.className = 'motion-status';
  const demo = createMotionDemo(body, { onStatus: (text) => { status.textContent = text; } });
  const figure = document.createElement('select');
  figure.setAttribute('aria-label', '角色');
  for (const [id, label] of [['zenbot', 'zenbot'], ['whale', 'DeepSeek 鲸鱼娘']]) {
    figure.add(new Option(label, id));
  }
  figure.value = options.character.figure;
  figure.addEventListener('change', async () => {
    figure.disabled = true;
    try {
      const result = await options.selectCharacter({ figure: figure.value, zenbotRenderer: 'auto' });
      if (!result?.ok) throw new Error('角色切换失败');
      demo.setAutomatic(true);
      automatic.textContent = '暂停自动演示';
    } catch (error) {
      status.textContent = error.message;
      figure.value = options.getCharacter().figure;
    } finally {
      figure.disabled = false;
    }
  });
  const automatic = document.createElement('button');
  automatic.textContent = '暂停自动演示';
  automatic.addEventListener('click', () => {
    demo.setAutomatic(!demo.automatic);
    automatic.textContent = demo.automatic ? '暂停自动演示' : '自动演示';
  });
  const talk = document.createElement('button');
  talk.textContent = '口型演示';
  talk.setAttribute('aria-pressed', 'false');
  talk.addEventListener('click', () => {
    const value = talk.getAttribute('aria-pressed') !== 'true';
    talk.setAttribute('aria-pressed', String(value));
    demo.setTalking(value);
  });
  const expressions = document.createElement('select');
  expressions.setAttribute('aria-label', '表情');
  for (const [id, label] of [
    ['neutral', '平静'], ['happy', '开心'], ['wink', '眨眼'], ['love', '喜欢'],
    ['shy', '害羞'], ['surprised', '惊讶'], ['angry', '生气'], ['sad', '难过'],
    ['sleepy', '困倦'], ['thinking', '思考'], ['smug', '得意'], ['pout', '嘟嘴'],
    ['worried', '担心'], ['determined', '认真'], ['flustered', '慌张'], ['scared', '害怕'],
    ['excited', '兴奋'], ['cry', '哭泣'], ['confused', '疑惑'],
  ]) expressions.add(new Option(label, id));
  expressions.addEventListener('change', () => body.setExpr(expressions.value, 6));
  const actions = document.createElement('div');
  actions.className = 'motion-buttons';
  for (const [word, label] of MOTION_CHOICES) {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', () => {
      demo.play(word);
      automatic.textContent = '自动演示';
    });
    actions.append(button);
  }
  const hint = document.createElement('small');
  hint.textContent = '直接点动作即可；鼠标可拎起、拖动并甩出角色。zenbot 眨眼、口型复用自身表情局部，鲸鱼娘保留原版独立五官。';
  panel.append(title, figure, expressions, automatic, talk, status, actions, hint);
  document.body.append(panel);
  return Object.assign(demo, { syncCharacter(next) { figure.value = next.figure; } });
}
