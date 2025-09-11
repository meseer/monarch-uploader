/**
 * Keyboard Navigation Utilities
 * Shared utilities for handling keyboard navigation in modal components
 */

import { debugLog } from '../core/utils';

/**
 * Adds keyboard navigation support to a modal overlay
 * @param {HTMLElement} overlay - The modal overlay element
 * @param {Function} onEscape - Callback when Escape key is pressed
 * @param {Function} onEnter - Optional callback when Enter key is pressed
 * @returns {Function} Cleanup function to remove event listeners
 */
export function addModalKeyboardHandlers(overlay, onEscape, onEnter = null) {
  const handleKeyDown = (event) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (onEscape) onEscape();
        break;
      case 'Enter':
        if (onEnter && !isInputElement(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          onEnter();
        }
        break;
    }
  };

  overlay.addEventListener('keydown', handleKeyDown);
  
  // Return cleanup function
  return () => {
    overlay.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Makes a list of elements keyboard navigable
 * @param {Array<HTMLElement>} items - Array of selectable items
 * @param {Function} onSelect - Callback when item is selected (receives item element and index)
 * @param {number} initialFocusIndex - Index of item to focus initially (default: 0)
 * @returns {Function} Cleanup function to remove event listeners
 */
export function makeItemsKeyboardNavigable(items, onSelect, initialFocusIndex = 0) {
  if (!items || items.length === 0) return () => {};
  
  let currentFocusIndex = Math.max(0, Math.min(initialFocusIndex, items.length - 1));
  const cleanupFunctions = [];

  // Make all items focusable and add keyboard handlers
  items.forEach((item, index) => {
    // Make item focusable
    if (!item.hasAttribute('tabindex')) {
      item.setAttribute('tabindex', index === currentFocusIndex ? '0' : '-1');
    }

    // Add focus styling
    item.style.outline = 'none'; // Remove default outline, we'll add custom focus styling

    const handleKeyDown = (event) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(-1);
          break;
        case 'Tab':
          // Allow natural tab navigation but update our focus tracking
          if (event.shiftKey) {
            moveFocus(-1);
          } else {
            moveFocus(1);
          }
          break;
        case 'Enter':
        case ' ': // Space key
          event.preventDefault();
          event.stopPropagation();
          if (onSelect) onSelect(item, index);
          break;
      }
    };

    const handleFocus = () => {
      currentFocusIndex = index;
      // Update tabindex for all items
      items.forEach((otherItem, otherIndex) => {
        otherItem.setAttribute('tabindex', otherIndex === index ? '0' : '-1');
      });
      // Add focus styling
      item.style.boxShadow = '0 0 0 2px #007bff';
    };

    const handleBlur = () => {
      // Remove focus styling
      item.style.boxShadow = '';
    };

    item.addEventListener('keydown', handleKeyDown);
    item.addEventListener('focus', handleFocus);
    item.addEventListener('blur', handleBlur);

    cleanupFunctions.push(() => {
      item.removeEventListener('keydown', handleKeyDown);
      item.removeEventListener('focus', handleFocus);
      item.removeEventListener('blur', handleBlur);
    });
  });

  // Focus the initial item
  if (items[currentFocusIndex]) {
    // Use setTimeout to ensure the element is in DOM and visible
    setTimeout(() => {
      items[currentFocusIndex].focus();
    }, 0);
  }

  function moveFocus(direction) {
    const newIndex = currentFocusIndex + direction;
    
    if (newIndex >= 0 && newIndex < items.length) {
      currentFocusIndex = newIndex;
      items[currentFocusIndex].focus();
    }
  }

  // Return cleanup function
  return () => {
    cleanupFunctions.forEach(cleanup => cleanup());
  };
}

/**
 * Adds keyboard navigation to a button group
 * @param {Array<HTMLElement>} buttons - Array of button elements
 * @param {Function} onActivate - Callback when button is activated (receives button element)
 * @returns {Function} Cleanup function
 */
export function addButtonKeyboardHandlers(buttons, onActivate) {
  const cleanupFunctions = [];

  buttons.forEach(button => {
    const handleKeyDown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (onActivate) onActivate(button);
      }
    };

    button.addEventListener('keydown', handleKeyDown);
    
    cleanupFunctions.push(() => {
      button.removeEventListener('keydown', handleKeyDown);
    });
  });

  return () => {
    cleanupFunctions.forEach(cleanup => cleanup());
  };
}

/**
 * Traps focus within a container element
 * @param {HTMLElement} container - Container to trap focus within
 * @returns {Function} Cleanup function
 */
export function trapFocus(container) {
  const focusableElements = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (event) => {
    if (event.key === 'Tab') {
      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusable) {
          event.preventDefault();
          lastFocusable.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusable) {
          event.preventDefault();
          firstFocusable.focus();
        }
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);
  
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Helper function to check if an element is an input element
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element is an input
 */
function isInputElement(element) {
  if (!element) return false;
  
  const inputTags = ['input', 'textarea', 'select'];
  return inputTags.includes(element.tagName.toLowerCase()) ||
         element.contentEditable === 'true';
}

export default {
  addModalKeyboardHandlers,
  makeItemsKeyboardNavigable,
  addButtonKeyboardHandlers,
  trapFocus,
};
