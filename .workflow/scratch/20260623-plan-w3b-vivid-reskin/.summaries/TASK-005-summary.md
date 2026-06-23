# TASK-005 install+error 换皮
- ConsoleOutputRenderer: sectionBar/tree/grid + 左竖条 error 块;OutputRenderer 接口字节不变(types.ts diff 空)。buildStepLine/buildSummaryBlock/buildErrorBlock 纯函数 + NO_COLOR snapshot 绿。running/pending 用 [..]/[--]。
