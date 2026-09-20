import {reactive} from 'vue'
import type {StudioImage} from '../../electron/shared/local-ai-studio'

// Keep queues scoped to their conversation when the workspace view is remounted.
export const messageQueues=reactive<Record<string,{paused:boolean;items:{id:string;text:string;images:StudioImage[]}[]}>>({})
