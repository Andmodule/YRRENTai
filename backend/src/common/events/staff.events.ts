export class StaffRepliedEvent {
  constructor(
    public readonly propertyId: string,
    public readonly messageId: string,
    public readonly content: string,
    public readonly createdAt: string,
    public readonly conversationId?: string,
  ) {}
}
