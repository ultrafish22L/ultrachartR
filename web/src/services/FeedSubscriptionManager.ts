/**
 * FeedSubscriptionManager - Singleton that manages shared SSE feeds.
 *
 * Multiple charts using the same cachePath share a single EventSource.
 * The first subscriber opens the connection, last unsubscribe closes it.
 */
import { IBService } from './IBService';
import { OHLCVBar } from '../types/chart';
import { log } from './Logger';

export interface FeedCallbacks {
  onTick: (bar: OHLCVBar) => void;
  onBar: (bar: OHLCVBar) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (msg: string) => void;
}

interface FeedEntry {
  cachePath: string;
  unsubscribe: (() => void) | null;
  subscribers: Map<string, FeedCallbacks>;
  connected: boolean;
}

class FeedSubscriptionManagerImpl {
  private feeds = new Map<string, FeedEntry>();

  /**
   * Subscribe to a feed. Returns an unsubscribe function.
   * @param cachePath - The cache file path (feed key)
   * @param subscriberId - Unique ID for this subscriber (e.g., chart ID)
   * @param callbacks - Event callbacks
   */
  subscribe(cachePath: string, subscriberId: string, callbacks: FeedCallbacks): () => void {
    let entry = this.feeds.get(cachePath);

    if (!entry) {
      entry = {
        cachePath,
        unsubscribe: null,
        subscribers: new Map(),
        connected: false,
      };
      this.feeds.set(cachePath, entry);
    }

    // Add subscriber
    entry.subscribers.set(subscriberId, callbacks);

    // If this is the first subscriber, start the SSE connection
    if (entry.subscribers.size === 1 && !entry.unsubscribe) {
      this.startFeed(entry);
    } else if (entry.connected) {
      // Already connected — notify new subscriber immediately
      callbacks.onConnected();
    }

    // Return cleanup function
    return () => {
      this.unsubscribe(cachePath, subscriberId);
    };
  }

  private async startFeed(entry: FeedEntry): Promise<void> {
    try {
      // Tell bridge to start the TWS subscription
      await IBService.startFeed(entry.cachePath);
    } catch (err) {
      log.error('FeedManager', `Failed to start feed: ${err}`);
      // Notify all subscribers of error
      for (const cb of entry.subscribers.values()) {
        cb.onError(`Failed to start feed: ${err}`);
      }
      return;
    }

    // Guard: entry may have been removed during the async gap
    if (!this.feeds.has(entry.cachePath) || entry.subscribers.size === 0) {
      IBService.stopFeed(entry.cachePath).catch(() => {});
      return;
    }

    // Open SSE stream — guard callbacks against stale entry
    const unsub = IBService.subscribeFeed(entry.cachePath, {
      onTick: (bar) => {
        if (entry.subscribers.size === 0) return;
        for (const cb of entry.subscribers.values()) {
          cb.onTick(bar);
        }
      },
      onBar: (bar) => {
        if (entry.subscribers.size === 0) return;
        for (const cb of entry.subscribers.values()) {
          cb.onBar(bar);
        }
      },
      onConnected: () => {
        entry.connected = true;
        for (const cb of entry.subscribers.values()) {
          cb.onConnected();
        }
      },
      onDisconnected: () => {
        entry.connected = false;
        for (const cb of entry.subscribers.values()) {
          cb.onDisconnected();
        }
      },
      onError: (msg) => {
        for (const cb of entry.subscribers.values()) {
          cb.onError(msg);
        }
      },
    });

    entry.unsubscribe = unsub;
  }

  private unsubscribe(cachePath: string, subscriberId: string): void {
    const entry = this.feeds.get(cachePath);
    if (!entry) return;

    entry.subscribers.delete(subscriberId);

    // If no subscribers left, close the SSE and stop the feed
    if (entry.subscribers.size === 0) {
      if (entry.unsubscribe) {
        entry.unsubscribe();
        entry.unsubscribe = null;
      }
      entry.connected = false;
      this.feeds.delete(cachePath);

      // Tell bridge to stop the TWS subscription
      IBService.stopFeed(cachePath).catch((err) => {
        log.error('FeedManager', `Failed to stop feed: ${err}`);
      });
    }
  }

  /** Check if a feed is currently connected */
  isConnected(cachePath: string): boolean {
    return this.feeds.get(cachePath)?.connected ?? false;
  }

  /** Get subscriber count for a feed */
  getSubscriberCount(cachePath: string): number {
    return this.feeds.get(cachePath)?.subscribers.size ?? 0;
  }
}

export const FeedSubscriptionManager = new FeedSubscriptionManagerImpl();
