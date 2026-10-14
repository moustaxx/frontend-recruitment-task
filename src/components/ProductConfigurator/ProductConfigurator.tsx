/**
 * ProductConfigurator Component
 *
 * The main configurator widget for customizing products.
 * This component handles all product configuration logic including:
 * - Option selection (dropdowns, colors, toggles)
 * - Quantity management
 * - Add-on selection
 * - Price calculation
 * - Draft saving/loading
 * - Share URL generation
 *
 * Author: Marcus (no longer with company)
 * Last updated: 2 weeks ago
 *
 * Known issues:
 * - "Some timing stuff with prices, meant to fix" - Marcus
 * - "Resize handler might have a leak" - Marcus
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  Product,
  ProductOption,
  AddOn,
  Configuration,
  PriceBreakdown,
  Draft,
  ValidationResult,
  ErrorCode,
} from './types';
import { ERROR_CODES } from './types';
import { usePriceCalculation } from '../../hooks/usePriceCalculation';
import {
  validateConfiguration,
  saveDraft,
  loadDraft,
  getAllDrafts,
  deleteDraft,
  encodeConfigurationToUrl,
  decodeConfigurationFromUrl,
  generatePreview,
} from '../../services/api';
import {
  formatPrice,
  getAppliedDiscountPercentage,
  getNextDiscountTier,
} from '../../utils/pricing';
import './styles.css';

interface ProductConfiguratorProps {
  product: Product;
  initialConfiguration?: Partial<Configuration>;
  onConfigurationChange?: (config: Configuration) => void;
  onAddToCart?: (config: Configuration, price: PriceBreakdown) => void;
  readOnly?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

const generateConfigId = (): string => {
  return `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const getDefaultSelections = (product: Product): Record<string, string | number | boolean> => {
  const selections: Record<string, string | number | boolean> = {};

  for (const option of product.options) {
    if (option.defaultValue !== undefined) {
      selections[option.id] = option.defaultValue;
    } else if (option.choices && option.choices.length > 0) {
      const firstAvailable = option.choices.find((c) => c.available);
      if (firstAvailable) {
        selections[option.id] = firstAvailable.value;
      }
    }
  }

  return selections;
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.PRICE_CALC_FAILED]:
    "We couldn't calculate the price. Change any option to try again, or contact support if it keeps happening.",
  [ERROR_CODES.VALIDATION_CONFLICT]:
    "Some of your selections can't be combined. Adjust them and try again.",
  [ERROR_CODES.NETWORK_TIMEOUT]:
    'The price is taking too long to load. Check your connection and try again.',
  [ERROR_CODES.INVALID_QUANTITY]: 'Please enter a valid quantity.',
  [ERROR_CODES.DEPENDENCY_MISSING]: "This add-on isn't available with your current selections.",
  [ERROR_CODES.UNKNOWN]:
    'Something went wrong. Please try again, or contact support if it keeps happening.',
};

const getErrorMessage = (code: string): string =>
  ERROR_MESSAGES[code as ErrorCode] ?? ERROR_MESSAGES[ERROR_CODES.UNKNOWN];

const isAddOnAvailable = (
  addOn: AddOn,
  selections: Record<string, string | number | boolean>,
): boolean => {
  if (!addOn.dependsOn) return true;

  const dependencyValue = selections[addOn.dependsOn.optionId];
  return dependencyValue === addOn.dependsOn.requiredValue;
};

const formatTimestamp = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleString();
};

const calculateColorColumns = (
  containerWidth: number,
  swatchSize: number = 36,
  gap: number = 8,
): number => {
  const columns = Math.floor((containerWidth + gap) / (swatchSize + gap));
  return Math.max(1, columns);
};

// ============================================================================
// Main Component
// ============================================================================

export const ProductConfigurator: React.FC<ProductConfiguratorProps> = ({
  product,
  initialConfiguration,
  onConfigurationChange,
  onAddToCart,
  readOnly = false,
}) => {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [urlConfiguration] = useState(() => {
    const encodedConfig = new URLSearchParams(window.location.search).get('config');
    return encodedConfig ? decodeConfigurationFromUrl(encodedConfig) : null;
  });

  const [selections, setSelections] = useState<Record<string, string | number | boolean>>(
    () =>
      urlConfiguration?.selections ||
      initialConfiguration?.selections ||
      getDefaultSelections(product),
  );

  const [selectedAddOns, setSelectedAddOns] = useState<string[]>(
    () => urlConfiguration?.addOns || initialConfiguration?.addOns || [],
  );

  const [quantity, setQuantity] = useState<number>(
    () => urlConfiguration?.quantity || initialConfiguration?.quantity || 1,
  );

  const [configId] = useState<string>(() => initialConfiguration?.id || generateConfigId());

  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [draftName, setDraftName] = useState('');

  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValid, setIsValid] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string>(product.imageUrl);

  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  // -------------------------------------------------------------------------
  // Derived State
  // -------------------------------------------------------------------------

  const baseConfig: Configuration = useMemo(
    () => ({
      id: configId,
      productId: product.id,
      selections,
      addOns: selectedAddOns,
      quantity,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    [configId, product.id, selections, selectedAddOns, quantity],
  );

  const currentConfig: Configuration = useMemo(
    () => ({ ...baseConfig, name: draftName || undefined }),
    [baseConfig, draftName],
  );

  const {
    price,
    formattedTotal,
    isLoading: isPriceLoading,
    error: priceError,
  } = usePriceCalculation(baseConfig, product);
  const errorCode = error || priceError;

  const appliedDiscount = getAppliedDiscountPercentage(quantity);
  const nextTier = getNextDiscountTier(quantity);

  const shareUrl = useMemo(() => {
    if (!showShareModal) return '';
    const encoded = encodeConfigurationToUrl(currentConfig);
    return `${window.location.origin}${window.location.pathname}?config=${encoded}`;
  }, [showShareModal, currentConfig]);

  const availableAddOns = useMemo(() => {
    const map = new Map<string, AddOn>();
    for (const addOn of product.addOns) {
      if (isAddOnAvailable(addOn, selections)) {
        map.set(addOn.id, addOn);
      }
    }
    return map;
  }, [product.addOns, selections]);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleResize = () => {
      if (colorPickerRef.current) {
        const width = colorPickerRef.current.offsetWidth;
        const cols = calculateColorColumns(width);
        colorPickerRef.current.style.setProperty('--color-columns', cols.toString());
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const validate = async () => {
      try {
        const result = await validateConfiguration(baseConfig, product);
        if (!cancelled) {
          setValidation(result);
          setIsValid(true);
        }
      } catch {
        if (!cancelled) setError(ERROR_CODES.UNKNOWN);
      }
    };

    validate();

    return () => {
      cancelled = true;
    };
  }, [baseConfig, product]);

  useEffect(() => {
    let cancelled = false;

    const updatePreview = async () => {
      try {
        const preview = await generatePreview(baseConfig, product);
        if (!cancelled) {
          setPreviewUrl(preview.imageUrl);
        }
      } catch {
        setPreviewUrl(product.imageUrl);
      }
    };

    updatePreview();

    return () => {
      cancelled = true;
    };
  }, [baseConfig, product]);

  useEffect(() => {
    if (onConfigurationChange) {
      onConfigurationChange(currentConfig);
    }
  }, [selections, selectedAddOns, quantity]);

  useEffect(() => {
    if (showDraftModal) {
      getAllDrafts().then(setDrafts);
    }
  }, [showDraftModal]);

  // -------------------------------------------------------------------------
  // Event Handlers
  // -------------------------------------------------------------------------

  const handleOptionChange = useCallback(
    (optionId: string, value: string | number | boolean) => {
      setSelections((prev) => ({
        ...prev,
        [optionId]: value,
      }));
      setIsDirty(true);

      // Clean up any dependent add-ons whose requirement is no longer met.
      const unmetAddOnIds = product.addOns
        .filter((a) => a.dependsOn?.optionId === optionId && value !== a.dependsOn.requiredValue)
        .map((a) => a.id);

      if (unmetAddOnIds.length > 0) {
        setSelectedAddOns((prev) => prev.filter((id) => !unmetAddOnIds.includes(id)));
      }
    },
    [product.addOns],
  );

  const handleAddOnToggle = useCallback(
    (addOnId: string) => {
      const addOn = product.addOns.find((a) => a.id === addOnId);
      if (!addOn) return;

      if (!isAddOnAvailable(addOn, selections)) {
        setError(ERROR_CODES.DEPENDENCY_MISSING);
        return;
      }

      setIsDirty(true);
      setSelectedAddOns((prev) => {
        if (prev.includes(addOnId)) {
          return prev.filter((id) => id !== addOnId);
        } else {
          return [...prev, addOnId];
        }
      });
    },
    [product.addOns, selections],
  );

  const handleQuantityChange = useCallback(
    (newQuantity: number) => {
      const quantityOption = product.options.find((o) => o.type === 'quantity');
      const min = quantityOption?.min ?? 1;
      const max = quantityOption?.max ?? 999;

      const clampedQuantity = Math.max(min, Math.min(max, newQuantity));
      setQuantity(clampedQuantity);
      setIsDirty(true);
    },
    [product.options],
  );

  const handleSaveDraft = useCallback(async () => {
    try {
      await saveDraft(currentConfig, draftName || 'Untitled Draft');
      setLastSaved(new Date());
      setIsDirty(false);
      setDraftName('');

      setShowDraftModal(false);
    } catch {
      setError(ERROR_CODES.UNKNOWN);
    }
  }, [currentConfig, draftName]);

  const handleLoadDraft = useCallback(async (draftId: string) => {
    try {
      const draft = await loadDraft(draftId);
      if (draft) {
        setSelections(draft.configuration.selections);
        setSelectedAddOns(draft.configuration.addOns);
        setQuantity(draft.configuration.quantity);
        setShowDraftModal(false);
        setIsDirty(false);
      }
    } catch {
      setError(ERROR_CODES.UNKNOWN);
    }
  }, []);

  const handleDeleteDraft = useCallback(async (draftId: string) => {
    try {
      await deleteDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    } catch {
      setError(ERROR_CODES.UNKNOWN);
    }
  }, []);

  const handleAddToCart = useCallback(() => {
    if (!validation?.valid) {
      setError(validation?.errors[0]?.code || ERROR_CODES.UNKNOWN);
      return;
    }

    if (price && onAddToCart) {
      onAddToCart(currentConfig, price);
    }
  }, [validation, price, currentConfig, onAddToCart]);

  const canQuickAdd = !readOnly && !!validation?.valid && !isPriceLoading;

  const handleQuickAdd = useCallback(() => {
    if (canQuickAdd && price && onAddToCart) {
      onAddToCart(currentConfig, price);
    }
  }, [canQuickAdd, price, currentConfig, onAddToCart]);

  useEffect(() => {
    if (showDraftModal || showShareModal) return;

    let pending = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        pending = true;
      }
    };

    // On release, so a held Enter can't dismiss a host alert; macOS skips Enter keyup under Cmd
    const handleKeyUp = (e: KeyboardEvent) => {
      if (pending && (e.key === 'Enter' || e.key === 'Meta')) {
        pending = false;
        handleQuickAdd();
      }
    };

    const handleBlur = () => {
      pending = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleQuickAdd, showDraftModal, showShareModal]);

  const handleCopyShareUrl = useCallback(() => {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {})
      .catch(() => {
        setError(ERROR_CODES.UNKNOWN);
      });
  }, [shareUrl]);

  const handleModalClose = useCallback((modalType: 'draft' | 'share') => {
    if (modalType === 'draft') {
      setShowDraftModal(false);
    } else {
      setShowShareModal(false);
    }
  }, []);

  const handleModalOpen = (e: React.MouseEvent<HTMLElement>, modalType: 'draft' | 'share') => {
    lastFocusedElement.current = e.currentTarget;
    if (modalType === 'draft') {
      setShowDraftModal(true);
    } else {
      setShowShareModal(true);
    }
  };

  useEffect(() => {
    if (!showDraftModal && !showShareModal) {
      lastFocusedElement.current?.focus();
      lastFocusedElement.current = null;
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDraftModal(false);
        setShowShareModal(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showDraftModal, showShareModal]);

  const handleSwatchKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    optionId: string,
    choices: NonNullable<ProductOption['choices']>,
    index: number,
  ) => {
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % choices.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + choices.length) % choices.length;
        break;
      default:
        return;
    }

    e.preventDefault();
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
    handleOptionChange(optionId, choices[next].value);
  };

  const handleDiscardChanges = useCallback(() => {
    setSelections(getDefaultSelections(product));
    setSelectedAddOns([]);
    setQuantity(1);
    setIsDirty(false);
  }, [product]);

  // -------------------------------------------------------------------------
  // Render Helpers
  // -------------------------------------------------------------------------

  const renderSelectOption = (option: ProductOption) => {
    const currentValue = selections[option.id] as string;

    return (
      <div className="option-group" key={option.id}>
        <label className="option-label" htmlFor={`option-${option.id}`}>
          {option.name}
          {option.required && <span className="required">*</span>}
        </label>
        <select
          id={`option-${option.id}`}
          className="option-select"
          value={currentValue || ''}
          onChange={(e) => handleOptionChange(option.id, e.target.value)}
          disabled={readOnly}
        >
          {option.choices?.map((choice) => (
            <option key={choice.id} value={choice.value} disabled={!choice.available}>
              {choice.label}
              {choice.priceModifier !== 0 &&
                ` (${choice.priceModifier > 0 ? '+' : ''}${formatPrice(choice.priceModifier, product.currency)})`}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const renderColorOption = (option: ProductOption) => {
    const currentValue = selections[option.id] as string;

    return (
      <div className="option-group" key={option.id}>
        <label className="option-label">
          {option.name}
          {option.required && <span className="required">*</span>}
        </label>
        <div
          className="color-picker"
          ref={colorPickerRef}
          role="radiogroup"
          aria-label={option.name}
        >
          {option.choices?.map((choice, index, choices) => (
            <button
              type="button"
              key={choice.id}
              className={`color-swatch ${currentValue === choice.value ? 'selected' : ''}`}
              style={{ backgroundColor: choice.colorHex }}
              onClick={() => handleOptionChange(option.id, choice.value)}
              onKeyDown={(e) => handleSwatchKeyDown(e, option.id, choices, index)}
              disabled={readOnly}
              title={choice.label}
              role="radio"
              aria-label={choice.label}
              aria-checked={currentValue === choice.value}
              tabIndex={
                currentValue === choice.value ||
                (index === 0 && !choices.some((c) => c.value === currentValue))
                  ? 0
                  : -1
              }
            />
          ))}
        </div>
      </div>
    );
  };

  const renderQuantityOption = (option: ProductOption) => {
    return (
      <div className="option-group" key={option.id}>
        <label className="option-label" htmlFor={`quantity-input`}>
          {option.name}
          {option.required && <span className="required">*</span>}
          {appliedDiscount > 0 && <span className="discount-badge">{appliedDiscount}% OFF</span>}
        </label>
        <div className="quantity-control">
          <button
            className="quantity-btn"
            onClick={() => handleQuantityChange(quantity - 1)}
            disabled={readOnly || quantity <= (option.min ?? 1)}
            aria-label="Decrease quantity"
          >
            −
          </button>
          <input
            id="quantity-input"
            type="number"
            className="quantity-input"
            value={quantity}
            onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
            min={option.min}
            max={option.max}
            disabled={readOnly}
          />
          <button
            className="quantity-btn"
            onClick={() => handleQuantityChange(quantity + 1)}
            disabled={readOnly || quantity >= (option.max ?? 999)}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        {nextTier && (
          <p className="next-discount-hint">
            Add {nextTier.needed} more for {nextTier.discount}% discount!
          </p>
        )}
      </div>
    );
  };

  const renderToggleOption = (option: ProductOption) => {
    const currentValue = selections[option.id] as boolean;

    return (
      <div className="option-group" key={option.id}>
        <div className="toggle-control">
          <div
            className={`toggle-switch ${currentValue ? 'active' : ''}`}
            onClick={() => !readOnly && handleOptionChange(option.id, !currentValue)}
            role="switch"
            aria-checked={currentValue}
            tabIndex={0}
            onKeyDown={(e) => {
              if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleOptionChange(option.id, !currentValue);
              }
            }}
          />
          <span className="toggle-label">{option.name}</span>
        </div>
      </div>
    );
  };

  const renderOption = (option: ProductOption) => {
    if (option.dependsOn) {
      const depValue = selections[option.dependsOn.optionId];
      if (depValue !== option.dependsOn.requiredValue) {
        return null;
      }
    }

    switch (option.type) {
      case 'select':
        return renderSelectOption(option);
      case 'color':
        return renderColorOption(option);
      case 'quantity':
        return renderQuantityOption(option);
      case 'toggle':
        return renderToggleOption(option);
      default:
        return null;
    }
  };

  const renderAddOn = (addOn: AddOn) => {
    const isSelected = selectedAddOns.includes(addOn.id);
    const isAvailable = isAddOnAvailable(addOn, selections);

    return (
      <div
        key={addOn.id}
        className={`addon-item ${isSelected ? 'selected' : ''} ${!isAvailable ? 'disabled' : ''}`}
        onClick={() => !readOnly && isAvailable && handleAddOnToggle(addOn.id)}
      >
        <input
          type="checkbox"
          className="addon-checkbox"
          checked={isSelected}
          onChange={() => {}}
          disabled={readOnly || !isAvailable}
        />
        <div className="addon-info">
          <div className="addon-name">{addOn.name}</div>
          <div className="addon-description">
            {addOn.description}
            {!isAvailable && addOn.dependsOn && (
              <span style={{ color: '#e74c3c' }}> (Requires {addOn.dependsOn.optionId})</span>
            )}
          </div>
        </div>
        <div className="addon-price">+{formatPrice(addOn.price, product.currency)}</div>
      </div>
    );
  };

  const renderPriceBreakdown = () => {
    if (!price) return null;

    return (
      <div className="price-breakdown">
        <div className="price-line">
          <span>Base price</span>
          <span>{formatPrice(price.basePrice, product.currency)}</span>
        </div>

        {price.optionModifiers.map((mod, i) => {
          const option = product.options.find((o) => o.id === mod.optionId);
          return (
            <div className="price-line" key={i}>
              <span>{option?.name || mod.optionId}</span>
              <span>
                {mod.amount >= 0 ? '+' : ''}
                {formatPrice(mod.amount, product.currency)}
              </span>
            </div>
          );
        })}

        {price.addOnCosts.map((cost, i) => {
          const addOn = product.addOns.find((a) => a.id === cost.addOnId);
          return (
            <div className="price-line" key={i}>
              <span>{addOn?.name || cost.addOnId}</span>
              <span>+{formatPrice(cost.amount, product.currency)}</span>
            </div>
          );
        })}

        {quantity > 1 && (
          <div className="price-line">
            <span>Quantity ({quantity}×)</span>
            <span>{formatPrice(price.subtotal, product.currency)}</span>
          </div>
        )}

        {price.quantityDiscount > 0 && (
          <div className="price-line discount">
            <span>Volume discount ({appliedDiscount}%)</span>
            <span>-{formatPrice(price.quantityDiscount, product.currency)}</span>
          </div>
        )}

        <div className="price-line total">
          <span>Total</span>
          <span>{formatPrice(price.total, product.currency)}</span>
        </div>
      </div>
    );
  };

  const renderDraftModal = () => {
    if (!showDraftModal) return null;

    return (
      <div className="modal-overlay" onClick={() => handleModalClose('draft')}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="draft-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h3 className="modal-title" id="draft-modal-title">
              Saved Drafts
            </h3>
            <button
              className="modal-close"
              onClick={() => handleModalClose('draft')}
              aria-label="Close modal"
              autoFocus
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            {drafts.length === 0 ? (
              <p>No saved drafts yet.</p>
            ) : (
              <ul className="draft-list">
                {drafts.map((draft) => (
                  <li key={draft.id} className="draft-list-item">
                    <div>
                      <div className="draft-item-name">{draft.name}</div>
                      <div className="draft-item-date">Saved: {formatTimestamp(draft.savedAt)}</div>
                    </div>
                    <div>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleLoadDraft(draft.id)}
                        style={{ marginRight: '8px' }}
                      >
                        Load
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteDraft(draft.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div
              style={{
                marginTop: '24px',
                paddingTop: '16px',
                borderTop: '1px solid #eee',
              }}
            >
              <h4>Save Current Configuration</h4>
              <input
                type="text"
                placeholder="Draft name (optional)"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  marginBottom: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                }}
              />
              <button className="btn btn-primary btn-block" onClick={handleSaveDraft}>
                Save Draft
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderShareModal = () => {
    if (!showShareModal) return null;

    return (
      <div className="modal-overlay" onClick={() => handleModalClose('share')}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h3 className="modal-title" id="share-modal-title">
              Share Configuration
            </h3>
            <button
              className="modal-close"
              onClick={() => handleModalClose('share')}
              aria-label="Close modal"
              autoFocus
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            <p>Copy this link to share your configuration:</p>
            <input
              type="text"
              className="share-url-input"
              value={shareUrl}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={() => handleModalClose('share')}>
              Close
            </button>
            <button className="btn btn-primary" onClick={handleCopyShareUrl}>
              Copy Link
            </button>
          </div>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Main Render
  // -------------------------------------------------------------------------

  return (
    <div className="configurator" ref={containerRef}>
      <div className="configurator-header">
        <div>
          <h1 className="configurator-title">{product.name}</h1>
          <p className="configurator-description">{product.description}</p>
        </div>
        <div className="configurator-actions">
          <button className="btn btn-secondary" onClick={(e) => handleModalOpen(e, 'draft')}>
            Drafts
          </button>
          <button className="btn btn-secondary" onClick={(e) => handleModalOpen(e, 'share')}>
            Share
          </button>
          {isDirty && (
            <button className="btn btn-danger" onClick={handleDiscardChanges}>
              Discard
            </button>
          )}
        </div>
      </div>

      {errorCode && <div className="error-message">{getErrorMessage(errorCode)}</div>}

      {validation?.warnings.map((warning, i) => (
        <div key={i} className="validation-warning">
          {warning.message}
        </div>
      ))}

      <div className="configurator-layout">
        <div className="options-section">
          {product.options.filter((opt) => opt.type !== 'quantity').map(renderOption)}

          {product.options.filter((opt) => opt.type === 'quantity').map(renderOption)}

          {product.addOns.length > 0 && (
            <div className="addons-section">
              <h3 className="addons-title">Add-ons</h3>
              {product.addOns.map(renderAddOn)}
            </div>
          )}
        </div>

        <div className="preview-panel">
          <div className="preview-image-container">
            <img src={previewUrl} alt={`${product.name} preview`} className="preview-image" />
          </div>

          <div className={`price-display ${isPriceLoading ? 'price-loading' : ''}`}>
            <div className="price-label">Total Price</div>
            <div className="price-value">{formattedTotal}</div>

            {renderPriceBreakdown()}

            <div className="validation-indicator">
              {isValid ? '✓ Configuration validated' : '⏳ Validating…'}
            </div>

            <div className="quick-add-section">
              <button
                className="quick-add-btn"
                onClick={handleQuickAdd}
                disabled={!canQuickAdd}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                ⚡ Quick Add to Cart <kbd>Ctrl+Enter</kbd>
              </button>
            </div>
          </div>

          <button
            className="btn btn-success btn-block"
            onClick={handleAddToCart}
            disabled={readOnly || !validation?.valid || isPriceLoading}
          >
            {isPriceLoading ? 'Calculating...' : 'Add to Cart'}
          </button>

          <div className="config-summary">
            <div className="config-summary-title">Your Configuration</div>
            {product.options
              .filter((opt) => opt.type !== 'quantity' && selections[opt.id])
              .map((opt) => {
                const value = selections[opt.id];
                let displayValue: string = String(value);

                if (opt.choices) {
                  const choice = opt.choices.find((c) => c.value === value);
                  displayValue = choice?.label || String(value);
                }

                return (
                  <div key={opt.id} className="config-summary-item">
                    <span>{opt.name}:</span>
                    <span>{displayValue}</span>
                  </div>
                );
              })}
            <div className="config-summary-item">
              <span>Quantity:</span>
              <span>{quantity}</span>
            </div>
            {selectedAddOns.length > 0 && (
              <div className="config-summary-item">
                <span>Add-ons ({selectedAddOns.length}):</span>
                <span>
                  {selectedAddOns
                    .flatMap((id) => {
                      const addOn = availableAddOns.get(id);
                      return addOn ? [formatPrice(addOn.price, product.currency)] : [];
                    })
                    .join(' + ')}
                </span>
              </div>
            )}
          </div>

          {lastSaved && (
            <div className="draft-section">
              <div className="draft-header">
                <span className="draft-title">Draft saved</span>
                <span className="draft-saved">Last saved: {lastSaved.toLocaleTimeString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {renderDraftModal()}
      {renderShareModal()}
    </div>
  );
};

export default ProductConfigurator;
