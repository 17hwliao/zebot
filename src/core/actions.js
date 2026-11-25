export const STATES = [
  'waiting',
  'error',
  'working',
  'speaking',
  'thinking',
  'listening',
  'happy',
  'idle',
  'sleeping',
  'offline',
];

export const EXPRESSIONS = [
  'neutral',
  'happy',
  'wink',
  'love',
  'shy',
  'surprised',
  'angry',
  'sad',
  'sleepy',
  'thinking',
  'smug',
  'pout',
  'worried',
  'determined',
  'flustered',
  'scared',
  'excited',
  'cry',
  'confused',
  'listening',
  'sleep',
];

export const MOTIONS = [
  'stand',
  'jump',
  'hop',
  'look',
  'turn',
  'nod',
  'shake',
  'spin',
  'sit',
  'sleep',
  'dizzy',
  'walk',
  'run',
  'wave',
  'bow',
  'shiver',
  'flap',
  'dance',
];

export const STATE_EXPRESSION = {
  waiting: 'worried',
  error: 'sad',
  working: 'determined',
  speaking: 'neutral',
  thinking: 'thinking',
  listening: 'listening',
  happy: 'happy',
  idle: 'neutral',
  sleeping: 'sleep',
  offline: 'sleepy',
};

const TOOL_ACTIONS = {
  exec_command: { status: 'shell', motion: 'nod', label: '运行命令' },
  shell: { status: 'shell', motion: 'nod', label: '运行命令' },
  apply_patch: { status: 'edit', motion: 'nod', label: '修改文件' },
  view_image: { status: 'image', motion: 'look', label: '查看图片' },
  web_search: { status: 'search', motion: 'look', label: '搜索资料' },
  update_plan: { status: 'plan', motion: 'nod', label: '更新计划' },
  spawn_agent: { status: 'agents', motion: 'flap', label: '协作处理' },
  request_user_input: { status: 'ask', motion: 'look', label: '等待你回答' },
};

export function toolAction(name) {
  return TOOL_ACTIONS[name] ?? { status: 'unknown', motion: 'look', label: '处理任务' };
}

export function toolLabel(name, args) {
  if (name === 'exec_command' || name === 'shell') {
    const command = args?.cmd ?? args?.command;
    if (typeof command === 'string' && command.trim()) {
      return `运行：${clip(command.trim(), 46)}`;
    }
  }
  if (name === 'apply_patch') return '修改文件';
  if (name === 'view_image') return '查看图片';
  if (name === 'web_search') return '搜索资料';
  return toolAction(name).label;
}

export function clip(text, max = 100) {
  const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

