/**
 * Ad channels pulled from Triple Whale. Each is stored in ad_spend.channel under its Triple Whale name.
 * Google is limited to video campaign types: Search / Shopping / Display ads have no editor creatives,
 * so including them would only flood "Needs review".
 */
export type ChannelId = 'meta' | 'google';
export type ChannelView = ChannelId | 'all';

export type Channel = {
  id: ChannelId;
  label: string;
  /** Triple Whale `channel` value */
  tw: string;
  /** Only these campaign_type values (null = all) */
  campaignTypes: string[] | null;
  /** Prefix for stored ad ids, so ids from different platforms can never collide */
  adIdPrefix: string;
};

export const CHANNELS: Channel[] = [
  { id: 'meta', label: 'Meta', tw: process.env.TRIPLEWHALE_CHANNEL ?? 'facebook-ads', campaignTypes: null, adIdPrefix: '' },
  { id: 'google', label: 'Google', tw: 'google-ads', campaignTypes: ['DEMAND_GEN', 'VIDEO'], adIdPrefix: 'g:' },
];

export const VIEWS: { id: ChannelView; label: string }[] = [
  { id: 'meta', label: 'Meta' },
  { id: 'google', label: 'Google' },
  { id: 'all', label: 'All' },
];

export const isView = (v: unknown): v is ChannelView => v === 'meta' || v === 'google' || v === 'all';

/** Triple Whale channel names included in a view (null = every channel) */
export function viewChannels(view: ChannelView): string[] | null {
  return view === 'all' ? null : CHANNELS.filter(c => c.id === view).map(c => c.tw);
}

/**
 * Snapshot keys per view. Meta keeps the plain editor key (the format used before Google was added),
 * other views are prefixed, e.g. "google|u:123".
 */
export const snapPrefix = (view: ChannelView) => (view === 'meta' ? '' : `${view}|`);

export const viewLabel = (view: ChannelView) => VIEWS.find(v => v.id === view)?.label ?? view;
