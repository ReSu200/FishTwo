import { defineConfig } from 'wxt';

// 详见 https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'zh_CN',
    version: '0.0.2',
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