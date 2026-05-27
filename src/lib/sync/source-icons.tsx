/**
 * Per-source lucide icon registry.
 *
 * Kept separate from sources.ts so the server-side registry stays free of
 * React component imports.
 */

import {
  Library,
  Heart,
  DollarSign,
  History,
  Database,
  Clock,
  Star,
  RefreshCw,
  Rocket,
  Bell,
  HardDrive,
  Activity,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const SOURCE_ICONS: Record<string, LucideIcon> = {
  steam_library: Library,
  steam_wishlist: Heart,
  itad_prices: DollarSign,
  itad_history: History,
  'price-history-backfill': History,
  'price-history-prime': Zap,
  hltb: Clock,
  reviews: Star,
  metadata_refresh: RefreshCw,
  release_check: Rocket,
  alert_check: Bell,
  backup: HardDrive,
  health_summary: Activity,
  database_backup: Database,
};

export function iconForSource(key: string): LucideIcon {
  return SOURCE_ICONS[key] ?? Database;
}
