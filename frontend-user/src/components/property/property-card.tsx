'use client';

import { Building2, MapPin, Users, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { Property } from '@/types';
import { formatPropertyLocation } from '@/lib/format/property-location';

interface PropertyCardProps {
  property: Property;
}

export function PropertyCard({ property }: PropertyCardProps) {
  return (
    <Link
      href={`/properties/${property.id}`}
      className="group flex flex-col rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="truncate font-semibold group-hover:text-primary transition-colors">
            {property.name}
          </h3>
          <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{formatPropertyLocation(property)}</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
          {property.currency}
        </span>
      </div>

      <div className="flex items-center gap-4 border-t px-5 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          <span>{property.timezone}</span>
        </div>
        {property.maxGuests && (
          <div className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            <span>{property.maxGuests}</span>
          </div>
        )}
      </div>
    </Link>
  );
}
