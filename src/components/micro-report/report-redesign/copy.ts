/**
 * V1 Cockpit exec-summary phrases. These render as chrome around the LLM
 * narrative; the data is baked in by the normalizer, so copy here is
 * deterministic and templated.
 *
 * Each helper returns a string with `<b>...</b>` wrappers around the
 * numeric pivots so the Cockpit can render via dangerouslySetInnerHTML
 * with only <b> allowed (sanitized in the view).
 */
export const heroCopy = {
  leaderVerdict: (host: string, spend: string, sov: string, delta: string, runnerUp: string) =>
    `<b>${host}</b> leads the benchmark with <b>${spend}</b> in measured spend — <b>${sov} share</b>, ${delta} ahead of <b>${runnerUp}</b>.`,
  rankVerdict: (
    host: string,
    rank: number,
    total: number,
    spend: string,
    sov: string,
    delta: string,
    leader: string,
  ) =>
    `<b>${host}</b> sits <b>#${rank}</b> of ${total} measured advertisers with ${spend} (<b>${sov} share</b>) — <b>${delta}</b> behind <b>${leader}</b>.`,
  channelSplit: (topChannel: string, pct: string, otherCount: number) =>
    `Spend concentrates in <b>${topChannel}</b> (${pct})${
      otherCount > 0
        ? `, with ${otherCount} other channel group${otherCount === 1 ? '' : 's'} active`
        : ''
    }.`,
  blendedCtr: (ctr: string, clicks: string, clickedImpressions: string) =>
    `Blended click-through across measurable campaigns is <b>${ctr}</b> — ${clicks} estimated clicks from ${clickedImpressions} impressions.`,
  creativeWindow: (count: number, videoPct: string, days: number | null) =>
    `${count} active creative${count === 1 ? '' : 's'} (${videoPct} video)${
      days != null ? ` across a ${days}-day in-market window` : ''
    }.`,
};
