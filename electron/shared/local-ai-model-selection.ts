import type {StudioRuntime} from './local-ai-studio.js'

/** Managed instance aliases expire when another model is loaded. */
export function currentModelSelection(selected:string,source:string,runtime?:Pick<StudioRuntime,'state'|'modelName'>):string{
 if(source!=='managed'||runtime?.state!=='running'||!runtime.modelName)return selected
 return !selected||/^myplane-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{2}$/i.test(selected)?runtime.modelName:selected
}
