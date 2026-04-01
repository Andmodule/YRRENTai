export class IncidentManagerNoteEvent {
  constructor(
    public readonly incidentId: string,
    public readonly text: string,
    public readonly reportedByUserId: string,
  ) {}
}
