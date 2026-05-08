import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/api-explorer',
    component: ComponentCreator('/api-explorer', 'bb7'),
    exact: true
  },
  {
    path: '/blog',
    component: ComponentCreator('/blog', '7fd'),
    exact: true
  },
  {
    path: '/blog/archive',
    component: ComponentCreator('/blog/archive', '182'),
    exact: true
  },
  {
    path: '/blog/authors',
    component: ComponentCreator('/blog/authors', '0b7'),
    exact: true
  },
  {
    path: '/blog/tags',
    component: ComponentCreator('/blog/tags', '287'),
    exact: true
  },
  {
    path: '/blog/tags/announcement',
    component: ComponentCreator('/blog/tags/announcement', '5dd'),
    exact: true
  },
  {
    path: '/blog/tags/getting-started',
    component: ComponentCreator('/blog/tags/getting-started', 'caa'),
    exact: true
  },
  {
    path: '/blog/tags/roadmap',
    component: ComponentCreator('/blog/tags/roadmap', '0c0'),
    exact: true
  },
  {
    path: '/blog/welcome-to-alpacabitollama',
    component: ComponentCreator('/blog/welcome-to-alpacabitollama', '552'),
    exact: true
  },
  {
    path: '/docs',
    component: ComponentCreator('/docs', '020'),
    routes: [
      {
        path: '/docs',
        component: ComponentCreator('/docs', '118'),
        routes: [
          {
            path: '/docs',
            component: ComponentCreator('/docs', '265'),
            routes: [
              {
                path: '/docs/advanced/deployment',
                component: ComponentCreator('/docs/advanced/deployment', '5f5'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/advanced/faq',
                component: ComponentCreator('/docs/advanced/faq', '2e4'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/advanced/performance-tuning',
                component: ComponentCreator('/docs/advanced/performance-tuning', '3b7'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/advanced/security',
                component: ComponentCreator('/docs/advanced/security', 'cac'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/advanced/troubleshooting',
                component: ComponentCreator('/docs/advanced/troubleshooting', '974'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/agentic/creating-agents',
                component: ComponentCreator('/docs/agentic/creating-agents', '8e1'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/agentic/creating-skills',
                component: ComponentCreator('/docs/agentic/creating-skills', '2cb'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/agentic/creating-tools',
                component: ComponentCreator('/docs/agentic/creating-tools', '7c5'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/agentic/multi-agent-architecture',
                component: ComponentCreator('/docs/agentic/multi-agent-architecture', 'b38'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/agentic/overview',
                component: ComponentCreator('/docs/agentic/overview', '6b7'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/agentic/spec-driven-development',
                component: ComponentCreator('/docs/agentic/spec-driven-development', '7aa'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/agentic/subagent-delegation',
                component: ComponentCreator('/docs/agentic/subagent-delegation', '468'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/anthropic',
                component: ComponentCreator('/docs/api-management/anthropic', '0d3'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/azure-foundry',
                component: ComponentCreator('/docs/api-management/azure-foundry', '17b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/custom-endpoints',
                component: ComponentCreator('/docs/api-management/custom-endpoints', '36b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/google',
                component: ComponentCreator('/docs/api-management/google', '660'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/key-management',
                component: ComponentCreator('/docs/api-management/key-management', '5ec'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/lm-studio',
                component: ComponentCreator('/docs/api-management/lm-studio', 'a64'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/mistral',
                component: ComponentCreator('/docs/api-management/mistral', 'a7f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/ollama',
                component: ComponentCreator('/docs/api-management/ollama', '59b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/open-router',
                component: ComponentCreator('/docs/api-management/open-router', '436'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/openai',
                component: ComponentCreator('/docs/api-management/openai', 'b6f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/overview',
                component: ComponentCreator('/docs/api-management/overview', '952'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api-management/providers',
                component: ComponentCreator('/docs/api-management/providers', '87f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api/authentication',
                component: ComponentCreator('/docs/api/authentication', '733'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api/ipc-channels',
                component: ComponentCreator('/docs/api/ipc-channels', 'e6e'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api/rate-limiting',
                component: ComponentCreator('/docs/api/rate-limiting', '2c2'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api/rest-api',
                component: ComponentCreator('/docs/api/rest-api', 'cbc'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/api/websocket',
                component: ComponentCreator('/docs/api/websocket', '2e7'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/desktop/app-menu',
                component: ComponentCreator('/docs/desktop/app-menu', '6d7'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/desktop/documentation-viewer',
                component: ComponentCreator('/docs/desktop/documentation-viewer', '07e'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/desktop/keyboard-shortcuts',
                component: ComponentCreator('/docs/desktop/keyboard-shortcuts', '737'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/desktop/system-tray',
                component: ComponentCreator('/docs/desktop/system-tray', '7a2'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/desktop/updater',
                component: ComponentCreator('/docs/desktop/updater', '0e9'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/development/architecture',
                component: ComponentCreator('/docs/development/architecture', '85a'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/development/build-system',
                component: ComponentCreator('/docs/development/build-system', 'cb5'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/development/contributing',
                component: ComponentCreator('/docs/development/contributing', '98b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/development/debugging',
                component: ComponentCreator('/docs/development/debugging', '4d5'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/development/testing',
                component: ComponentCreator('/docs/development/testing', 'cf3'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/getting-started/',
                component: ComponentCreator('/docs/getting-started/', '474'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/getting-started/configuration',
                component: ComponentCreator('/docs/getting-started/configuration', '468'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/getting-started/installation',
                component: ComponentCreator('/docs/getting-started/installation', '267'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/getting-started/quickstart',
                component: ComponentCreator('/docs/getting-started/quickstart', '1cd'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/ide/cursor-integration',
                component: ComponentCreator('/docs/ide/cursor-integration', '694'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/ide/keyboard-shortcuts',
                component: ComponentCreator('/docs/ide/keyboard-shortcuts', '5c1'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/ide/project-awareness',
                component: ComponentCreator('/docs/ide/project-awareness', '284'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/ide/vscode-integration',
                component: ComponentCreator('/docs/ide/vscode-integration', '72a'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/rag/adding-documents',
                component: ComponentCreator('/docs/rag/adding-documents', '7f7'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/rag/querying',
                component: ComponentCreator('/docs/rag/querying', 'c3a'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/rag/vector-stores',
                component: ComponentCreator('/docs/rag/vector-stores', '7f3'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/roadmap',
                component: ComponentCreator('/docs/roadmap', 'ced'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/user-guide/chat-interface',
                component: ComponentCreator('/docs/user-guide/chat-interface', 'df5'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/user-guide/model-management',
                component: ComponentCreator('/docs/user-guide/model-management', '5b4'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/user-guide/settings',
                component: ComponentCreator('/docs/user-guide/settings', 'aea'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/workspace/context-isolation',
                component: ComponentCreator('/docs/workspace/context-isolation', '4d4'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/workspace/file-operations',
                component: ComponentCreator('/docs/workspace/file-operations', '22a'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/workspace/memory-system',
                component: ComponentCreator('/docs/workspace/memory-system', '99e'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/docs/workspace/project-structure',
                component: ComponentCreator('/docs/workspace/project-structure', 'aab'),
                exact: true,
                sidebar: "tutorialSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/',
    component: ComponentCreator('/', '2bc'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
