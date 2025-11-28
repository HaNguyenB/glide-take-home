import valid from "card-validator";

export type CardValidationResult =
  | {
      isValid: true;
      brand: string;
      normalized: string;
    }
  | {
      isValid: false;
      brand: string;
      message: string;
    };

const DIGIT_STRIPPER = /[\s-]/g;

export function validateCardNumber(raw: string): CardValidationResult {
  const normalized = raw.replace(DIGIT_STRIPPER, "");
  const validation = valid.number(normalized);
  const brand = validation.card?.niceType ?? "card";

  if (!validation.isPotentiallyValid || !validation.isValid) {
    const brandLabel = brand === "card" ? "card" : `${brand.toLowerCase()} card`;
    return {
      isValid: false,
      brand,
      message: `Invalid ${brandLabel} number`,
    };
  }

  return {
    isValid: true,
    brand,
    normalized,
  };
}

