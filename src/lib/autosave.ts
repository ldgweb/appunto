/** Saves the board shortly after each change, one save at a time. */

export type SaveStatus = 'saved' | 'pending' | 'failed' | 'blocked';

/** Pause in typing or drawing before a save. */
const DELAY_MS = 400;
/** Longest wait while changes keep coming, so a long burst of typing is
 *  saved along the way. */
const MAX_WAIT_MS = 2000;
const RETRY_MS = 3000;

export class AutoSave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  /** When the oldest unsaved change was made. */
  private dirtySince = 0;
  /** Off until the board on disk is in the page, so nothing typed before can
   *  replace it; blocked for good when that board must not be replaced. */
  private state: 'off' | 'on' | 'blocked' = 'off';
  private running: Promise<void> | null = null;
  private readonly write: () => Promise<void>;
  private readonly onStatus: (status: SaveStatus) => void;

  constructor(write: () => Promise<void>, onStatus: (status: SaveStatus) => void) {
    this.write = write;
    this.onStatus = onStatus;
  }

  /** The board on disk is loaded: changes are saved from now on. */
  start(): void {
    if (this.state === 'off') this.state = 'on';
  }

  /** Stops saving for the rest of the session, for example when the board on
   *  disk could not be read and must not be overwritten. */
  block(): void {
    this.state = 'blocked';
    clearTimeout(this.timer);
    this.onStatus('blocked');
  }

  /** The board changed: save after a short pause in typing or drawing. */
  touch(): void {
    if (this.state !== 'on') return;
    const now = Date.now();
    if (!this.dirty) this.dirtySince = now;
    this.dirty = true;
    this.onStatus('pending');
    this.schedule(Math.min(DELAY_MS, Math.max(0, this.dirtySince + MAX_WAIT_MS - now)));
  }

  /** Saves now if anything changed. Resolves once that save is done, or has
   *  failed and a retry is scheduled. Changes made meanwhile wait for the next
   *  save. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    while (this.running) await this.running;
    if (!this.dirty || this.state !== 'on') return;
    this.dirty = false;
    this.running = this.write().then(
      () => {
        if (!this.dirty && this.state === 'on') this.onStatus('saved');
      },
      () => {
        if (this.state !== 'on') return;
        if (!this.dirty) this.dirtySince = Date.now();
        this.dirty = true;
        this.onStatus('failed');
        this.schedule(RETRY_MS);
      },
    );
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }
}
