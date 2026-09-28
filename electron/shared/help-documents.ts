export const helpDocumentMetadata = [
  { id: 'workflow', title: '工作流使用指南', description: '组件分类与用法、输出内容、变量引用、人工确认、结束范围和错误排查。' },
  { id: 'plugins', title: '插件编辑与使用指南', description: '新建插件、编辑配置与 Python、保存生效、工具测试、对话调用和常见问题。' },
] as const

export type HelpDocumentId = typeof helpDocumentMetadata[number]['id']
