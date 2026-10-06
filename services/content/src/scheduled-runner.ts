import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';

type ScheduledStore = {
  nextScheduledAt(): Promise<Date | null>;
  publishDue(limit: number): Promise<{ published: number }>;
};

const MAX_TIMER_MS = 2_147_483_647;
export const scheduledDelay = (dueAt: Date, now = Date.now()) => Math.max(100, Math.min(dueAt.getTime() - now, MAX_TIMER_MS));

@Injectable()
export class ScheduledPostRunner implements OnModuleInit, OnModuleDestroy {
  private listener?: Client;
  private timer?: NodeJS.Timeout;
  private retry?: NodeJS.Timeout;
  private closed = false;
  private generation = 0;
  private connecting = false;

  constructor(private readonly store: ScheduledStore, private readonly databaseUrl: string) {}

  onModuleInit() { void this.connect(); }

  private async connect() {
    if (this.closed || this.connecting || this.listener) return;
    this.connecting = true;
    const client = new Client({ connectionString: this.databaseUrl, connectionTimeoutMillis: 3_000 });
    try {
      await client.connect();
      await client.query('LISTEN schoolconnect_post_schedule');
      if (this.closed) { await client.end(); return; }
      this.listener = client;
      client.on('notification', () => { void this.reschedule(); });
      client.on('error', (error) => this.reconnect(error));
      client.on('end', () => this.reconnect(new Error('SCHEDULE_LISTENER_ENDED')));
      await this.reschedule();
    } catch (error) {
      console.error('scheduled-listener-failed', error instanceof Error ? error.message : error);
      await client.end().catch(() => undefined);
      this.retryConnect();
    } finally { this.connecting = false; }
  }

  private reconnect(error: unknown) {
    if (this.closed || !this.listener) return;
    console.error('scheduled-listener-disconnected', error instanceof Error ? error.message : error);
    const previous = this.listener;
    this.listener = undefined;
    void previous.end().catch(() => undefined);
    if (this.timer) clearTimeout(this.timer);
    this.retryConnect();
  }

  private retryConnect() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, 5_000);
  }

  private async reschedule() {
    const generation = ++this.generation;
    try {
      const next = await this.store.nextScheduledAt();
      if (this.closed || generation !== this.generation) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = next ? setTimeout(() => { void this.runDue(); }, scheduledDelay(next)) : undefined;
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      console.error('scheduled-query-failed', error instanceof Error ? error.message : error);
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.reschedule(); }, 5_000);
    }
  }

  private async runDue() {
    try {
      let batch: { published: number };
      do { batch = await this.store.publishDue(25); } while (batch.published === 25 && !this.closed);
      await this.reschedule();
    } catch (error) {
      console.error('scheduled-publish-failed', error instanceof Error ? error.message : error);
      this.timer = setTimeout(() => { void this.runDue(); }, 5_000);
    }
  }

  async onModuleDestroy() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearTimeout(this.retry);
    await this.listener?.end().catch(() => undefined);
  }
}
