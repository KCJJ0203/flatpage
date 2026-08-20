/**
 * A queue of photos waiting to be cropped.
 *
 * This holds Files, not decoded images. Ten photos from an iPhone are ten
 * 12-megapixel JPEGs; decoding them all up front would be roughly half a
 * gigabyte of bitmap resident at once, which is exactly how Safari kills a tab.
 * Files are cheap handles, so the queue stays small and each photo is decoded
 * only when its turn comes.
 *
 * The single-photo camera path uses an empty batch rather than a special case:
 * `label()` returns null below a count of two, so nothing about the one-page
 * flow changes.
 */
export function createBatch(items = []) {
  const pending = [...items];
  const total = pending.length;
  let taken = 0;

  return {
    /** How many photos this batch started with. */
    total: () => total,
    /** How many have been handed out so far. */
    taken: () => taken,
    /** How many are still waiting. */
    remaining: () => pending.length,

    /** The next photo, or null when the queue is empty. */
    next() {
      if (pending.length === 0) return null;
      taken++;
      return pending.shift();
    },

    /** Abandon the rest of the batch. */
    clear() {
      pending.length = 0;
    },

    /**
     * Progress text, or null when there is no batch worth reporting.
     *
     * Reads as the photo currently in hand: after the first next() on a batch
     * of seven this is "Page 1 of 7", not "Page 0 of 7" or "6 remaining".
     */
    label() {
      if (total < 2) return null;
      return `Page ${Math.max(1, taken)} of ${total}`;
    },
  };
}
