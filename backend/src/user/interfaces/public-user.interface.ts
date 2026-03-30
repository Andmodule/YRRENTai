export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  language: string;
  telegramChatId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
