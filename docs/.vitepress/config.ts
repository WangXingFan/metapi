import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Metapi Lite 文档',
  description: 'Metapi Lite 使用、部署与维护文档',
  head: [
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon-64.png' }],
    ['link', { rel: 'shortcut icon', href: '/favicon.ico' }],
  ],
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  themeConfig: {
    siteTitle: 'Metapi Lite',
    logo: '/logos/logo-icon-512.png',
    nav: [
      { text: '首页', link: '/' },
      { text: '快速上手', link: '/getting-started' },
      { text: '配置', link: '/configuration' },
      { text: '部署', link: '/deployment' },
      { text: '项目主页', link: 'https://github.com/cita-777/metapi' },
    ],
    sidebar: [
      {
        text: 'Lite 文档',
        items: [
          { text: '文档首页', link: '/' },
          { text: '快速上手', link: '/getting-started' },
          { text: '配置说明', link: '/configuration' },
          { text: '部署指南', link: '/deployment' },
          { text: '运维手册', link: '/operations' },
          { text: '管理 API', link: '/management-api' },
          { text: 'FAQ', link: '/faq' },
          { text: '项目结构', link: '/project-structure' },
          { text: '文档维护', link: '/README' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cita-777/metapi' },
    ],
    outline: {
      level: [2, 3],
    },
    footer: {
      message: 'MIT Licensed',
      copyright: 'Copyright (c) 2026 Metapi Contributors',
    },
    search: {
      provider: 'local',
    },
  },
});
