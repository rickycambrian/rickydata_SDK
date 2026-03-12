export const answerSheetKeys = {
  all: ['answer-sheets'] as const,
  match: (error: string) => [...answerSheetKeys.all, 'match', error] as const,
};
