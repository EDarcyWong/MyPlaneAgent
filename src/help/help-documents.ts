import workflow from './workflow.md?raw'
import plugins from './plugins.md?raw'
import { helpDocumentMetadata } from '../../electron/shared/help-documents'

const contents = { workflow, plugins }
export const helpDocuments = helpDocumentMetadata.map(document => ({ ...document, content: contents[document.id] }))
