export type { Property, CreatePropertyDto, UpdatePropertyDto } from '@rentai/shared';

export interface KbEntry {
  id: string;
  propertyId: string;
  title: string;
  content: string;
  category?: string;
  status: 'active' | 'pending' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export type KbCategory =
  | 'checkin'
  | 'wifi'
  | 'rules'
  | 'location'
  | 'neighborhood'
  | 'parking'
  | 'equipment'
  | 'services'
  | 'contacts'
  | 'safety'
  | 'waste'
  | 'pets'
  | 'family'
  | 'quiet'
  | 'other';
