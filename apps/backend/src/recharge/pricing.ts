import type { AppDeps } from '../types/app.js';
import type { PricingDoc } from '../types/domain.js';
import { paths } from '../store/types.js';
import { errors } from '../utils/errors.js';

export async function getPricing(deps: AppDeps): Promise<PricingDoc | null> {
  return deps.store.get<PricingDoc>(paths.pricing());
}

/** Integer paise for a quantity, using the admin-configured litre price. */
export function amountFor(quantityMl: number, pricePerLitrePaise: number): number {
  return Math.round((quantityMl * pricePerLitrePaise) / 1000);
}

export async function requirePricing(deps: AppDeps): Promise<PricingDoc> {
  const pricing = await getPricing(deps);
  if (!pricing) {
    throw errors.unavailable(
      'pricing_not_configured',
      'Recharge pricing has not been configured by an administrator yet.',
    );
  }
  return pricing;
}
