import { defineMessages } from '../../i18n';

const en = {
  preparing: 'Preparing',
  ready: 'Ready',
  fullscreen: 'Fullscreen',
  exit_fullscreen: 'Exit fullscreen',
  language: 'Language',
  lang_en: 'EN',
  lang_ms: 'BM',
  lang_zh: '中文',
  none: 'None',
  not_found: 'This pickup board link is not valid.',
  not_enabled: 'The pickup board is not enabled for this shop.',
  error: 'Could not load the board. Retrying.',
} as const;

// draft: needs native review
const ms: Partial<Record<keyof typeof en, string>> = {
  preparing: 'Sedang disediakan',
  ready: 'Siap',
  fullscreen: 'Skrin penuh',
  exit_fullscreen: 'Keluar skrin penuh',
  language: 'Bahasa',
  none: 'Tiada',
  not_found: 'Pautan papan pengambilan ini tidak sah.',
  not_enabled: 'Papan pengambilan tidak diaktifkan untuk kedai ini.',
  error: 'Tidak dapat memuatkan papan. Mencuba semula.',
};

// draft: needs native review
const zh: Partial<Record<keyof typeof en, string>> = {
  preparing: '制作中',
  ready: '可取餐',
  fullscreen: '全屏',
  exit_fullscreen: '退出全屏',
  language: '语言',
  none: '无',
  not_found: '此取餐屏链接无效。',
  not_enabled: '此店铺未启用取餐屏。',
  error: '无法加载，正在重试。',
};

export const useT = defineMessages<keyof typeof en>('pickup', { en, ms, zh });
