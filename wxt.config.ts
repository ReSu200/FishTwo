import { defineConfig } from 'wxt';

// 详见 https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'zh_CN',
    version: '0.2.0',
    permissions: ['storage'],
    // 图标直接取自 FishOne/icons（public/icons），保持与设计稿一致
    icons: {
      16: '/icons/16.png',
      32: '/icons/32.png',
      48: '/icons/48.png',
      128: '/icons/128.png',
    },
    action: {
      default_icon: {
        16: '/icons/16.png',
        32: '/icons/32.png',
        48: '/icons/48.png',
        128: '/icons/128.png',
      },
    },
  },
});