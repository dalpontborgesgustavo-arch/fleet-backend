export class RncCorrectiveActionDto {
  description!: string;
  responsibleUserId!: string;
  dueDate?: string | null;
  situation?: string;
}

export class SubmitRncResponsibleActionDto {
  nonConformityAnalysis!: string;
  similarNonconformities!: boolean;
  similarNonconformitiesComment?: string | null;
  needsCorrectiveActionPlan!: boolean;
  causeAnalysisResponsibleUserId?: string | null;
}

export class SubmitRncCauseAnalysisDto {
  causeInvestigation?: string | null;
  identifiedCauses?: string | null;
  rootCause!: string;
  fishbone?: Record<string, unknown> | null;
  fiveWhys?: unknown[] | null;
  correctiveActions?: RncCorrectiveActionDto[];
}
