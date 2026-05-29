/**
 * Category → in-app type bridge.
 *
 * Categories (preferences.ts) are the *routing* unit — what a user toggles per
 * channel. In-app `type`s (types.ts) are the *render* unit — the icon/color in
 * the bell. The mapping is intentionally many-to-one: both deal buckets render
 * as `deal-alert`, since the in-app body already distinguishes an individual
 * alert from a digest summary.
 *
 * The Discord side needs no map here — each call site passes its own thunk
 * wrapping the appropriate client function (sendPriceAlert, sendAtlDigest,
 * sendReleaseNotification, sendOperationalAlert, …).
 */
import type { NotificationCategory } from './preferences';
import type { NotificationType } from './types';

export type { NotificationCategory } from './preferences';

const CATEGORY_TO_IN_APP_TYPE: Record<NotificationCategory, NotificationType> = {
  'deal-individual': 'deal-alert',
  'deal-digest': 'deal-alert',
  release: 'release',
  milestone: 'milestone',
  system: 'system',
};

export function categoryToInAppType(category: NotificationCategory): NotificationType {
  return CATEGORY_TO_IN_APP_TYPE[category];
}
