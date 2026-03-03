export class CreateChecklistItemDto {
  label!: string;
  ok!: boolean;
}

export class CreateChecklistDto {
  title!: string;
  items?: CreateChecklistItemDto[];
}