// 轻量国际化：中英文 UI 文案 + 语言检测（默认跟随浏览器语言）
// 说明：chrome.i18n 的 getMessage 无法在运行时手动切换语言，故 UI 文案用 JS 字典驱动；
// 扩展名/描述仍通过 public/_locales + chrome.i18n 本地化（见 manifest 的 __MSG_*__）。

export type Lang = 'zh' | 'en';
export type LangSetting = 'system' | Lang;

const dict: Record<Lang, Record<string, string>> = {
  zh: {
    name: '摸鱼二号',
    subtitle: 'Edge 图片阅读插件',
    openReader: '打开阅读器',
    importFolder: '导入文件夹',
    reauth: '重新授权',
    restore: '还原',
    hide: '隐藏',
    hideDir: '隐藏目录',
    showDir: '显示目录',
    dirHint: '隐藏/显示目录（快捷键 D）',
    showBarsTop: '▲ 显示状态栏',
    showBarsBottom: '▼ 显示状态栏',
    loading: '加载中…',
    importPrompt: '请导入文件夹',
    noImages: '未找到图片',
    emptyHint: '点击「导入文件夹」选择图片目录',
    subfolderWarning: '检测到子文件夹：只能导入单一文件夹，已忽略子文件夹内容。',
    modeScroll: '下拉滚动',
    modeSingle: '单页翻页',
    modeDouble: '双页翻页',
    imageCount: '{n} 张',
    settings: '设置',
    langLabel: '语言',
    langSystem: '跟随浏览器',
    langZh: '中文',
    langEn: 'English',
    defaultMode: '默认阅读模式',
    theme: '主题',
    themeLight: '亮色',
    themeDark: '暗色',
    themeToggle: '切换主题',
    defaultZoom: '默认缩放',
    zoomFixed: '100%',
    zoomMemory: '记忆上次',
    hideKeyLabel: '隐藏快捷键',
    recentFolders: '最近文件夹',
    recentNone: '暂无',
    open: '打开',
  },
  en: {
    name: 'FishTwo',
    subtitle: 'Edge image reading extension',
    openReader: 'Open Reader',
    importFolder: 'Import Folder',
    reauth: 'Re-authorize',
    restore: 'Reset',
    hide: 'Hide',
    hideDir: 'Hide list',
    showDir: 'Show list',
    dirHint: 'Hide/show file list (shortcut D)',
    showBarsTop: '▲ Show bars',
    showBarsBottom: '▼ Show bars',
    loading: 'Loading…',
    importPrompt: 'Please import a folder',
    noImages: 'No images found',
    emptyHint: 'Click "Import Folder" to choose an image folder',
    subfolderWarning: 'Subfolders detected: only a single folder can be imported. Subfolder contents were ignored.',
    modeScroll: 'Scroll',
    modeSingle: 'Single Page',
    modeDouble: 'Double Page',
    imageCount: '{n} images',
    settings: 'Settings',
    langLabel: 'Language',
    langSystem: 'Follow browser',
    langZh: '中文',
    langEn: 'English',
    defaultMode: 'Default reading mode',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeToggle: 'Toggle theme',
    defaultZoom: 'Default zoom',
    zoomFixed: '100%',
    zoomMemory: 'Remember last',
    hideKeyLabel: 'Hide shortcut',
    recentFolders: 'Recent folder',
    recentNone: 'None',
    open: 'Open',
  },
};

/** 根据浏览器语言检测默认语言 */
export function detectLang(): Lang {
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '') || 'en';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 由配置中的语言设置解析出实际语言 */
export function resolveLang(setting: LangSetting): Lang {
  return setting === 'system' ? detectLang() : setting;
}

/** 取文案（支持 {key} 占位替换） */
export function t(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}