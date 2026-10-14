// usePriceCalculation Hook
// Marcus: "This hook handles async price fetching. A bit janky but works."

import { useState, useEffect } from 'react';
import type {
  Configuration,
  Product,
  PriceBreakdown,
} from '../components/ProductConfigurator/types';
import { calculatePrice } from '../services/api';

interface UsePriceCalculationResult {
  price: PriceBreakdown | null;
  formattedTotal: string;
  isLoading: boolean;
  error: string | null;
}

type PriceInputs = Pick<Configuration, 'selections' | 'addOns' | 'quantity'>;

interface PriceResult {
  // The inputs this result was calculated for; used to derive isLoading.
  inputs: PriceInputs;
  price: PriceBreakdown | null;
  formattedTotal: string;
  error: string | null;
}

/**
 * Custom hook for managing price calculation
 */
export function usePriceCalculation(
  config: Configuration | null,
  product: Product,
): UsePriceCalculationResult {
  const [result, setResult] = useState<PriceResult | null>(null);

  useEffect(() => {
    if (!config) return;

    // Responses arrive out of order; only the request from the latest effect run may
    // update state. Earlier runs are flagged as ignored by their cleanup.
    let ignore = false;
    const inputs: PriceInputs = {
      selections: config.selections,
      addOns: config.addOns,
      quantity: config.quantity,
    };

    calculatePrice(config, product).then(
      (response) => {
        if (ignore) return;
        setResult({
          inputs,
          price: response.breakdown,
          formattedTotal: response.formattedTotal,
          error: null,
        });
      },
      () => {
        if (ignore) return;
        setResult((prev) => ({
          inputs,
          price: null,
          formattedTotal: prev?.formattedTotal ?? '$0.00',
          error: 'ERR_PRICE_CALC_FAILED',
        }));
      },
    );

    return () => {
      ignore = true;
    };
  }, [config, product]);

  if (!config) {
    return { price: null, formattedTotal: '$0.00', isLoading: false, error: null };
  }

  const isLoading =
    !result ||
    result.inputs.selections !== config.selections ||
    result.inputs.addOns !== config.addOns ||
    result.inputs.quantity !== config.quantity;

  return {
    price: result?.price ?? null,
    formattedTotal: result?.formattedTotal ?? '$0.00',
    isLoading,
    error: result?.error ?? null,
  };
}
