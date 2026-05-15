type CreditPeriodConfigSlim = {
  canonical_id: string;
  valid_from: Date;
  valid_to: Date | null;
};

export function canResolveCreditDays(params: {
  canonicalId: string;
  invoiceDate: Date;
  creditDaysOverride: number | null;
  entityDefaultDays: number | null;
  configs: CreditPeriodConfigSlim[];
}): boolean {
  if (params.creditDaysOverride !== null) return true;

  const hasConfig = params.configs.some(
    (c) =>
      c.canonical_id === params.canonicalId &&
      c.valid_from <= params.invoiceDate &&
      (c.valid_to === null || c.valid_to >= params.invoiceDate),
  );
  if (hasConfig) return true;

  if (params.entityDefaultDays !== null) return true;

  return false;
}
