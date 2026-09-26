// This immutable bootstrap remains available even after a faulty hot update.
export const baselineCode = `function process(input) {
  let goalMessageId = null, constraintMessageIds = [], amendmentMessageIds = [];
  let intent = 'new_task';
  for (const message of input.messages) {
    const text = message.text.trim();
    const clean = text.replace(/[。！!？?\\s]+$/g, '').toLowerCase();
    if (/^(取消|停止|不用做了|停止任务|取消任务|cancel|stop)$/.test(clean)) intent = 'cancel';
    else if (/^(继续|继续吧|接着做|继续执行|continue|resume)$/.test(clean)) intent = 'continue';
    else if (/^(做到哪了|进度如何|现在进度|进度|status|progress)$/.test(clean)) intent = 'progress';
    else if (/^(新任务|换个任务|另外一个任务|new task)[:：\\s]/i.test(text)) {
      intent = 'new_task'; goalMessageId = message.id; constraintMessageIds = []; amendmentMessageIds = [];
    } else if (/^(改成|换成|更正|纠正|不是|日期改为|change to|actually)/i.test(text)) {
      intent = 'correction'; amendmentMessageIds.push(message.id);
    } else if (/^(补充|另外|还要|请注意|要求|不要|不许|保持|注意|also|do not)/i.test(text)) {
      intent = 'supplement'; amendmentMessageIds.push(message.id);
    } else if (!goalMessageId) {
      intent = /[？?]$/.test(text) ? 'question' : 'new_task'; goalMessageId = message.id;
    } else { intent = 'supplement'; amendmentMessageIds.push(message.id); }
    if (!goalMessageId && !['cancel','continue','progress'].includes(intent)) goalMessageId = message.id;
    if (/不要|不得|不能|不修改|只读|必须|保留|不许|do not|must|read.only/i.test(text)) constraintMessageIds.push(message.id);
  }
  return {intent, goalMessageId, constraintMessageIds: [...new Set(constraintMessageIds)], amendmentMessageIds: [...new Set(amendmentMessageIds)]};
}`
