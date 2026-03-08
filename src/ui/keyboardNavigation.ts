/**
 * Keyboard navigation utilities
 * Provides accessible keyboard interaction patterns for modals and lists
 */

/**
 * Check if an element is an input-type element that should consume key events
 */
function isInputElement(element: Element | null): boolean {
  if (!element) return false;
  const tagName = (element as HTMLElement).tagName?.toLowerCase();
  const inputType = (element as HTMLInputElement).type?.toLowerCase();

  if (tagName === 'textarea') return true;
  if (tagName === 'select') return true;
  if (tagName === 'input') {
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(inputType || '');
  }
  if ((element as HTMLElement).contentEditable === 'true') return true;

  return false;
}

/**
 * Add keyboard handlers for modal overlays (Escape to close, Enter to confirm)
 * @param overlay - The modal overlay element
 * @param onEscape - Callback when Escape is pressed
 * @param onEnter - Optional callback when Enter is pressed (on non-input elements)
 * @returns Cleanup function to remove event listeners
 */
export function addModalKeyboardHandlers(
  overlay: HTMLElement,
  onEscape: () => void,
  onEnter: (() => void) | null = null,
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    } else if (event.key === 'Enter' && onEnter) {
      const target = event.target as Element;
      if (!isInputElement(target)) {
        event.preventDefault();
        event.stopPropagation();
        onEnter();
      }
    }
  };

  overlay.addEventListener('keydown', handleKeyDown);

  return () => {
    overlay.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Make a list of items keyboard navigable with arrow keys and selection
 * @param items - Array of focusable item elements (or null)
 * @param onSelect - Callback when an item is selected (Enter, Space, or click)
 * @param initialFocusIndex - Index of item to focus initially
 * @returns Cleanup function to remove event listeners
 */
export function makeItemsKeyboardNavigable(
  items: HTMLElement[] | null,
  onSelect: (item: HTMLElement, index: number) => void,
  initialFocusIndex: number = 0,
): () => void {
  if (!items || items.length === 0) return () => {};

  // Clamp initial focus index to valid range
  const clampedIndex = Math.max(0, Math.min(initialFocusIndex, items.length - 1));
  let currentIndex = clampedIndex;

  // Set outline:none on all items immediately
  items.forEach((item) => {
    item.style.outline = 'none';
  });

  // Set tabindex synchronously for immediate accessibility
  items.forEach((item, index) => {
    item.setAttribute('tabindex', index === clampedIndex ? '0' : '-1');
  });

  // Focus asynchronously so callers can check after a tick
  setTimeout(() => {
    if (items[clampedIndex]) {
      items[clampedIndex].focus();
    }
  }, 0);

  const handleKeyDown = (event: KeyboardEvent): void => {
    // Determine which item fired the event
    const itemIndex = items.indexOf(event.currentTarget as HTMLElement);
    if (itemIndex !== -1) {
      currentIndex = itemIndex;
    }

    switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight': {
      event.preventDefault();
      if (currentIndex < items.length - 1) {
        items[currentIndex]?.setAttribute('tabindex', '-1');
        currentIndex += 1;
        items[currentIndex]?.setAttribute('tabindex', '0');
        items[currentIndex]?.focus();
      }
      break;
    }
    case 'ArrowUp':
    case 'ArrowLeft': {
      event.preventDefault();
      if (currentIndex > 0) {
        items[currentIndex]?.setAttribute('tabindex', '-1');
        currentIndex -= 1;
        items[currentIndex]?.setAttribute('tabindex', '0');
        items[currentIndex]?.focus();
      }
      break;
    }
    case 'Home': {
      event.preventDefault();
      items[currentIndex]?.setAttribute('tabindex', '-1');
      currentIndex = 0;
      items[currentIndex]?.setAttribute('tabindex', '0');
      items[currentIndex]?.focus();
      break;
    }
    case 'End': {
      event.preventDefault();
      const lastIndex = items.length - 1;
      items[currentIndex]?.setAttribute('tabindex', '-1');
      currentIndex = lastIndex;
      items[currentIndex]?.setAttribute('tabindex', '0');
      items[currentIndex]?.focus();
      break;
    }
    case 'Enter':
    case ' ': {
      event.preventDefault();
      event.stopPropagation();
      const currentItem = items[currentIndex];
      if (currentItem) {
        onSelect(currentItem, currentIndex);
      }
      break;
    }
    case 'Tab': {
      event.preventDefault();
      if (event.shiftKey) {
        if (currentIndex > 0) {
          items[currentIndex]?.setAttribute('tabindex', '-1');
          currentIndex -= 1;
          items[currentIndex]?.setAttribute('tabindex', '0');
          items[currentIndex]?.focus();
        }
      } else {
        if (currentIndex < items.length - 1) {
          items[currentIndex]?.setAttribute('tabindex', '-1');
          currentIndex += 1;
          items[currentIndex]?.setAttribute('tabindex', '0');
          items[currentIndex]?.focus();
        }
      }
      break;
    }
    default:
      break;
    }
  };

  // Focus/blur handlers for tabindex and visual styling
  const focusHandlers: Array<() => void> = items.map((item, index) => {
    const handler = () => {
      items.forEach((el, i) => {
        el.setAttribute('tabindex', i === index ? '0' : '-1');
      });
      currentIndex = index;
      item.style.boxShadow = '0 0 0 2px #007bff';
    };
    item.addEventListener('focus', handler);
    return handler;
  });

  const blurHandlers: Array<() => void> = items.map((item) => {
    const handler = () => {
      item.style.boxShadow = '';
    };
    item.addEventListener('blur', handler);
    return handler;
  });

  items.forEach((item) => {
    item.addEventListener('keydown', handleKeyDown);
  });

  const clickHandlers: Array<() => void> = items.map((item, index) => {
    const handler = () => {
      items[currentIndex]?.setAttribute('tabindex', '-1');
      item.setAttribute('tabindex', '0');
      currentIndex = index;
      onSelect(item, index);
    };
    item.addEventListener('click', handler);
    return handler;
  });

  return () => {
    items.forEach((item, index) => {
      item.removeEventListener('keydown', handleKeyDown);
      item.removeEventListener('click', clickHandlers[index]);
      item.removeEventListener('focus', focusHandlers[index]);
      item.removeEventListener('blur', blurHandlers[index]);
    });
  };
}

/**
 * Add keyboard activation handlers to buttons (Enter/Space to activate)
 * @param buttons - Array of button elements
 * @param onActivate - Callback when a button is activated
 * @returns Cleanup function to remove event listeners
 */
export function addButtonKeyboardHandlers(
  buttons: HTMLElement[],
  onActivate: ((button: HTMLElement) => void) | null | undefined,
): () => void {
  if (!buttons || buttons.length === 0) return () => {};

  const handlers: Array<(event: KeyboardEvent) => void> = buttons.map((button) => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onActivate === 'function') {
          onActivate(button);
        }
      }
    };
    button.addEventListener('keydown', handler);
    return handler;
  });

  return () => {
    buttons.forEach((button, index) => {
      button.removeEventListener('keydown', handlers[index]);
    });
  };
}

/**
 * Trap keyboard focus within a container element
 * @param container - The container to trap focus within
 * @returns Cleanup function to remove the trap
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(', ');

  const getFocusableElements = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
      (el) => !el.closest('[hidden]'),
    );

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (event.shiftKey) {
      // Shift+Tab: if on first element (or outside), wrap to last
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if on last element (or outside), wrap to first
      if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  // Focus first focusable element
  const focusable = getFocusableElements();
  if (focusable.length > 0) {
    focusable[0].focus();
  }

  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

export default {
  addModalKeyboardHandlers,
  makeItemsKeyboardNavigable,
  addButtonKeyboardHandlers,
  trapFocus,
};