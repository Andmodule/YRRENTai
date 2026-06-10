export enum MessageDeliveryStatus {
  /** AI reply awaiting manager approval (not delivered to guest). */
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  SENT = 'SENT',
  ERROR = 'ERROR',
}
