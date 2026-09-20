import 'vue'

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    window: Window
  }
}

export {}
