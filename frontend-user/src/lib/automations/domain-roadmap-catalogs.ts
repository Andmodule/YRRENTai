import type { AutomationRoadmapTemplate } from './automation-roadmap-template';

/** Guest lifecycle — roadmap only (no property rules API yet). */
export const GUEST_ROADMAP_TEMPLATES: readonly AutomationRoadmapTemplate[] = [
  {
    ruleKey: 'EARLY_CHECKIN_REQUEST',
    titleKey: 'roadmap.guests.earlyCheckin.title',
    descriptionKey: 'roadmap.guests.earlyCheckin.description',
    creatable: false,
  },
  {
    ruleKey: 'LATE_CHECKOUT_REQUEST',
    titleKey: 'roadmap.guests.lateCheckout.title',
    descriptionKey: 'roadmap.guests.lateCheckout.description',
    creatable: false,
  },
  {
    ruleKey: 'BOOKING_EXTENSION',
    titleKey: 'roadmap.guests.bookingExtension.title',
    descriptionKey: 'roadmap.guests.bookingExtension.description',
    creatable: false,
  },
  {
    ruleKey: 'GUEST_CANCELLATION',
    titleKey: 'roadmap.guests.cancellation.title',
    descriptionKey: 'roadmap.guests.cancellation.description',
    creatable: false,
  },
  {
    ruleKey: 'LUGGAGE_STORAGE',
    titleKey: 'roadmap.guests.luggageStorage.title',
    descriptionKey: 'roadmap.guests.luggageStorage.description',
    creatable: false,
  },
] as const;

export const SMART_HOME_ROADMAP_TEMPLATES: readonly AutomationRoadmapTemplate[] = [
  {
    ruleKey: 'SMARTLOCK_CODE_GEN',
    titleKey: 'roadmap.smartHome.codeGen.title',
    descriptionKey: 'roadmap.smartHome.codeGen.description',
    creatable: false,
  },
  {
    ruleKey: 'SMARTLOCK_ENTRY',
    titleKey: 'roadmap.smartHome.firstEntry.title',
    descriptionKey: 'roadmap.smartHome.firstEntry.description',
    creatable: false,
  },
  {
    ruleKey: 'NOISE_ALERT',
    titleKey: 'roadmap.smartHome.noiseAlert.title',
    descriptionKey: 'roadmap.smartHome.noiseAlert.description',
    creatable: false,
  },
  {
    ruleKey: 'AC_LEFT_ON',
    titleKey: 'roadmap.smartHome.acLeftOn.title',
    descriptionKey: 'roadmap.smartHome.acLeftOn.description',
    creatable: false,
  },
] as const;

export const REVENUE_ROADMAP_TEMPLATES: readonly AutomationRoadmapTemplate[] = [
  {
    ruleKey: 'DEPOSIT_REQUIRED',
    titleKey: 'roadmap.revenue.depositRequired.title',
    descriptionKey: 'roadmap.revenue.depositRequired.description',
    creatable: false,
  },
  {
    ruleKey: 'DEPOSIT_REFUND',
    titleKey: 'roadmap.revenue.depositRefund.title',
    descriptionKey: 'roadmap.revenue.depositRefund.description',
    creatable: false,
  },
  {
    ruleKey: 'UPSELL_OPPORTUNITY',
    titleKey: 'roadmap.revenue.upsell.title',
    descriptionKey: 'roadmap.revenue.upsell.description',
    creatable: false,
  },
  {
    ruleKey: 'PAYMENT_FAILED',
    titleKey: 'roadmap.revenue.paymentFailed.title',
    descriptionKey: 'roadmap.revenue.paymentFailed.description',
    creatable: false,
  },
] as const;

export const SUPPORT_ROADMAP_TEMPLATES: readonly AutomationRoadmapTemplate[] = [
  {
    ruleKey: 'REVIEW_REQUEST',
    titleKey: 'roadmap.support.reviewRequest.title',
    descriptionKey: 'roadmap.support.reviewRequest.description',
    creatable: false,
  },
  {
    ruleKey: 'BAD_REVIEW_DETECTED',
    titleKey: 'roadmap.support.badReview.title',
    descriptionKey: 'roadmap.support.badReview.description',
    creatable: false,
  },
  {
    ruleKey: 'FAQ_WIFI',
    titleKey: 'roadmap.support.faqWifi.title',
    descriptionKey: 'roadmap.support.faqWifi.description',
    creatable: false,
  },
  {
    ruleKey: 'FAQ_PARKING',
    titleKey: 'roadmap.support.faqParking.title',
    descriptionKey: 'roadmap.support.faqParking.description',
    creatable: false,
  },
  {
    ruleKey: 'FAQ_TRASH',
    titleKey: 'roadmap.support.faqTrash.title',
    descriptionKey: 'roadmap.support.faqTrash.description',
    creatable: false,
  },
  {
    ruleKey: 'FAQ_NEARBY_SHOPS',
    titleKey: 'roadmap.support.faqShops.title',
    descriptionKey: 'roadmap.support.faqShops.description',
    creatable: false,
  },
  {
    ruleKey: 'FAQ_APPLIANCE_GUIDE',
    titleKey: 'roadmap.support.faqAppliances.title',
    descriptionKey: 'roadmap.support.faqAppliances.description',
    creatable: false,
  },
] as const;
