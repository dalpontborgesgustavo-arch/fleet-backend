const STALE_RUN_MINUTES = 15;

type SyncRunClient = {
  usinaSyncRun: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function expireStaleUsinaSyncRuns(
  prisma: SyncRunClient,
  datasets: readonly string[],
  now = new Date(),
) {
  const staleBefore = new Date(now.getTime() - STALE_RUN_MINUTES * 60_000);
  return prisma.usinaSyncRun.updateMany({
    where: {
      dataset: { in: [...datasets] },
      status: 'IN_PROGRESS',
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: 'FAILED',
      completedAt: null,
      failedAt: now,
      failureReason: `Run expirado apos ${STALE_RUN_MINUTES} minutos sem novo lote`,
    },
  });
}

export { STALE_RUN_MINUTES };
