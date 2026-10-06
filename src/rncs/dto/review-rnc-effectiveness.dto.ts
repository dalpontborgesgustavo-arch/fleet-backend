export class ReviewRncEffectivenessDto {
  actionsEffective!: boolean;
  actionsEffectiveNotes?: string | null;
  requiresDocumentChange!: boolean;
  requiresDocumentChangeNotes?: string | null;
  requiresRiskReview!: boolean;
  requiresRiskReviewNotes?: string | null;
}
